// ── Donations API (raw production table user_donation) ────────
// GET /api/donations
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd, jsonSafe } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
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
  res.json({
    donations,
    total: donations.length,
    totalAmount: donations.reduce((s, d) => s + d.amount, 0),
  })
})

export default router
