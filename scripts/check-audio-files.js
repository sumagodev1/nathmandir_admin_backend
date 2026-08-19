// ── Does every audio row point at a file that exists? ─────────
// The app plays whatever `content.audio_url` says. When the path and the file
// on disk disagree the API still returns a perfectly valid-looking URL, the
// download 404s, and the app just fails to play with nothing in the log to
// explain it. This compares the database against the uploads folder and says
// which side is wrong.
//
// Paths are stored percent-encoded ("01%20JAY.mp3"), so each one is decoded
// before it is looked for on disk — exactly what express.static does when it
// serves the request.
//
// When a file is missing, the folder is searched for the same basename so the
// report can say "it exists, just somewhere else" instead of only "missing".
//
// Read-only. It never renames, moves or writes anything.
//
//   node scripts/check-audio-files.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/lib/prisma.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UPLOADS = path.join(ROOT, 'uploads')
const AUDIO_DIR = path.join(UPLOADS, 'audio')

// Every file under uploads/audio, indexed by lower-cased basename, so a row
// whose folder is wrong can still be matched to the file it meant.
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
  if (!fs.existsSync(AUDIO_DIR)) {
    throw new Error(`No audio folder at ${AUDIO_DIR}`)
  }
  const byName = indexAudioFiles(AUDIO_DIR)
  const onDisk = [...byName.values()].flat()
  console.log(`${onDisk.length} audio file(s) on disk under uploads/audio\n`)

  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, title, audio_url FROM content
      WHERE audio_url IS NOT NULL AND audio_url <> '' ORDER BY id`
  )

  const ok = []
  const movable = [] // file exists, but not where the database says
  const missing = [] // no file with that name anywhere

  for (const r of rows) {
    // "/uploads/audio/x.mp3" → "audio/x.mp3", percent-decoded.
    const rel = decodeURIComponent(String(r.audio_url).replace(/^\/+uploads\/+/, ''))
    const full = path.join(UPLOADS, rel)
    if (fs.existsSync(full)) {
      ok.push(r)
      continue
    }
    const hits = byName.get(path.basename(rel).toLowerCase())
    if (hits?.length) movable.push({ ...r, wanted: rel, actual: hits[0] })
    else missing.push({ ...r, wanted: rel })
  }

  console.log(`✓ ${ok.length} row(s) point at a file that exists`)
  console.log(`~ ${movable.length} row(s) point at the WRONG FOLDER (the file is there under another path)`)
  console.log(`✗ ${missing.length} row(s) have no matching file at all\n`)

  if (movable.length) {
    console.log('── wrong folder ──────────────────────────────────')
    for (const m of movable) {
      console.log(`  #${String(m.id).padEnd(4)} ${m.title}`)
      console.log(`        db says : ${m.wanted}`)
      console.log(`        on disk : ${m.actual}`)
    }
    console.log('')
  }

  if (missing.length) {
    console.log('── no file anywhere ──────────────────────────────')
    for (const m of missing) console.log(`  #${String(m.id).padEnd(4)} ${m.title}  →  ${m.wanted}`)
    console.log('')
  }

  // Files nobody references — usually the other half of the same mix-up.
  const referenced = new Set(
    rows.map((r) => decodeURIComponent(String(r.audio_url).replace(/^\/+uploads\/+/, '')))
  )
  const orphans = onDisk.filter((f) => !referenced.has(f))
  if (orphans.length) {
    console.log(`── ${orphans.length} file(s) on disk that no row points at ──`)
    for (const f of orphans.slice(0, 20)) console.log(`  ${f}`)
    if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`)
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
