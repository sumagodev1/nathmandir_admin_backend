// ── Drop fk_userpayment_user ──────────────────────────────────
// The legacy `userpayment` rows include payments whose `userId` points at
// users that no longer exist (deleted accounts — ids 0, 243, 277, 283, 286).
// A foreign key to `user`.`id` was added by hand during the migration; it is
// not in prisma/legacy-tables.sql, and the live data can never satisfy it, so
// it silently blocked 21 real payment records from being imported.
//
// Dropping it changes no row. It only stops MySQL rejecting those records.
//
//   node scripts/drop-userpayment-fk.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const TABLE = 'userpayment'
const FK = 'fk_userpayment_user'

async function main() {
  const [{ c }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    TABLE,
    FK
  )
  if (!Number(c)) {
    console.log(`✓ ${FK} is already gone — nothing to do.`)
    return
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE \`${TABLE}\` DROP FOREIGN KEY \`${FK}\``)
  console.log(`✓ dropped ${FK} from ${TABLE} — no rows were touched.`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
