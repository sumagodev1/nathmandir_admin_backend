// ── Point audio rows at where the file actually is ────────────
// 27 rows expect their file inside a subfolder:
//
//   db   : /uploads/audio/Upasana/01%20JAYJAYKAR-Master.mp3
//   disk : /uploads/audio/01 JAYJAYKAR-Master.mp3
//
// The files were uploaded flat into uploads/audio, the subfolders were never
// created, and express.static 404s. The API still hands the app a valid-looking
// URL, so the download just fails with nothing to explain why — which is what
// "audios not working" looks like from the phone.
//
// This rewrites the path to the file that is really on disk, matched by
// filename. Nothing on disk is touched: no file is moved, renamed or deleted.
// Rows whose file is already correct are left alone, and a row whose filename
// exists in more than one place is skipped and reported rather than guessed at.
//
//   node scripts/repoint-audio-paths.js --dry
//   node scripts/repoint-audio-paths.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma.js'

const DRY = process.argv.includes('--dry')
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UPLOADS = path.join(ROOT, 'uploads')
const AUDIO_DIR = path.join(UPLOADS, 'audio')

// Stored paths are percent-encoded, so encode each segment the same way —
// a bare space would make the URL invalid for the player.
const toUrl = (rel) => '/uploads/' + rel.split('/').map(encodeURIComponent).join('/')

function indexAudioFiles(dir, found = new Map()) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) indexAudioFiles(full, found)
    else {
      const key = e.name.toLowerCase()
      if (!found.has(key)) found.set(key, [])
      found.get(key).push(path.relative(UPLOADS, full).replace(/\\/g, '/'))
    }
  }
  return found
}

async function main() {
  if (!fs.existsSync(AUDIO_DIR)) throw new Error(`No audio folder at ${AUDIO_DIR}`)
  const byName = indexAudioFiles(AUDIO_DIR)

  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, title, audio_url FROM content
      WHERE audio_url IS NOT NULL AND audio_url <> '' ORDER BY id`
  )

  const fixes = []
  const ambiguous = []
  const missing = []
  let alreadyOk = 0

  for (const r of rows) {
    const rel = decodeURIComponent(String(r.audio_url).replace(/^\/+uploads\/+/, ''))
    if (fs.existsSync(path.join(UPLOADS, rel))) {
      alreadyOk++
      continue
    }
    const hits = byName.get(path.basename(rel).toLowerCase()) || []
    if (hits.length === 1) fixes.push({ ...r, from: rel, to: hits[0] })
    else if (hits.length > 1) ambiguous.push({ ...r, from: rel, hits })
    else missing.push({ ...r, from: rel })
  }

  console.log(`${alreadyOk} row(s) already correct.`)
  console.log(`${fixes.length} row(s) can be repointed.`)
  if (ambiguous.length) console.log(`${ambiguous.length} row(s) match more than one file — skipped.`)
  if (missing.length) console.log(`${missing.length} row(s) have no file on disk — cannot fix here.`)
  console.log('')

  for (const f of fixes) {
    console.log(`  #${String(f.id).padEnd(4)} ${f.title}`)
    console.log(`        ${f.from}  →  ${f.to}`)
  }
  if (ambiguous.length) {
    console.log('\n── skipped, filename appears more than once ──')
    for (const a of ambiguous) console.log(`  #${a.id} ${a.title}: ${a.hits.join(' | ')}`)
  }
  if (missing.length) {
    console.log('\n── no file on disk (upload it, or fix in the panel) ──')
    for (const m of missing) console.log(`  #${String(m.id).padEnd(4)} ${m.title}  →  ${m.from}`)
  }

  if (!fixes.length) {
    console.log('\nNothing to repoint.')
    return
  }
  if (DRY) {
    console.log('\nDry run — nothing was written. Drop --dry to apply.')
    return
  }

  for (const f of fixes) {
    await prisma.$executeRawUnsafe(`UPDATE content SET audio_url = ? WHERE id = ?`, toUrl(f.to), f.id)
  }
  console.log(`\n✓ repointed ${fixes.length} row(s). No file on disk was touched.`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
