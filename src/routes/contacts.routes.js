// ── Contacts API (raw production table contact) ───────────────
// GET /api/contacts?query=&page=1&pageSize=50   (766 rows → paginated)
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { jsonSafe } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const query = String(req.query.query || '').trim()
  const page = Math.max(1, parseInt(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 50))
  const offset = (page - 1) * pageSize
  const like = `%${query}%`

  // LIMIT/OFFSET are validated integers (safe to inline); search is parameterised.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, name, email, mobile, message FROM contact
     WHERE name LIKE ? OR email LIKE ? OR message LIKE ?
     ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}`,
    like, like, like
  )
  const countRows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM contact WHERE name LIKE ? OR email LIKE ? OR message LIKE ?`,
    like, like, like
  )
  const total = Number(jsonSafe(countRows)[0].c)

  res.json({
    contacts: jsonSafe(rows),
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  })
})

export default router
