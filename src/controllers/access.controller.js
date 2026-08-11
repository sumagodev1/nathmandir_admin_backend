// ── Access Control controller ─────────────────────────────────
// Handlers for /api/access (access matrix, grant, revoke).
import { prisma } from '../lib/prisma.js'
import { ymd, accessLabel, grantExpiry, paginate } from '../lib/helpers.js'
import { resolveProductId } from '../lib/products.js'

// GET /api/access?query=&from=&to=&page=&limit=  — access matrix (users × products)
export async function list(req, res) {
  const { query = '', from = '', to = '' } = req.query
  // Products stay ascending — they are the matrix's columns, and the sidebar
  // and every other screen list the Parts in that same order.
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  // Users newest first, matching the Users screen. A devotee who just bought
  // access sat on the last page here while appearing at the top there.
  const users = await prisma.user.findMany({ include: { access: true }, orderBy: { id: 'desc' } })

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

  const pg = paginate(rows, req.query)
  res.json({
    products: products.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    users: pg.data,
    total: pg.total,
    page: pg.page,
    pages: pg.pages,
    limit: pg.limit,
  })
}

// POST /api/access/grant   { userId, productId, duration: 'd7'|'d15'|'perm' }
export async function grant(req, res) {
  const { userId, productId, duration = 'perm' } = req.body || {}
  if (!userId || !productId) return res.status(400).json({ error: 'userId and productId are required.' })

  // productId may arrive as the numeric id or the public code.
  const pid = await resolveProductId(productId)
  if (pid === null) return res.status(404).json({ error: 'Unknown Part.' })

  const now = new Date()
  const payload = {
    source: 'granted',
    duration,
    grantedOn: now,
    expiresOn: grantExpiry(duration, now),
  }

  const access = await prisma.userAccess.upsert({
    where: { userId_productId: { userId: Number(userId), productId: pid } },
    update: payload,
    create: { userId: Number(userId), productId: pid, ...payload },
  })
  res.json({ ok: true, access: { ...access, expiresOn: ymd(access.expiresOn) } })
}

// POST /api/access/revoke   { userId, productId }
export async function revoke(req, res) {
  const { userId, productId } = req.body || {}
  if (!userId || !productId) return res.status(400).json({ error: 'userId and productId are required.' })

  const pid = await resolveProductId(productId)
  if (pid === null) return res.status(404).json({ error: 'Unknown Part.' })

  await prisma.userAccess.deleteMany({ where: { userId: Number(userId), productId: pid } })
  res.json({ ok: true })
}
