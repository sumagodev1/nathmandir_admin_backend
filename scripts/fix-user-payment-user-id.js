// ── Make user_payment.user_id nullable ────────────────────────
// Website checkout writes a PENDING row at create-order time, before the
// devotee has an account:
//
//   INSERT INTO user_payment (user_id, ...) VALUES (NULL, ...)
//
// verify-payment fills the real id in later. But the live table was migrated
// with `user_id INT(11) NOT NULL`, so that insert dies with
// "Column 'user_id' cannot be null" and /api/checkout/create-order returns 500.
//
// The same table also carries `fk_user_payment_user` → `user`.`id`. `user` is
// a STALE legacy copy of `users` (it stopped being written to at migration),
// so a brand-new buyer's id is missing from it and verify-payment's
// `SET user_id = ?` would fail the foreign key even after the NULL fix.
// Every existing user_payment.user_id is already present in `users`, so
// dropping the constraint orphans nothing.
//
// Neither step changes a single row.
//
//   node scripts/fix-user-payment-user-id.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const TABLE = 'user_payment'
const FK = 'fk_user_payment_user'

const one = async (sql, ...args) => (await prisma.$queryRawUnsafe(sql, ...args))[0]

async function main() {
  // Safety check first: refuse to drop the FK if any row would be orphaned.
  const { orphans } = await one(
    `SELECT COUNT(*) AS orphans FROM ${TABLE} p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.user_id IS NOT NULL AND u.id IS NULL`
  )
  if (Number(orphans)) {
    throw new Error(`${orphans} ${TABLE} rows point at a user_id missing from \`users\` — check those before running this.`)
  }

  // 1. Drop the FK to the stale `user` table.
  const { c: hasFk } = await one(
    `SELECT COUNT(*) AS c FROM information_schema.table_constraints
     WHERE table_schema = DATABASE() AND table_name = ? AND constraint_name = ?`,
    TABLE,
    FK
  )
  if (Number(hasFk)) {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`${TABLE}\` DROP FOREIGN KEY \`${FK}\``)
    console.log(`✓ dropped ${FK} (pointed at the stale \`user\` table)`)
  } else {
    console.log(`✓ ${FK} is already gone`)
  }

  // 2. Allow NULL in user_id.
  const { IS_NULLABLE: nullable } = await one(
    `SELECT IS_NULLABLE FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'user_id'`,
    TABLE
  )
  if (nullable === 'YES') {
    console.log('✓ user_id is already nullable — nothing to do.')
  } else {
    await prisma.$executeRawUnsafe(`ALTER TABLE \`${TABLE}\` MODIFY \`user_id\` INT(11) NULL`)
    console.log('✓ user_id is now nullable — no rows were touched.')
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
