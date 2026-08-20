// ── Payments controller (raw production table) ────────────────
// Reads `user_payment` and nothing else.
//
// There is a second, near-identically named table, `userpayment`. It held
// Instamojo donations, stopped being written in Dec 2021, and is not a
// trustworthy ledger: 60 of its 131 rows carry a blank amount and 21 point at
// user ids that no longer exist. It used to be merged in here, which is why
// this screen and the Donations screen never agreed. It is now excluded
// everywhere — the rows stay in the database as history.
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe, paginate } from '../lib/helpers.js'

const PKG = { 1: 'Gitanjali Part 1', 2: 'Gitanjali Part 2', 3: 'Donation', 4: 'Upasana Part', 5: 'Nityaniyam Part' }

// Package 3 is a donation; the rest are books. Splitting on this is what lets
// the total be explained rather than just asserted.
const BOOK_PACKAGES = new Set([1, 2, 4, 5])

// `user_payment` spans both gateways — it survived the 2022 switch and only
// its order-id format and status wording changed. Labelling every row
// "Razorpay" hid that, so the pre-2022 payments are named for the gateway that
// actually took them: an Instamojo order id starts MOJO…, and `Credit` was
// Instamojo's word for settled (Razorpay says `Completed`).
const gatewayOf = (orderId, stage) =>
  /^MOJO/i.test(orderId || '') || /^credit$/i.test(stage || '') ? 'Instamojo' : 'Razorpay'

// GET /api/payments?gateway=all|razorpay|instamojo&status=&query=&page=&limit=
export async function list(req, res) {
  const { gateway = 'all', status = 'all', query = '' } = req.query

  const razor = await prisma.$queryRawUnsafe(
    `SELECT up.id, up.user_id AS userId,
            -- The account name when there is one, otherwise what was typed on
            -- the checkout form. A row with no user_id is a payment that never
            -- completed, and it used to display as "#" with no mobile.
            COALESCE(u.name, up.buyer_name) AS userName,
            COALESCE(u.phone, up.buyer_mobile) AS userMobile,
            up.package_id AS packageId,
            up.amount, up.razorpay_order_id AS orderId, up.razorpay_payment_id AS paymentId,
            up.razorpay_stageOfPayment AS stage, up.payment_type AS ptype, up.created_at AS createdAt
     FROM user_payment up LEFT JOIN users u ON u.id = up.user_id
     ORDER BY up.created_at DESC`
  )
  // Website and hand-entered (cash / bank) donations live in their own table,
  // so a donation taken on the site or typed in by an admin showed on the
  // Donations screen and nowhere else — not here, not on the dashboard.
  //
  // Read defensively: `donation` is a legacy raw table outside the Prisma
  // schema, and a missing one must not take the whole payments list down.
  let gifts = []
  try {
    gifts = await prisma.$queryRawUnsafe(
      `SELECT id, name, mobile, amount, category, razorpay_payment_id AS paymentId,
              razorpay_order_id AS orderId, mode, txn_ref AS txnRef, created_at AS createdAt
         FROM donation WHERE status = '1' ORDER BY created_at DESC`
    )
  } catch (err) {
    console.error(`⚠️  /api/payments: skipping website donations — ${String(err.message).replace(/\s+/g, ' ').trim().slice(0, 160)}`)
  }

  // An offline row has no gateway — say how the money actually arrived, so a
  // cash donation is not mistaken for a card payment.
  const MODE_LABEL = { online: 'Website', cash: 'Cash', bank: 'Bank Transfer' }

  let rows = jsonSafe(razor).map((r) => ({
    id: 'R' + r.id,
    gateway: gatewayOf(r.orderId, r.stage),
    userId: r.userId,
    user: r.userName || '',
    mobile: r.userMobile || '',
    module: PKG[r.packageId] || `Package ${r.packageId}`,
    kind: BOOK_PACKAGES.has(Number(r.packageId)) ? 'book' : 'donation',
    amount: Number(r.amount) || 0,
    txn: r.paymentId || '',
    ref: r.orderId || '',
    status: r.stage || '',
    date: ymd(r.createdAt),
  }))

  rows = rows.concat(
    jsonSafe(gifts).map((g) => ({
      id: 'D' + g.id,
      gateway: MODE_LABEL[g.mode] || 'Website',
      userId: null,
      user: g.name || '',
      mobile: g.mobile || '',
      module: 'Donation',
      kind: 'donation',
      amount: Number(g.amount) || 0,
      txn: g.paymentId || g.txnRef || '',
      ref: g.orderId || '',
      // Only settled rows are read above, so these are complete by definition —
      // and the word has to match what the Completed filter looks for.
      status: 'Completed',
      date: ymd(g.createdAt),
    }))
  )

  const q = String(query).trim().toLowerCase()
  rows = rows
    .filter((r) => gateway === 'all' || r.gateway.toLowerCase() === gateway)
    .filter((r) => {
      if (status === 'all') return true
      if (status === 'completed') return /completed|credit/i.test(r.status)
      return !/completed|credit/i.test(r.status) // pending / started / failed
    })
    .filter((r) => !q || r.user.toLowerCase().includes(q) || r.mobile.toLowerCase().includes(q) || r.txn.toLowerCase().includes(q) || r.module.toLowerCase().includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const completed = rows.filter((r) => /completed|credit/i.test(r.status))
  // Books and donations, counted separately and then added up. The dashboard
  // headline is the same number, so the two screens can be compared directly
  // instead of leaving the reader to guess why they differ.
  const tally = (list) => ({ count: list.length, amount: list.reduce((s, r) => s + r.amount, 0) })
  const breakdown = {
    books: tally(completed.filter((r) => r.kind === 'book')),
    donations: tally(completed.filter((r) => r.kind === 'donation')),
    total: tally(completed),
  }

  const pg = paginate(rows, req.query)
  res.json({
    payments: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
    completedCount: completed.length,
    completedAmount: breakdown.total.amount,
    breakdown,
  })
}
