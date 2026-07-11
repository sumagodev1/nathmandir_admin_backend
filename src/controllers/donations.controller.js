// ── Donations controller (raw production table user_donation) ─
// Handler for /api/donations.
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe, paginate } from '../lib/helpers.js'

// GET /api/donations?page=&limit=
export async function list(req, res) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.userID AS userId, u.name AS userName, d.mobile,
            d.donation_normal_amt AS amount, d.createdAt
     FROM user_donation d
     LEFT JOIN users u ON u.id = CAST(d.userID AS UNSIGNED)
     ORDER BY d.createdAt DESC`
  )
  const donations = jsonSafe(rows).map((r) => ({
    id: r.id,
    userId: r.userId,
    user: r.userName || '',
    mobile: r.mobile || '',
    amount: Number(r.amount) || 0,
    date: ymd(r.createdAt),
  }))
  const pg = paginate(donations, req.query)
  res.json({
    donations: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
    totalAmount: donations.reduce((s, d) => s + d.amount, 0),
  })
}
