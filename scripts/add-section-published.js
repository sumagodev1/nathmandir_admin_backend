// ── Add content_node.published ────────────────────────────────
// Sections gain their own active/inactive switch. Hiding a section hides
// everything filed inside it — sub-sections, days, songs — without touching
// each item's own `published`, so switching the section back on restores
// exactly what was showing before.
//
// Applied as raw SQL rather than `prisma migrate`, which would want to reset
// this database. Existing sections default to TRUE, so nothing disappears the
// moment this runs.
//
// Safe to run twice: it checks for the column first.
//
//   node scripts/add-section-published.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const TABLE = 'content_node'
const COLUMN = 'published'

async function main() {
  const [{ c }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    TABLE,
    COLUMN
  )
  if (Number(c)) {
    console.log(`✓ ${TABLE}.${COLUMN} already exists — nothing to do.`)
    return
  }

  await prisma.$executeRawUnsafe(
    `ALTER TABLE \`${TABLE}\` ADD COLUMN \`${COLUMN}\` BOOLEAN NOT NULL DEFAULT TRUE`
  )
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${TABLE}\``)
  console.log(`✓ added ${TABLE}.${COLUMN}. All ${n} existing section(s) are active — nothing was hidden.`)
  console.log('  Now run: npx prisma generate')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
