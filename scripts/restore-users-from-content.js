// ── Restore devotees: `content` → keshv_nathmandir_db ─────────
// The working database lost its devotees: keshv_nathmandir_db.users was down
// to a single row and user_access / sales were empty, so the admin panel's
// Users, Access Control and Payments screens were all blank.
//
// The full set survives in the `content` database (a snapshot taken on
// 2026-08-17 11:32): 519 users, 297 access grants, 177 sales. Its three tables
// have exactly the same columns as the live ones, and the products they point
// at (1 gita1, 2 gita2, 4 upasana, 5 nithya) exist on both sides, so the rows
// copy across unchanged.
//
// Three tables and no more. `content` also holds an OLDER content tree (87 rows
// against the live 155), so copying anything else would undo later editing work.
//
// Order matters: users first, then user_access and sales, which both carry a
// foreign key to users.id. Ids are preserved — the legacy user_payment rows
// point at them.
//
// Insert-only and idempotent: a row whose id is already present is left alone,
// so a second run finds nothing to do. The one exception is --replace-conflicts,
// which is how the id-53 clash was settled: a "Sakshi" row registered the day
// before had taken id 53, which belongs to Hari Mahashabde in the snapshot.
//
//   node scripts/restore-users-from-content.js                       # report only
//   node scripts/restore-users-from-content.js --apply               # insert
//   node scripts/restore-users-from-content.js --apply --replace-conflicts
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const SOURCE = 'content'
const TARGET = 'keshv_nathmandir_db'
// Dependants before their parent: user_access cascades on delete but sales is
// RESTRICT, so a conflicting user cannot be removed while a sale points at it.
const TABLES = ['users', 'user_access', 'sales']

const APPLY = process.argv.includes('--apply')
const REPLACE = process.argv.includes('--replace-conflicts')

const q = (sql, ...args) => prisma.$queryRawUnsafe(sql, ...args)
const exec = (sql) => prisma.$executeRawUnsafe(sql)
const count = async (sql) => Number((await q(`SELECT COUNT(*) AS c ${sql}`))[0].c)

async function columnsOf(schema, table) {
  const rows = await q(
    `SELECT column_name AS c FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
    schema,
    table
  )
  return rows.map((r) => r.c)
}

// A user id present on both sides but describing two different people. Copying
// cannot proceed for that row without a decision, so it is reported loudly
// rather than silently skipped.
async function conflicts() {
  return q(
    `SELECT t.id, t.name AS target_name, t.phone AS target_phone,
            s.name AS source_name, s.phone AS source_phone
       FROM \`${TARGET}\`.users t
       JOIN \`${SOURCE}\`.users s ON s.id = t.id
      WHERE s.phone <> t.phone`
  )
}

async function main() {
  console.log(`${SOURCE} → ${TARGET}   (${APPLY ? 'APPLY' : 'dry run'})\n`)

  for (const table of TABLES) {
    const [sc, tc] = await Promise.all([columnsOf(SOURCE, table), columnsOf(TARGET, table)])
    if (sc.join() !== tc.join()) {
      throw new Error(
        `${table}: column lists differ between the two databases — refusing to copy.\n` +
          `  ${SOURCE}: ${sc.join(', ')}\n  ${TARGET}: ${tc.join(', ')}`
      )
    }
  }

  const clash = await conflicts()
  if (clash.length) {
    console.log(`  ${clash.length} id conflict(s):`)
    for (const c of clash) {
      console.log(
        `    id ${c.id}: holds "${c.target_name}" (${c.target_phone}), ` +
          `snapshot has "${c.source_name}" (${c.source_phone})`
      )
    }
    if (!REPLACE) {
      console.log('\n  Pass --replace-conflicts to drop the rows above and take the snapshot ones.')
      if (APPLY) throw new Error('Refusing to apply with unresolved id conflicts.')
    } else if (APPLY) {
      const ids = clash.map((c) => Number(c.id)).join(', ')
      // user_access cascades, sales does not — clear it by hand first.
      await exec(`DELETE FROM \`${TARGET}\`.sales WHERE user_id IN (${ids})`)
      await exec(`DELETE FROM \`${TARGET}\`.users WHERE id IN (${ids})`)
      console.log(`  REMOVED  ${clash.length} conflicting user row(s)\n`)
    } else {
      console.log('  WOULD REMOVE the row(s) above.\n')
    }
  }

  let total = 0
  for (const table of TABLES) {
    const cols = await columnsOf(SOURCE, table)
    const missing = `FROM \`${SOURCE}\`.\`${table}\` s
       LEFT JOIN \`${TARGET}\`.\`${table}\` t ON s.id = t.id
       WHERE t.id IS NULL`

    const n = await count(missing)
    if (!n) {
      console.log(`  ok     ${table} — nothing missing`)
      continue
    }
    if (!APPLY) {
      console.log(`  WOULD  ${table} — insert ${n} row(s)`)
      total += n
      continue
    }

    const list = cols.map((c) => `\`${c}\``).join(', ')
    const pick = cols.map((c) => `s.\`${c}\``).join(', ')
    await exec(`INSERT INTO \`${TARGET}\`.\`${table}\` (${list}) SELECT ${pick} ${missing}`)
    console.log(`  ADDED  ${table} — ${n} row(s)`)
    total += n
  }

  console.log(`\n${APPLY ? 'Inserted' : 'Would insert'} ${total} row(s).`)
  if (!APPLY && total) console.log('Re-run with --apply to write them.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
