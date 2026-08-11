// One-off runner: applies prisma/legacy-tables.sql via the Prisma client,
// reusing DATABASE_URL. Run: `node prisma/apply-legacy-tables.js`
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// The client is generated into src/generated/prisma, not node_modules, so
// importing "@prisma/client" here failed with a named-export error and this
// script could not run at all. Reuse the same shared instance the app uses.
import { prisma } from '../src/lib/prisma.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'legacy-tables.sql'), 'utf8')

// Split on statement terminators, drop comments and blanks.
const statements = sql
  .split(';')
  .map((s) =>
    s
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
      .trim()
  )
  .filter(Boolean)

for (const stmt of statements) {
  const name = (stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i) || [])[1] || '?'
  await prisma.$executeRawUnsafe(stmt)
  console.log(`✅ ensured table: ${name}`)
}

// ── Columns added after a table already existed ──────────────────────────────
// CREATE TABLE IF NOT EXISTS does nothing on a database that already has the
// table, so new columns have to be added separately. MySQL 5.7 has no
// "ADD COLUMN IF NOT EXISTS", so check first and skip what is already there.
const ADDED_COLUMNS = [
  // Offline donations (cash handed in at the temple, or a direct bank transfer).
  ['donation', 'mode', "VARCHAR(20) NOT NULL DEFAULT 'online'"],
  ['donation', 'txn_ref', 'VARCHAR(255) DEFAULT NULL'],
  ['donation', 'note', 'VARCHAR(500) DEFAULT NULL'],
  ['donation', 'recorded_by', 'VARCHAR(255) DEFAULT NULL'],
]

for (const [table, column, definition] of ADDED_COLUMNS) {
  const existing = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM \`${table}\` LIKE '${column}'`)
  if (existing.length) {
    console.log(`   already present: ${table}.${column}`)
    continue
  }
  await prisma.$executeRawUnsafe(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  console.log(`✅ added column: ${table}.${column}`)
}

await prisma.$disconnect()
console.log('Done.')
