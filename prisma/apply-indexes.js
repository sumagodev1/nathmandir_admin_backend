// ─────────────────────────────────────────────────────────────
// Idempotent index applier.  Run: `node prisma/apply-indexes.js`
//
// Why this exists instead of `prisma migrate dev`: this database also holds
// the legacy production tables (contact, user_payment, login_user, orders …)
// that aren't in schema.prisma. Prisma sees them as drift and offers to RESET
// the database — which would destroy real data. So the index migration is
// applied here, statement by statement, skipping anything already present.
//
// It reads the statements from the migration file itself, so the two can
// never disagree. Safe to re-run any number of times.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const __dirname = dirname(fileURLToPath(import.meta.url))

const SOURCES = [
  // Prisma-managed tables (users, content, sales, books, albums, …)
  join(__dirname, 'migrations', '20260730060000_add_performance_indexes', 'migration.sql'),
  // Legacy production tables (login_user, user_payment, …)
  join(__dirname, 'legacy-indexes.sql'),
]

// Pull out `CREATE INDEX <name> ON <table>(...)` statements.
const statements = SOURCES.flatMap((file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^\s*CREATE\s+INDEX/i.test(l))
    .map((l) => l.trim().replace(/;\s*$/, ''))
)

if (!statements.length) {
  console.error('❌ No CREATE INDEX statements found in:', SOURCES.join(', '))
  process.exit(1)
}

// MySQL has no "CREATE INDEX IF NOT EXISTS", so check the catalogue first.
async function exists(table, index) {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = ${table} AND index_name = ${index}
    LIMIT 1`
  return rows.length > 0
}

let created = 0
let skipped = 0

for (const stmt of statements) {
  const m = stmt.match(/CREATE\s+INDEX\s+`?([^`\s]+)`?\s+ON\s+`?([^`\s(]+)`?/i)
  if (!m) {
    console.warn('⚠️  could not parse, skipping:', stmt)
    continue
  }
  const [, index, table] = m

  if (await exists(table, index)) {
    console.log(`⏭️  exists: ${table}.${index}`)
    skipped++
    continue
  }

  try {
    await prisma.$executeRawUnsafe(stmt)
    console.log(`✅ created: ${table}.${index}`)
    created++
  } catch (err) {
    // Prisma prefixes raw-query errors with several blank/context lines —
    // show the first line that actually says something.
    const detail = err.message.split('\n').map((l) => l.trim()).filter(Boolean).pop()
    console.error(`❌ failed:  ${table}.${index} — ${detail}`)
  }
}

await prisma.$disconnect()
console.log(`\nDone. ${created} created, ${skipped} already present.`)
