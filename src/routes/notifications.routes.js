// ── Notifications API ─────────────────────────────────────────
// GET  /api/notifications?query=&from=&to=  — history
// POST /api/notifications                   — send { title, message, audience }
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

const shape = (n) => ({
  id: n.id,
  title: n.title,
  message: n.message,
  audience: n.audience,
  reach: n.reach,
  sentOn: ymd(n.sentOn),
})

router.get('/', async (req, res) => {
  const { query = '', from = '', to = '' } = req.query
  const rows = await prisma.notification.findMany({ orderBy: { sentOn: 'desc' } })

  const q = String(query).trim().toLowerCase()
  const list = rows.map(shape).filter((n) => {
    const matchQ =
      !q || n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q) || n.audience.toLowerCase().includes(q)
    const matchFrom = !from || n.sentOn >= from
    const matchTo = !to || n.sentOn <= to
    return matchQ && matchFrom && matchTo
  })

  res.json({ notifications: list, total: list.length })
})

router.post('/', async (req, res) => {
  const { title, message, audience = 'all' } = req.body || {}
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Title and message are required.' })
  }

  // Estimate reach: 'all' = every user, else users who own that product.
  let reach
  if (audience === 'all') {
    reach = await prisma.user.count()
  } else {
    reach = await prisma.userAccess.count({ where: { productId: audience } })
  }

  const created = await prisma.notification.create({
    data: { title: title.trim(), message: message.trim(), audience, reach },
  })
  res.status(201).json({ notification: shape(created) })
})

export default router
