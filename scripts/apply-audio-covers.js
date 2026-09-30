// ── Give songs the same cover image the app uses ──────────────
// The app ships one picture per audio (aarti_data.json → audio_image). This
// gives the matching songs on the server the same picture as their coverUrl,
// so the app shows the same image whether it reads the asset or the API.
//
// Run with:  node scripts/apply-audio-covers.js            (dry run — lists only)
//            node scripts/apply-audio-covers.js --apply    (copies images + DB)
//
// Matching: by audio file name first ("01.JAY JAYKAR.mp3"), then by exact
// title. Songs that match nothing are left alone — they show their Part's
// cover (scripts/generate-covers.js).
//
// Only songs with no cover of their own are changed, so an image an admin
// uploaded is never replaced. Songs sharing a picture share one file.
//
// Inputs, bundled so the live server has them too:
//   assets/audio-covers/<id>.webp   the 512×512 pictures
//   assets/audio-covers/map.json    { id: { title, audioFile?, image? } } — from
//     aarti_data.json, plus server-only songs matched by title alone. `image`
//     names another picture to reuse (e.g. मधुराष्टकम → krishna.webp).
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'assets/audio-covers')
const OUT_DIR = path.join(ROOT, 'uploads', 'cover')
const APPLY = process.argv.includes('--apply')

// "/uploads/audio/01.JAY%20JAYKAR.mp3" → "01.jay jaykar.mp3"
function fileKey(ref) {
  if (!ref) return null
  try {
    return decodeURIComponent(ref.split('/').pop()).trim().toLowerCase()
  } catch {
    return ref.split('/').pop().trim().toLowerCase()
  }
}

// Files this script writes: "<timestamp>-audio-<id>.webp". Deliberately not
// "-song-<n>", which generate-covers.js treats as its own old text covers and
// clears.
const OURS = /^\/uploads\/cover\/\d+-audio-[a-z0-9_]+\.webp$/

async function main() {
  const map = JSON.parse(fs.readFileSync(path.join(SRC, 'map.json'), 'utf8'))
  const byFile = new Map()
  const byTitle = new Map()
  // Values are picture names (the .webp to use), not map ids.
  for (const [id, { title, audioFile, image = id }] of Object.entries(map)) {
    if (!fs.existsSync(path.join(SRC, `${image}.webp`))) continue
    if (audioFile) byFile.set(fileKey(audioFile), image)
    byTitle.set(title.trim(), image)
  }

  const songs = await prisma.content.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, audioUrl: true, coverUrl: true },
    orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
  })

  // Reuse a file this script already copied for the same picture.
  const existing = new Map()
  for (const s of songs) {
    const m = s.coverUrl && OURS.test(s.coverUrl) && s.coverUrl.match(/-audio-([a-z0-9_]+)\.webp$/)
    if (m) existing.set(m[1], s.coverUrl)
  }

  const plan = []
  let kept = 0
  let unmatched = 0
  for (const s of songs) {
    const id = byFile.get(fileKey(s.audioUrl)) || byTitle.get(s.title.trim())
    if (!id) { unmatched++; continue }
    if (s.coverUrl && !OURS.test(s.coverUrl)) { kept++; continue } // admin's own image
    plan.push({ song: s, id })
  }

  console.log(`${APPLY ? 'Applying' : 'Dry run —'} ${plan.length} song(s) to set, ${kept} keep their own image, ${unmatched} not in the app list (they use the Part cover).`)
  for (const { song, id } of plan) console.log(`  #${song.id}  ${song.title}  →  ${id}.webp`)
  if (!APPLY) {
    console.log('\nNothing written. Run again with --apply to do it.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const urlFor = (id) => {
    if (!existing.has(id)) {
      const url = `/uploads/cover/${Date.now()}-audio-${id}.webp`
      fs.copyFileSync(path.join(SRC, `${id}.webp`), path.join(ROOT, url))
      existing.set(id, url)
    }
    return existing.get(id)
  }
  for (const { song, id } of plan) {
    const url = urlFor(id)
    if (song.coverUrl === url) continue
    // Guarded on the old value, so an image an admin uploads meanwhile is kept.
    await prisma.content.updateMany({ where: { id: song.id, coverUrl: song.coverUrl }, data: { coverUrl: url } })
  }
  console.log(`Done. ${plan.length} songs now show the same picture as the app.`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
