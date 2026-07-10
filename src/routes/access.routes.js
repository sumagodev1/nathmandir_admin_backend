// ── Access Control API ────────────────────────────────────────
// GET  /api/access               — access matrix (users × products)
// POST /api/access/grant         — grant a module { userId, productId, duration }
// POST /api/access/revoke        — revoke a module { userId, productId }
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd, accessLabel, grantExpiry } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

// GET /api/access?query=&from=&to=
router.get('/', async (req, res) => {
  const { query = '', from = '', to = '' } = req.query
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  const users = await prisma.user.findMany({ include: { access: true }, orderBy: { id: 'asc' } })

  const q = String(query).trim().toLowerCase()
  const rows = users
    .map((u) => {
      const access = {}
      for (const p of products) {
        const a = u.access.find((x) => x.productId === p.id)
        access[p.id] = {
          status: accessLabel(a), // subscribed | granted | none
          duration: a?.duration || null,
          expiresOn: a ? ymd(a.expiresOn) : null,
        }
      }
      return { id: u.id, name: u.name, phone: u.phone, city: u.city, registeredOn: ymd(u.registeredOn), access }
    })
    .filter((u) => {
      const matchQ =
        !q || u.name.toLowerCase().includes(q) || u.phone.includes(q) || u.city.toLowerCase().includes(q)
      const matchFrom = !from || (u.registeredOn && u.registeredOn >= from)
      const matchTo = !to || (u.registeredOn && u.registeredOn <= to)
      return matchQ && matchFrom && matchTo
    })

  res.json({ products: products.map((p) => ({ id: p.id, name: p.name })), users: rows })
})

// POST /api/access/grant   { userId, productId, duration: 'd7'|'d15'|'perm' }
router.post('/grant', async (req, res) => {
  const { userId, productId, duration = 'perm' } = req.body || {}
  if (!userId || !productId) return res.status(400).json({ error: 'userId and productId are required.' })

  const now = new Date()
  const payload = {
    source: 'granted',
    duration,
    grantedOn: now,
    expiresOn: grantExpiry(duration, now),
  }

  const access = await prisma.userAccess.upsert({
    where: { userId_productId: { userId: Number(userId), productId } },
    update: payload,
    create: { userId: Number(userId), productId, ...payload },
  })
  res.json({ ok: true, access: { ...access, expiresOn: ymd(access.expiresOn) } })
})

// POST /api/access/revoke   { userId, productId }
router.post('/revoke', async (req, res) => {
  const { userId, productId } = req.body || {}
  if (!userId || !productId) return res.status(400).json({ error: 'userId and productId are required.' })

  await prisma.userAccess.deleteMany({ where: { userId: Number(userId), productId } })
  res.json({ ok: true })
})

export default router
