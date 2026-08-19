// ── Give the books to people who already paid for them ────────
// A few devotees paid and never received access. They stayed invisible for
// years because the old PHP report (freport.php) filtered on `u.isPaid = '1'`
// — a flag on the PERSON, not on the payment — so anyone whose flag was never
// set dropped out of the report along with their money.
//
// This finds every completed payment with no matching user_access row and
// fixes it two ways: grants the access, and sets the is_paid flag so the
// person stops looking unpaid.
//
// Tiny gateway test payments (₹1 from launch week) are skipped by default,
// since nobody actually bought anything. Pass --include-tests to grant those
// too. Package 3 is "Donation", never a book, so it is never granted.
//
// Nothing is deleted, and an existing access row is never overwritten.
//
//   node scripts/grant-access-to-payers.js --dry
//   node scripts/grant-access-to-payers.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const DRY = process.argv.includes('--dry')
const INCLUDE_TESTS = process.argv.includes('--include-tests')
const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN')

// Below this, a payment is a gateway test rather than a purchase.
const TEST_PAYMENT_MAX = 10

async function main() {
  const owed = await prisma.$queryRawUnsafe(
    `SELECT up.id AS paymentId, u.id AS userId, u.name, u.phone, u.is_paid AS isPaid,
            pr.id AS productId, pr.name AS book,
            up.amount + 0 AS amount, up.created_at AS paidOn
       FROM user_payment up
       JOIN users    u  ON u.id = up.user_id
       JOIN package  pk ON pk.id = up.package_id
       JOIN products pr ON pr.code = pk.code
       LEFT JOIN user_access a ON a.user_id = up.user_id AND a.product_id = pr.id
      WHERE up.razorpay_stageOfPayment IN ('Completed', 'Credit')
        AND up.package_id IN (1, 2, 4, 5)
        AND a.id IS NULL
      ORDER BY up.amount + 0 DESC`
  )

  const real = owed.filter((r) => INCLUDE_TESTS || Number(r.amount) > TEST_PAYMENT_MAX)
  const tests = owed.filter((r) => Number(r.amount) <= TEST_PAYMENT_MAX)

  if (tests.length && !INCLUDE_TESTS) {
    console.log(`Skipping ${tests.length} gateway test payment(s) of ${TEST_PAYMENT_MAX} rupees or less:`)
    for (const t of tests) console.log(`  ${t.name} — ${t.book} — ${rupees(t.amount)}`)
    console.log('  (pass --include-tests to grant these too)\n')
  }

  if (!real.length) {
    console.log('✓ Nobody is waiting — every paid book has been delivered.')
    return
  }

  console.log(`${real.length} payment(s) with no access:\n`)
  for (const r of real) {
    const on = new Date(r.paidOn).toISOString().slice(0, 10)
    console.log(`  ${String(r.name).padEnd(18)} ${String(r.phone).padEnd(12)} ${r.book.padEnd(18)} ${rupees(r.amount).padStart(8)}  paid ${on}${r.isPaid ? '' : '  [flag not set]'}`)
  }
  console.log('')

  if (DRY) {
    console.log('Dry run — nothing was written. Drop --dry to apply.')
    return
  }

  let granted = 0
  const flagged = new Set()
  for (const r of real) {
    // Upsert, so a row added between the read and now is left alone.
    await prisma.userAccess.upsert({
      where: { userId_productId: { userId: r.userId, productId: r.productId } },
      update: {},
      create: {
        userId: r.userId,
        productId: r.productId,
        source: 'purchased',
        grantedOn: r.paidOn, // credit them from the day they actually paid
        expiresOn: null,     // purchased access never expires
      },
    })
    granted++

    if (!r.isPaid && !flagged.has(r.userId)) {
      await prisma.user.update({ where: { id: r.userId }, data: { isPaid: 1 } })
      flagged.add(r.userId)
    }
  }

  console.log(`✓ granted ${granted} book(s); set the paid flag on ${flagged.size} account(s).`)
  console.log('  Those devotees can now open what they paid for.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
