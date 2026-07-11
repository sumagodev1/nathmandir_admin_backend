// ── Payments controller (raw production tables) ───────────────
// Merges Razorpay (user_payment) + legacy Instamojo (userpayment).
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe, paginate } from '../lib/helpers.js'

const PKG = { 1: 'Gitanjali Part 1', 2: 'Gitanjali Part 2', 3: 'Donation', 4: 'Upasana Part', 5: 'Nityaniyam Part' }

// GET /api/payments?gateway=all|razorpay|instamojo&status=&query=&page=&limit=
export async function list(req, res) {
  const { gateway = 'all', status = 'all', query = '' } = req.query

  const razor = await prisma.$queryRawUnsafe(
    `SELECT up.id, up.user_id AS userId, u.name AS userName, up.package_id AS packageId,
            up.amount, up.razorpay_order_id AS orderId, up.razorpay_payment_id AS paymentId,
            up.razorpay_stageOfPayment AS stage, up.payment_type AS ptype, up.created_at AS createdAt
     FROM user_payment up LEFT JOIN users u ON u.id = up.user_id
     ORDER BY up.created_at DESC`
  )
  const insta = await prisma.$queryRawUnsafe(
    `SELECT id, userId, name AS userName, mobile, donation_for AS donationFor, amt AS amount,
            order_id AS orderId, transaction_id AS paymentId, payment_status AS stage, createAt AS createdAt
     FROM userpayment ORDER BY createAt DESC`
  )

  let rows = [
    ...jsonSafe(razor).map((r) => ({
      id: 'R' + r.id,
      gateway: 'Razorpay',
      userId: r.userId,
      user: r.userName || '',
      module: PKG[r.packageId] || `Package ${r.packageId}`,
      amount: Number(r.amount) || 0,
      txn: r.paymentId || '',
      ref: r.orderId || '',
      status: r.stage || '',
      date: ymd(r.createdAt),
    })),
    ...jsonSafe(insta).map((r) => ({
      id: 'I' + r.id,
      gateway: 'Instamojo',
      userId: r.userId,
      user: r.userName || '',
      module: r.donationFor === '1' ? 'Audio' : '—',
      amount: Number(r.amount) || 0,
      txn: r.paymentId && r.paymentId !== 'None' ? r.paymentId : '',
      ref: r.orderId || '',
      status: r.stage || '',
      date: ymd(r.createdAt),
    })),
  ]

  const q = String(query).trim().toLowerCase()
  rows = rows
    .filter((r) => gateway === 'all' || r.gateway.toLowerCase() === gateway)
    .filter((r) => {
      if (status === 'all') return true
      if (status === 'completed') return /completed|credit/i.test(r.status)
      return !/completed|credit/i.test(r.status) // pending / started / failed
    })
    .filter((r) => !q || r.user.toLowerCase().includes(q) || r.txn.toLowerCase().includes(q) || r.module.toLowerCase().includes(q))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  const completed = rows.filter((r) => /completed|credit/i.test(r.status))
  const pg = paginate(rows, req.query)
  res.json({
    payments: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
    completedCount: completed.length,
    completedAmount: completed.reduce((s, r) => s + r.amount, 0),
  })
}
