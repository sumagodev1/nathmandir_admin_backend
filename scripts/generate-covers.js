// ── Generate cover images for songs and Parts ─────────────────
// Draws a 512×512 WebP cover for every song and Part that has none:
// a gold ॐ on a maroon disc, the Marathi title, and the Part's name, in the
// temple palette. Each Part has its own background so they are easy to tell
// apart in the app.
//
// Run with:  node scripts/generate-covers.js            (dry run — lists only)
//            node scripts/generate-covers.js --apply    (writes files + DB)
//
// Only rows whose coverUrl is empty are touched, so an image an admin
// uploaded by hand is never replaced. Running it again later covers only the
// songs added since. Files go to uploads/cover/, like panel uploads.
//
// Font: Noto Sans Devanagari (SIL Open Font License, assets/fonts/OFL.txt),
// bundled so the covers look the same on Windows and on the Linux server.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { prisma } from '../src/lib/prisma.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'uploads', 'cover')
const FONT_BOLD = path.join(ROOT, 'assets/fonts/NotoSansDevanagari-Bold.ttf')
const FONT_REG = path.join(ROOT, 'assets/fonts/NotoSansDevanagari-Regular.ttf')
const APPLY = process.argv.includes('--apply')
const S = 512

// The chosen palette — nothing outside these five (plus a lighter shade of
// each for the centre glow).
const C = {
  gold: '#D9B26A',
  beige: '#DEC8AE',
  stone: '#DCD5CC',
  brown: '#8B7260',
  maroon: '#470D0B',
}
const DARK = { bgA: '#5E1512', bgB: C.maroon, accent: C.gold, title: C.stone, sub: C.gold }

// Keyed by the Part's public code, which is the same on every database.
const STYLES = {
  gita1: { label: 'गीतांजली भाग १', ...DARK },
  gita2: { label: 'गीतांजली भाग २', bgA: '#9A8170', bgB: C.brown, accent: C.beige, title: '#FFFFFF', sub: C.beige },
  upasana: { label: 'उपासना', bgA: '#EBDCC8', bgB: C.beige, accent: C.brown, title: C.maroon, sub: C.brown },
  nithya: { label: 'नित्यनियम', bgA: '#E8E2DA', bgB: C.stone, accent: C.gold, title: C.maroon, sub: C.brown },
}
// A Part added later gets the maroon style and its own name.
const styleOf = (product) => STYLES[product.code] || { label: product.name, ...DARK }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Background and ornament only. Text is drawn separately through Pango,
// which joins Devanagari letters (श्री, क्ष) correctly; SVG text does not.
function background({ accent, bgA, bgB }) {
  const rays = Array.from({ length: 36 }, (_, i) => {
    const a = (i * 10 * Math.PI) / 180
    const x = 256 + Math.cos(a) * 360
    const y = 150 + Math.sin(a) * 360
    return `<line x1="256" y1="150" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${accent}" stroke-opacity="0.08" stroke-width="10"/>`
  }).join('')
  const petals = Array.from({ length: 16 }, (_, i) =>
    `<ellipse cx="256" cy="92" rx="10" ry="30" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="1.5" transform="rotate(${i * 22.5} 256 150)"/>`
  ).join('')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="80%">
      <stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${S}" height="${S}" fill="url(#bg)"/>
  ${rays}
  <circle cx="256" cy="150" r="120" fill="url(#glow)"/>
  ${petals}
  <circle cx="256" cy="150" r="52" fill="${C.maroon}" stroke="${accent}" stroke-width="2.5"/>
  <circle cx="256" cy="150" r="60" fill="none" stroke="${accent}" stroke-opacity="0.5" stroke-width="1"/>
  <rect x="14" y="14" width="${S - 28}" height="${S - 28}" rx="18" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="1.5"/>
  <line x1="196" y1="402" x2="316" y2="402" stroke="${accent}" stroke-opacity="0.7" stroke-width="1.5"/>
  <circle cx="256" cy="402" r="3.5" fill="${accent}"/>
</svg>`)
}

const text = (markup, { bold = true, size, width }) =>
  sharp({
    text: {
      text: markup,
      font: `Noto Sans Devanagari ${bold ? 'Bold ' : ''}${size}`,
      fontfile: bold ? FONT_BOLD : FONT_REG,
      width,
      align: 'centre',
      rgba: true,
      wrap: 'word',
      dpi: 72,
    },
  }).png().toBuffer({ resolveWithObject: true })

// The largest size at which the title fits the middle band (about 3 lines).
async function fitTitle(title, color) {
  const markup = `<span foreground="${color}">${esc(title)}</span>`
  for (let size = 60; size >= 24; size -= 2) {
    const r = await text(markup, { size, width: 420 })
    if (r.info.height <= 170 && r.info.width <= 420) return r
  }
  return text(markup, { size: 22, width: 420 })
}

async function render(title, subtitle, style) {
  const om = await text(`<span foreground="${C.gold}">ॐ</span>`, { size: 64, width: 120 })
  const t = await fitTitle(title, style.title)
  const sub = await text(`<span foreground="${style.sub}" letter_spacing="1024">${esc(subtitle)}</span>`, {
    bold: false, size: 22, width: 400,
  })
  const at = (img, cx, cy) => ({
    input: img.data,
    left: Math.round(cx - img.info.width / 2),
    top: Math.round(cy - img.info.height / 2),
  })
  return sharp(background(style))
    .composite([at(om, 256, 150), at(t, 256, 305), at(sub, 256, 440)])
    .webp({ quality: 82 })
    .toBuffer()
}

// Timestamped like panel uploads, so a regenerated cover gets a new URL and
// no phone keeps showing a cached old one.
async function save(buf, name) {
  const file = `${Date.now()}-${name}.webp`
  fs.writeFileSync(path.join(OUT_DIR, file), buf)
  return `/uploads/cover/${file}`
}

async function main() {
  for (const f of [FONT_BOLD, FONT_REG]) {
    if (!fs.existsSync(f)) throw new Error(`Font missing: ${f}`)
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  const byId = new Map(products.map((p) => [p.id, p]))
  const parts = products.filter((p) => !p.coverUrl)
  const songs = await prisma.content.findMany({
    where: { coverUrl: null, deletedAt: null },
    orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
    select: { id: true, title: true, productId: true },
  })

  console.log(`${APPLY ? 'Generating' : 'Dry run —'} ${parts.length} Part cover(s), ${songs.length} song cover(s).`)
  if (!APPLY) {
    for (const p of parts) console.log(`  Part  #${p.id}  ${styleOf(p).label}`)
    for (const s of songs) console.log(`  Song  #${s.id}  ${s.title}  (${styleOf(byId.get(s.productId)).label})`)
    console.log('\nNothing written. Run again with --apply to create them.')
    return
  }

  let bytes = 0
  for (const p of parts) {
    const style = styleOf(p)
    const buf = await render(style.label, 'श्रीनाथ गीतांजली', style)
    const url = await save(buf, `part-${p.id}`)
    await prisma.product.update({ where: { id: p.id }, data: { coverUrl: url } })
    bytes += buf.length
    console.log(`  ✓ Part #${p.id} ${style.label}`)
  }
  for (const [i, s] of songs.entries()) {
    const style = styleOf(byId.get(s.productId))
    const buf = await render(s.title, style.label, style)
    const url = await save(buf, `song-${s.id}`)
    // Guarded on null again: an admin may have uploaded one while this ran.
    await prisma.content.updateMany({ where: { id: s.id, coverUrl: null }, data: { coverUrl: url } })
    bytes += buf.length
    if ((i + 1) % 25 === 0 || i === songs.length - 1) console.log(`  ✓ ${i + 1}/${songs.length} songs`)
  }
  console.log(`Done. ${parts.length + songs.length} covers, ${(bytes / 1024).toFixed(0)} KB in total.`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
