// One-off runner: applies prisma/legacy-tables.sql via the Prisma client,
// reusing DATABASE_URL. Run: `node prisma/apply-legacy-tables.js`
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
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

await prisma.$disconnect()
console.log('Done.')
