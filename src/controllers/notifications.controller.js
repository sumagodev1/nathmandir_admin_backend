// ── Notifications controller ──────────────────────────────────
// Handlers for /api/notifications.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

const shape = (n) => ({
  id: n.id,
  title: n.title,
  message: n.message,
  audience: n.audience,
  reach: n.reach,
  sentOn: ymd(n.sentOn),
})

// GET /api/notifications?query=&from=&to=&page=&limit=  — history
export async function list(req, res) {
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

  const pg = paginate(list, req.query)
  res.json({ notifications: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}

// POST /api/notifications  — send { title, message, audience }
export async function create(req, res) {
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
}
