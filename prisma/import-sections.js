// ── Import website content sections from a JSON dump ──────────
// Copies website sections (maharaj, temple, trust, events, donate,
// story, library) into the `site_sections` table. Use this to move the
// content from a machine that already has it onto a server that does
// not — `git pull` carries code, never database rows. Only the sections
// present in the file are written; every other section is left alone.
//
// Run on the server:
//   node prisma/import-sections.js
//
// By default it reads the dump the frontend repo already ships:
//   ../nathmandir_admin_frontend/.tmp-sections.json
// Point it somewhere else with an argument or SECTIONS_FILE:
//   node prisma/import-sections.js /path/to/sections.json
//
// The 35 Kiran of the Deepprakash (Library page) ship as their own file.
// Run `npx prisma migrate deploy` first — site_sections.data must be
// LONGTEXT to hold them:
//   node prisma/import-sections.js prisma/seed-data/library-kiran.json
//
// Accepted shapes (both work):
//   { "maharaj": { … }, "temple": { … } }          ← key → data object
//   [ { "key": "maharaj", "data": "{…}" }, … ]      ← rows, data as JSON text
//
// Safety: a section whose data is empty ({}) is SKIPPED, so a stale or
// blank dump can never wipe content that is already live. Pass --force
// to write empties anyway.
import 'dotenv/config'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { prisma } from '../src/lib/prisma.js'
import { SECTION_KEYS, saveSectionVerified } from '../src/controllers/sections.controller.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const args = process.argv.slice(2)
const force = args.includes('--force')
const fileArg = args.find((a) => !a.startsWith('--'))

const FILE = resolve(
  fileArg ||
    process.env.SECTIONS_FILE ||
    join(__dirname, '..', '..', 'nathmandir_admin_frontend', '.tmp-sections.json')
)

// Turn either accepted shape into a plain { key: dataObject } map.
function toSectionMap(parsed) {
  if (Array.isArray(parsed)) {
    const out = {}
    for (const row of parsed) {
      if (!row?.key) continue
      out[row.key] = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    }
    return out
  }
  // A wrapper like { sections: {…} } from the API response is fine too.
  if (parsed?.sections && !SECTION_KEYS.includes('sections')) return toSectionMap(parsed.sections)
  return parsed || {}
}

const isEmpty = (data) =>
  !data || typeof data !== 'object' || Object.keys(data).length === 0

async function main() {
  if (!existsSync(FILE)) {
    console.error(`❌ File not found: ${FILE}`)
    console.error('   Pass the path as an argument, e.g.')
    console.error('   node prisma/import-sections.js /var/www/nathmandir/nathmandir_admin_frontend/.tmp-sections.json')
    process.exit(1)
  }

  console.log(`📄 Reading ${FILE}`)
  const sections = toSectionMap(JSON.parse(readFileSync(FILE, 'utf8')))

  const keys = Object.keys(sections)
  if (!keys.length) {
    console.error('❌ The file has no sections in it. Nothing to import.')
    process.exit(1)
  }

  let written = 0
  let skipped = 0
  let failed = 0

  for (const key of keys) {
    if (!SECTION_KEYS.includes(key)) {
      console.log(`  – "${key}" is not a website section, ignored`)
      continue
    }

    const data = sections[key]
    if (isEmpty(data) && !force) {
      console.log(`  ⚠ "${key}" is empty in the file — skipped (use --force to write it anyway)`)
      skipped++
      continue
    }

    const json = JSON.stringify(data)
    // Written and read back in one transaction: a too-small column would
    // silently truncate the JSON, so a mismatch rolls back and leaves the
    // section exactly as it was.
    const saved = await saveSectionVerified(key, json)
    if (!saved) {
      console.error(
        `  ✗ "${key}" NOT saved: it is ${Buffer.byteLength(json)} bytes and the database cut it off. ` +
          'Nothing was changed. Run `npx prisma migrate deploy` (site_sections.data must be LONGTEXT), then import again.'
      )
      failed++
      continue
    }
    console.log(`  ✓ "${key}" saved (${json.length} characters, ${Buffer.byteLength(json)} bytes)`)
    written++
  }

  // Report what the table holds now, so the result is visible without a
  // second command.
  const rows = await prisma.siteSection.findMany({ select: { key: true, data: true } })
  console.log(`\n${failed ? '❌' : '✅'} Done. Wrote ${written}, skipped ${skipped}, failed ${failed}.`)
  if (failed) process.exitCode = 1
  console.log(`   site_sections now holds ${rows.length} row(s):`)
  for (const r of rows) console.log(`     • ${r.key} (${r.data.length} characters)`)
  console.log('\n   Check it: https://api.nathmandir.sumago.ai/api/public/sections')
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
