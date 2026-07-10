// ── App Logins API (raw production table login_user) ──────────
// GET /api/logins?query=   — mobile + device_id from the mobile app
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { jsonSafe } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  // Raw fetch only (no cross-charset JOIN — login_user is latin1, users is utf8mb4).
  const rows = await prisma.$queryRawUnsafe(
    `SELECT login_user_id AS id, CAST(mobile AS CHAR) AS mobile, device_id AS deviceId
     FROM login_user ORDER BY login_user_id DESC`
  )
  // Match to a user name by phone, in JS.
  const users = await prisma.user.findMany({ select: { phone: true, name: true } })
  const nameByPhone = new Map(users.map((u) => [u.phone, u.name]))

  const q = String(req.query.query || '').trim().toLowerCase()
  const logins = jsonSafe(rows)
    .map((r) => ({
      id: r.id,
      mobile: r.mobile || '',
      deviceId: r.deviceId || '',
      user: nameByPhone.get(r.mobile) || '',
    }))
    .filter((r) => !q || r.mobile.includes(q) || r.deviceId.toLowerCase().includes(q) || r.user.toLowerCase().includes(q))

  res.json({ logins, total: logins.length })
})

export default router
