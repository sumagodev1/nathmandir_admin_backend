// ── Remember who a pending payment belongs to ─────────────────
// A checkout row is written at create-order, before the devotee has an
// account, so `user_id` is NULL and the Payments screen — which reads the name
// through a JOIN on users — shows "#" and a dash for the mobile.
//
// That is exactly the row an admin most needs to identify: a payment that
// failed or was abandoned. Who tried to pay, and on what number, is known at
// create-order time; it just had nowhere to be stored.
//
// Adds `buyer_name` and `buyer_mobile`. Both nullable, so every existing row
// stays valid and nothing is rewritten.
//
// Safe to run twice: it checks for the columns first.
//
//   node scripts/add-user-payment-buyer.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const TABLE = 'user_payment'

const hasColumn = async (name) => {
  const [{ c }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    TABLE,
    name
  )
  return Number(c) > 0
}

async function main() {
  const adds = []
  if (!(await hasColumn('buyer_name'))) adds.push('ADD COLUMN `buyer_name` VARCHAR(191) NULL')
  if (!(await hasColumn('buyer_mobile'))) adds.push('ADD COLUMN `buyer_mobile` VARCHAR(20) NULL')

  if (!adds.length) {
    console.log('✓ buyer_name and buyer_mobile already exist — nothing to do.')
    return
  }

  await prisma.$executeRawUnsafe(`ALTER TABLE \`${TABLE}\` ${adds.join(', ')}`)
  const [{ n }] = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM \`${TABLE}\``)
  console.log(`✓ added ${adds.length} column(s). All ${n} existing rows left untouched.`)
  console.log('  Older rows stay blank; they already resolve their name through user_id.')
  console.log('  Now run: npx prisma generate')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
