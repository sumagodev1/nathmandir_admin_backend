// ── Generate Part cover images ────────────────────────────────
// Draws one 512×512 WebP cover per Part: the photo of Shri Madhavnath
// Maharaj in a gold frame, with the Part's name below, in the temple palette.
// Each Part has its own background so they are easy to tell apart.
//
// Songs do not get a copy each: a song with no cover of its own shows its
// Part's cover in the app (see coverOf in mobile.controller.js), so changing
// the photo later means changing four images, not hundreds.
//
// Run with:  node scripts/generate-covers.js            (dry run — lists only)
//            node scripts/generate-covers.js --apply    (writes files + DB)
//            node scripts/generate-covers.js --preview <folder>
//                (draws every Part's cover into <folder> as PNG; DB untouched)
//
// What --apply changes:
//   • Parts with no cover, or with a cover this script made earlier, get the
//     new cover. A cover an admin uploaded by hand is never replaced.
//   • Songs still carrying an old text cover made by this script (…-song-<id>.webp)
//     are cleared, so they fall back to the Part's photo cover. Song images an
//     admin uploaded are left alone.
//   Old generated files are deleted once nothing points at them.
//
// Assets: assets/covers/nath-maharaj.jpg (the photo, already cropped) and
// Noto Sans Devanagari (SIL Open Font License, assets/fonts/OFL.txt).
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { prisma } from '../src/lib/prisma.js'
import { removeUploadIfUnused } from '../src/lib/uploadFiles.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(ROOT, 'uploads', 'cover')
const PHOTO = path.join(ROOT, 'assets/covers/nath-maharaj.jpg')
const FONT = path.join(ROOT, 'assets/fonts/NotoSansDevanagari-Bold.ttf')
const APPLY = process.argv.includes('--apply')

// What this script names its files: "<timestamp>-part-<id>.webp" and, from
// the earlier text version, "<timestamp>-song-<id>.webp". Panel uploads are
// "<timestamp>-<random>-<name>.webp", so the two can never be confused.
const OURS_PART = /^\/uploads\/cover\/\d+-part-\d+\.webp$/
const OURS_SONG = /^\/uploads\/cover\/\d+-song-\d+\.webp$/

// The chosen palette.
const C = {
  gold: '#D9B26A',
  beige: '#DEC8AE',
  stone: '#DCD5CC',
  brown: '#8B7260',
  maroon: '#470D0B',
}
const DARK = { bgA: '#5E1512', bgB: C.maroon, frame: C.gold, text: C.gold }

// Keyed by the Part's public code, which is the same on every database.
const STYLES = {
  gita1: { label: 'गीतांजली भाग १', ...DARK },
  gita2: { label: 'गीतांजली भाग २', bgA: '#9A8170', bgB: C.brown, frame: C.beige, text: '#FFFFFF' },
  upasana: { label: 'उपासना', bgA: '#EBDCC8', bgB: C.beige, frame: C.brown, text: C.maroon },
  nithya: { label: 'नित्यनियम', bgA: '#E8E2DA', bgB: C.stone, frame: C.gold, text: C.maroon },
}
// A Part added later gets the maroon style and its own name.
const styleOf = (product) => STYLES[product.code] || { label: product.name, ...DARK }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Photo box: 380 px square, centred, leaving room for the name below.
const BOX = 380
const BOX_X = 66
const BOX_Y = 30

function background({ bgA, bgB, frame }) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="35%" r="80%">
      <stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect x="${BOX_X - 7}" y="${BOX_Y - 7}" width="${BOX + 14}" height="${BOX + 14}" rx="30" fill="none" stroke="${frame}" stroke-width="3"/>
  <rect x="14" y="14" width="484" height="484" rx="18" fill="none" stroke="${frame}" stroke-opacity="0.45" stroke-width="1.5"/>
</svg>`)
}

async function photo() {
  const mask = Buffer.from(`<svg width="${BOX}" height="${BOX}"><rect width="${BOX}" height="${BOX}" rx="24" fill="#fff"/></svg>`)
  return sharp(PHOTO)
    .resize(BOX, BOX, { fit: 'cover', position: 'top' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer()
}

// The largest size at which the name fits on one line under the photo.
async function label(textValue, color) {
  for (let size = 32; size >= 18; size -= 2) {
    const r = await sharp({
      text: {
        text: `<span foreground="${color}">${esc(textValue)}</span>`,
        font: `Noto Sans Devanagari Bold ${size}`,
        fontfile: FONT,
        width: 440,
        align: 'centre',
        rgba: true,
        dpi: 72,
      },
    }).png().toBuffer({ resolveWithObject: true })
    if (r.info.height <= 56) return r
  }
  throw new Error(`Part name too long for the cover: ${textValue}`)
}

async function render(style, photoPng) {
  const name = await label(style.label, style.text)
  return sharp(background(style))
    .composite([
      { input: photoPng, left: BOX_X, top: BOX_Y },
      { input: name.data, left: Math.round(256 - name.info.width / 2), top: Math.round(460 - name.info.height / 2) },
    ])
    .webp({ quality: 82 })
    .toBuffer()
}

async function main() {
  for (const f of [PHOTO, FONT]) {
    if (!fs.existsSync(f)) throw new Error(`Missing file: ${f}`)
  }

  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })

  const at = process.argv.indexOf('--preview')
  if (at !== -1) {
    const dir = process.argv[at + 1]
    if (!dir) throw new Error('--preview needs a folder, e.g. --preview ./cover-preview')
    fs.mkdirSync(dir, { recursive: true })
    const photoPng = await photo()
    for (const p of products) {
      const file = path.join(dir, `part-${p.id}-${p.code}.png`)
      await sharp(await render(styleOf(p), photoPng)).png().toFile(file)
      console.log(`  ${file}`)
    }
    console.log('Preview only — the database was not changed.')
    return
  }

  const parts = products.filter((p) => !p.coverUrl || OURS_PART.test(p.coverUrl))
  const kept = products.filter((p) => !parts.includes(p))
  const oldSongCovers = (await prisma.content.findMany({
    where: { coverUrl: { startsWith: '/uploads/cover/' } },
    select: { id: true, coverUrl: true },
  })).filter((s) => OURS_SONG.test(s.coverUrl))

  console.log(`${APPLY ? 'Applying' : 'Dry run —'} ${parts.length} Part cover(s) to make, ${oldSongCovers.length} old song text cover(s) to clear.`)
  for (const p of parts) console.log(`  Part  #${p.id}  ${styleOf(p).label}`)
  for (const p of kept) console.log(`  Part  #${p.id}  ${p.name} — keeps its hand-uploaded cover`)
  if (!APPLY) {
    console.log('\nNothing written. Run again with --apply to do it.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const photoPng = await photo()

  for (const p of parts) {
    const buf = await render(styleOf(p), photoPng)
    // Timestamped, so a remade cover gets a new URL and no phone keeps a
    // cached old one.
    const url = `/uploads/cover/${Date.now()}-part-${p.id}.webp`
    fs.writeFileSync(path.join(ROOT, url), buf)
    await prisma.product.update({ where: { id: p.id }, data: { coverUrl: url } })
    if (p.coverUrl) await removeUploadIfUnused(p.coverUrl)
    console.log(`  ✓ Part #${p.id} ${styleOf(p).label}  (${(buf.length / 1024).toFixed(0)} KB)`)
  }

  // Guarded on the old value, so a cover an admin uploads while this runs is kept.
  for (const s of oldSongCovers) {
    await prisma.content.updateMany({ where: { id: s.id, coverUrl: s.coverUrl }, data: { coverUrl: null } })
    await removeUploadIfUnused(s.coverUrl)
  }
  if (oldSongCovers.length) console.log(`  ✓ Cleared ${oldSongCovers.length} old song text covers — those songs now show their Part's cover.`)
  console.log('Done.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
