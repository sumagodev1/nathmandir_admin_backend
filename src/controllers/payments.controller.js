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
import { donationRows } from '../lib/donationSources.js'

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

  // Website and hand-entered (cash / bank) donations. The in-app ones already
  // arrive above as package 3 of user_payment, so only the website source is
  // added here — taking both would count those twice.
  const gifts = (await donationRows('/api/payments')).filter((g) => g.source === 'website')
  rows = rows.concat(
    gifts.map((g) => ({
      id: g.id,
      gateway: g.gateway,
      userId: null,
      user: g.name,
      mobile: g.mobile,
      module: 'Donation',
      kind: 'donation',
      amount: g.amount,
      txn: g.txn,
      ref: g.ref,
      // Only settled rows are read, so these are complete by definition — and
      // the word has to match what the Completed filter looks for.
      status: 'Completed',
      date: g.date,
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
