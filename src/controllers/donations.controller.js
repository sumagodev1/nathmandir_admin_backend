// ── Donations controller ──────────────────────────────────────
// Merges two sources:
//   • user_donation — legacy in-app donations (linked to a user row)
//   • donation      — new website Razorpay donations (donor details inline)
// Handler for /api/donations.
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe, paginate } from '../lib/helpers.js'

const CATEGORY_LABEL = {
  'temple-development': 'Temple Development',
  annadan: 'Annadan (Mahaprasad)',
  'festival-support': 'Festival Support',
  general: 'General Donation',
}

// GET /api/donations?page=&limit=
export async function list(req, res) {
  // Legacy in-app donations.
  const appRows = await prisma.$queryRawUnsafe(
    `SELECT d.id, d.userID AS userId, u.name AS userName, d.mobile,
            d.donation_normal_amt AS amount, d.createdAt
     FROM user_donation d
     LEFT JOIN users u ON u.id = CAST(d.userID AS UNSIGNED)
     ORDER BY d.createdAt DESC`
  )
  // New website Razorpay donations (successful only).
  const webRows = await prisma.$queryRawUnsafe(
    `SELECT id, name, mobile, amount, category, razorpay_payment_id AS paymentId, created_at AS createdAt
     FROM donation WHERE status = '1' ORDER BY created_at DESC`
  )

  const donations = [
    ...jsonSafe(appRows).map((r) => ({
      id: 'A' + r.id,
      gateway: 'App',
      userId: r.userId,
      user: r.userName || '',
      mobile: r.mobile || '',
      category: '',
      amount: Number(r.amount) || 0,
      txn: '',
      date: ymd(r.createdAt),
    })),
    ...jsonSafe(webRows).map((r) => ({
      id: 'W' + r.id,
      gateway: 'Website',
      userId: null,
      user: r.name || '',
      mobile: r.mobile || '',
      category: CATEGORY_LABEL[r.category] || r.category || '',
      amount: Number(r.amount) || 0,
      txn: r.paymentId || '',
      date: ymd(r.createdAt),
    })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

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
