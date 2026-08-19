// ── Check (and repair) sales against the legacy payment table ─
// The dashboard reads revenue from `sales`. `sales` was built from the legacy
// `user_payment` table, using `razorpay_payment_id` as the unique `txn_id`.
//
// A payment counts as real money ONLY when razorpay_stageOfPayment is
// 'Completed'. The other stages in the legacy data are not sales:
//
//   Started   — checkout opened, never paid (874 rows)
//   Credit    — pre-Razorpay Instamojo era, 2020-06 to 2021-12, no payment id
//   Failed    — payment declined
//
// Under that rule `sales` currently matches the legacy table exactly, so this
// script normally reports nothing to do. It stays in the repo as a check: run
// it any time to prove the dashboard total still equals the payment records.
//
// Package 3 is "Donation", not a book sale, so it is excluded from revenue.
//
// Nothing is ever updated or deleted. Only genuinely missing rows are inserted.
//
//   node scripts/backfill-missing-sales.js --dry
//   node scripts/backfill-missing-sales.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const DRY = process.argv.includes('--dry')
const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN')

// Legacy package ids → products.code. Package 3 ("donation") is absent on
// purpose: a donation is not product revenue.
const PACKAGE_CODE = { 1: 'gita1', 2: 'gita2', 4: 'upasana', 5: 'nithya' }

// Stages that mean "this money actually arrived".
//   Completed — paid through Razorpay (the current gateway)
//   Credit    — paid through Instamojo (the old gateway, 2020-06 → 2021-12)
// 'Started' and 'Failed' are excluded: no money changed hands.
const PAID_STAGES = ['Completed', 'Credit']

// Instamojo rows carry no razorpay_payment_id, so record the real gateway.
const gatewayFor = (stage) => (stage === 'Credit' ? 'instamojo' : 'razorpay')

const stageList = PAID_STAGES.map((s) => `'${s}'`).join(', ')

// Nothing is excluded any more.
//
// The old PHP report (freport.php) filtered on `u.isPaid = '1'` — a flag on
// the PERSON, never on the payment. Two people paid for Part 2 and were never
// flagged, so their money silently vanished from that report:
//
//   payment 382 — ₹251   Anagha (user 65)
//   payment 425 — ₹1,039 Makarand Thatte (user 178)
//
// Both had paid and neither had access. The flag was the bug, not the money,
// so both are counted here. See scripts/grant-access-to-payers.js, which hands
// those people the books they paid for.
const EXCLUDE_IDS = [-1] // none; keeps the SQL `NOT IN (...)` valid

async function main() {
  const products = await prisma.product.findMany({ select: { id: true, code: true, name: true } })
  const productByCode = new Map(products.map((p) => [p.code, p]))

  // Say out loud what is being left out, every single run.
  const skipped = await prisma.$queryRawUnsafe(
    `SELECT p.id, p.amount, p.created_at, u.name
       FROM user_payment p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.id IN (${EXCLUDE_IDS.join(',')})`
  )
  if (skipped.length) {
    console.log('Deliberately NOT counted (matches the old PHP report):')
    for (const s of skipped) {
      const on = s.created_at ? new Date(s.created_at).toISOString().slice(0, 10) : '?'
      console.log(`  payment #${s.id}  ${rupees(s.amount)}  ${on}  ${s.name ?? '?'}`)
    }
    console.log('')
  }

  // What the legacy table says was genuinely paid, per product.
  const expected = await prisma.$queryRawUnsafe(
    `SELECT package_id, COUNT(*) AS rows_, SUM(amount + 0) AS amt
       FROM user_payment
      WHERE razorpay_stageOfPayment IN (${stageList})
        AND package_id IN (1, 2, 4, 5)
        AND id NOT IN (${EXCLUDE_IDS.join(',')})
      GROUP BY package_id ORDER BY package_id`
  )
  console.log(`Legacy payments with stage ${stageList}:\n`)
  let expTotal = 0
  for (const e of expected) {
    const name = productByCode.get(PACKAGE_CODE[e.package_id])?.name ?? PACKAGE_CODE[e.package_id]
    console.log(`  ${name.padEnd(20)} ${String(e.rows_).padStart(3)} rows  ${rupees(e.amt)}`)
    expTotal += Number(e.amt)
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${String(expected.reduce((n, e) => n + Number(e.rows_), 0)).padStart(3)} rows  ${rupees(expTotal)}\n`)

  const [{ rows_: saleRows, amt: saleAmt }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS rows_, COALESCE(SUM(amount), 0) AS amt FROM sales WHERE status = 'success'`
  )
  console.log(`Dashboard (sales table): ${saleRows} rows  ${rupees(saleAmt)}\n`)

  // Anything paid that never reached `sales`. Users are joined so a payment by
  // a deleted account is skipped rather than breaking the foreign key.
  const missing = await prisma.$queryRawUnsafe(
    `SELECT p.id, p.user_id, p.package_id, p.amount, p.razorpay_order_id,
            p.created_at, p.razorpay_stageOfPayment AS stage
       FROM user_payment p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN sales s
              ON s.txn_id = p.razorpay_payment_id
              OR s.txn_id = CONCAT('legacy:up:', p.id)
      WHERE p.razorpay_stageOfPayment IN (${stageList})
        AND p.package_id IN (1, 2, 4, 5)
        AND p.id NOT IN (${EXCLUDE_IDS.join(',')})
        AND s.id IS NULL
      ORDER BY p.id`
  )

  if (!missing.length) {
    console.log('✓ Nothing missing — every paid payment is already in sales.')
    return
  }

  const perProduct = new Map()
  for (const r of missing) {
    const code = PACKAGE_CODE[r.package_id]
    const cur = perProduct.get(code) || { rows: 0, amount: 0 }
    cur.rows += 1
    cur.amount += Number(r.amount) || 0
    perProduct.set(code, cur)
  }
  console.log(`Found ${missing.length} completed payments missing from sales:\n`)
  let grand = 0
  for (const [code, v] of perProduct) {
    console.log(`  ${(productByCode.get(code)?.name ?? code).padEnd(20)} ${String(v.rows).padStart(3)} rows  ${rupees(v.amount)}`)
    grand += v.amount
  }
  console.log('')

  if (DRY) {
    console.log('Dry run — nothing was written. Drop --dry to apply.')
    return
  }

  let inserted = 0
  for (const r of missing) {
    const product = productByCode.get(PACKAGE_CODE[r.package_id])
    if (!product) continue // product removed since the migration
    await prisma.sale.create({
      data: {
        txnId: `legacy:up:${r.id}`,
        userId: r.user_id,
        productId: product.id,
        amount: Number(r.amount) || 0,
        status: 'success',
        ref: r.razorpay_order_id || null,
        gateway: gatewayFor(r.stage),
        createdAt: r.created_at,
      },
    })
    inserted++
  }
  console.log(`✓ inserted ${inserted} sales rows, recovering ${rupees(grand)}.`)
  console.log('  No existing row was changed. Reload the dashboard to see the new total.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
