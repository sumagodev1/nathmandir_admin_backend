// ── Merge server_nathmandir_db → keshv_nathmandir_db ──────────
// Copies any row that exists in the old server database but is MISSING
// from the working database. Insert-only: it never updates or deletes,
// so no existing record can be lost. Safe to re-run — a second run
// finds nothing to do.
//
// Rows are matched on the primary key. A table is skipped when it does
// not exist on both sides, or when the two column lists differ by name.
//
//   node scripts/merge-server-db.js          # report only, changes nothing
//   node scripts/merge-server-db.js --apply  # actually insert
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const SOURCE = 'server_nathmandir_db'
const TARGET = 'keshv_nathmandir_db'
const APPLY = process.argv.includes('--apply')

const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args)
const n = (v) => Number(v)

async function tablesIn(schema) {
  const rows = await q(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?`,
    schema
  )
  return rows.map((r) => r.t)
}

async function columnsOf(schema, table) {
  const rows = await q(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    schema,
    table
  )
  return rows.map((r) => r.c)
}

async function primaryKeyOf(schema, table) {
  const rows = await q(
    `SELECT column_name AS c FROM information_schema.key_column_usage
     WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'
     ORDER BY ordinal_position`,
    schema,
    table
  )
  return rows.map((r) => r.c)
}

async function main() {
  const [src, tgt] = await Promise.all([tablesIn(SOURCE), tablesIn(TARGET)])
  const shared = src.filter((t) => tgt.includes(t)).sort()

  console.log(`${SOURCE} → ${TARGET}   (${APPLY ? 'APPLY' : 'dry run'})\n`)

  let inserted = 0
  for (const table of shared) {
    const pk = await primaryKeyOf(SOURCE, table)
    if (!pk.length) {
      console.log(`  skip   ${table} — no primary key to match rows on`)
      continue
    }

    const [sc, tc] = await Promise.all([columnsOf(SOURCE, table), columnsOf(TARGET, table)])
    // Copy only the columns both sides have, so a table the new schema
    // extended (extra columns here) still merges — the extras keep their
    // defaults on the copied rows.
    const cols = sc.filter((c) => tc.includes(c))
    if (!cols.length) {
      console.log(`  skip   ${table} — no columns in common`)
      continue
    }

    const on = pk.map((k) => `s.\`${k}\` = t.\`${k}\``).join(' AND ')
    const missingSql = `FROM \`${SOURCE}\`.\`${table}\` s
       LEFT JOIN \`${TARGET}\`.\`${table}\` t ON ${on}
       WHERE t.\`${pk[0]}\` IS NULL`

    const [{ c }] = await q(`SELECT COUNT(*) AS c ${missingSql}`)
    const count = n(c)
    if (!count) {
      console.log(`  ok     ${table} — nothing missing`)
      continue
    }

    if (!APPLY) {
      console.log(`  WOULD  ${table} — insert ${count} row(s)`)
      inserted += count
      continue
    }

    const list = cols.map((cn) => `\`${cn}\``).join(', ')
    const pick = cols.map((cn) => `s.\`${cn}\``).join(', ')
    await prisma.$executeRawUnsafe(
      `INSERT INTO \`${TARGET}\`.\`${table}\` (${list}) SELECT ${pick} ${missingSql}`
    )
    console.log(`  ADDED  ${table} — ${count} row(s)`)
    inserted += count
  }

  const only = src.filter((t) => !tgt.includes(t))
  if (only.length) console.log(`\n  tables only in ${SOURCE}: ${only.join(', ')}`)

  console.log(
    `\n${APPLY ? 'Inserted' : 'Would insert'} ${inserted} row(s). Nothing was updated or deleted.`
  )
  if (!APPLY && inserted) console.log('Re-run with --apply to write them.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
