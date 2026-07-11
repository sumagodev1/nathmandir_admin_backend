// ── App Logins controller (raw production table login_user) ───
// Handler for /api/logins.
import { prisma } from '../lib/prisma.js'
import { jsonSafe, paginate } from '../lib/helpers.js'

// GET /api/logins?query=&page=&limit=   — mobile + device_id from the mobile app
export async function list(req, res) {
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

  const pg = paginate(logins, req.query)
  res.json({ logins: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}
