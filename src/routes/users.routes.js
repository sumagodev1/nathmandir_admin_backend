// ── Users API ─────────────────────────────────────────────────
// GET   /api/users              — list (search + filter)
// GET   /api/users/:id          — profile + subscriptions/payments
// POST  /api/users              — create a user (optional access grants)
// PATCH /api/users/:id/status   — enable / disable
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd, shapeUserRow, grantExpiry } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth) // everything here requires login

// GET /api/users?query=&status=all|active|disabled&subscription=all|subscribed|free&from=&to=
router.get('/', async (req, res) => {
  const { query = '', status = 'all', subscription = 'all', from = '', to = '' } = req.query

  const users = await prisma.user.findMany({
    include: { access: true, sales: true },
    orderBy: { id: 'asc' },
  })

  const q = String(query).trim().toLowerCase()
  const rows = users.map(shapeUserRow).filter((u) => {
    const matchQ =
      !q || u.name.toLowerCase().includes(q) || u.phone.includes(q) || u.city.toLowerCase().includes(q)
    const matchS = status === 'all' || (status === 'active' ? u.status === 'active' : u.status === 'disabled')
    const matchSub =
      subscription === 'all' || (subscription === 'subscribed' ? u.subscribed : !u.subscribed)
    const matchFrom = !from || (u.registeredOn && u.registeredOn >= from)
    const matchTo = !to || (u.registeredOn && u.registeredOn <= to)
    return matchQ && matchS && matchSub && matchFrom && matchTo
  })

  res.json({ users: rows, total: rows.length })
})

// GET /api/users/:id
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id.' })

  const u = await prisma.user.findUnique({
    where: { id },
    include: { access: { include: { product: true } }, sales: { include: { product: true } } },
  })
  if (!u) return res.status(404).json({ error: 'User not found.' })

  // One row per access grant, joined with the matching purchase (if any).
  const subscriptions = u.access.map((a) => {
    const sale = u.sales.find((s) => s.productId === a.productId)
    return {
      product: a.productId,
      name: a.product.name,
      amount: sale ? sale.amount : a.product.price,
      date: sale ? ymd(sale.createdAt) : null,
      txn: sale ? sale.txnId : null,
      ref: sale ? sale.ref : null,
      source: a.source === 'purchased' ? 'Purchased' : 'Granted',
    }
  })

  res.json({ user: { ...shapeUserRow(u), subscriptions } })
})

// POST /api/users   body: { name, phone, city, access?: [{ productId, duration }] }
router.post('/', async (req, res) => {
  const { name, phone, city, access = [] } = req.body || {}
  if (!name?.trim() || !phone?.trim() || !city?.trim()) {
    return res.status(400).json({ error: 'Name, phone and city are required.' })
  }

  const now = new Date()
  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      phone: phone.trim(),
      city: city.trim(),
      access: {
        create: access.map((a) => {
          const duration = a.duration || 'perm'
          return {
            productId: a.productId,
            source: 'granted',
            duration,
            grantedOn: now,
            expiresOn: grantExpiry(duration, now),
          }
        }),
      },
    },
    include: { access: true, sales: true },
  })

  res.status(201).json({ user: shapeUserRow(user) })
})

// PATCH /api/users/:id/status   body optional { status: 'active'|'disabled' }; otherwise toggles
router.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id.' })

  const u = await prisma.user.findUnique({ where: { id } })
  if (!u) return res.status(404).json({ error: 'User not found.' })

  const next = req.body?.status || (u.status === 'active' ? 'disabled' : 'active')
  const updated = await prisma.user.update({ where: { id }, data: { status: next } })
  res.json({ id: updated.id, status: updated.status })
})

export default router
