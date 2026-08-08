// ── Users controller ──────────────────────────────────────────
// Handlers for /api/users.
import { prisma } from '../lib/prisma.js'
import { ymd, shapeUserRow, grantExpiry, paginate } from '../lib/helpers.js'
import { resolveProductId } from '../lib/products.js'

// GET /api/users?query=&status=all|active|disabled&subscription=all|subscribed|free&from=&to=&page=&limit=
export async function list(req, res) {
  const { query = '', status = 'all', subscription = 'all', from = '', to = '' } = req.query

  // Newest first: the admin screen is used to check who just registered or
  // just bought, and ascending order buried them on the last page (a devotee
  // who purchased today sat at #493 of 521 — page 50 at the panel's 10/page).
  // Ordering by id rather than created_at because id is the primary key and
  // some legacy rows carry an imported created_at that predates their row.
  const users = await prisma.user.findMany({
    include: { access: true, sales: true },
    orderBy: { id: 'desc' },
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

  const pg = paginate(rows, req.query)
  res.json({ users: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}

// GET /api/users/:id   — profile + subscriptions/payments
export async function get(req, res) {
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
      productCode: a.product.code,
      name: a.product.name,
      amount: sale ? sale.amount : a.product.price,
      date: sale ? ymd(sale.createdAt) : null,
      txn: sale ? sale.txnId : null,
      ref: sale ? sale.ref : null,
      source: a.source === 'purchased' ? 'Purchased' : 'Granted',
    }
  })

  res.json({ user: { ...shapeUserRow(u), subscriptions } })
}

// POST /api/users   body: { name, phone, city, access?: [{ productId, duration }] }
export async function create(req, res) {
  const { name, phone, city, access = [] } = req.body || {}
  if (!name?.trim() || !phone?.trim() || !city?.trim()) {
    return res.status(400).json({ error: 'Name, phone and city are required.' })
  }

  const now = new Date()

  // access[].productId may be a numeric id or a public code; resolve first so
  // an unknown Part fails loudly instead of writing a dangling row.
  const resolved = []
  for (const a of access) {
    const pid = await resolveProductId(a.productId)
    if (pid === null) return res.status(400).json({ error: `Unknown Part: ${a.productId}` })
    resolved.push({ ...a, productId: pid })
  }

  const user = await prisma.user.create({
    data: {
      name: name.trim(),
      phone: phone.trim(),
      city: city.trim(),
      access: {
        create: resolved.map((a) => {
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
}

// PATCH /api/users/:id   body: { name?, phone?, city?, email?, address? }
export async function update(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id.' })

  const u = await prisma.user.findUnique({ where: { id } })
  if (!u) return res.status(404).json({ error: 'User not found.' })

  const { name, phone, city, email, address } = req.body || {}
  const data = {}
  if (name !== undefined) {
    const n = String(name).trim()
    if (!n) return res.status(400).json({ error: 'Name cannot be empty.' })
    data.name = n
  }
  if (phone !== undefined) {
    const p = String(phone).trim()
    if (!p) return res.status(400).json({ error: 'Phone cannot be empty.' })
    data.phone = p
  }
  if (city !== undefined) {
    const c = String(city).trim()
    if (!c) return res.status(400).json({ error: 'City cannot be empty.' })
    data.city = c
  }
  if (email !== undefined) data.email = String(email).trim()
  if (address !== undefined) data.address = String(address).trim()

  const updated = await prisma.user.update({
    where: { id },
    data,
    include: { access: true, sales: true },
  })
  res.json({ user: shapeUserRow(updated) })
}

// PATCH /api/users/:id/status   body optional { status: 'active'|'disabled' }; otherwise toggles
export async function updateStatus(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid user id.' })

  const u = await prisma.user.findUnique({ where: { id } })
  if (!u) return res.status(404).json({ error: 'User not found.' })

  const next = req.body?.status || (u.status === 'active' ? 'disabled' : 'active')
  const updated = await prisma.user.update({ where: { id }, data: { status: next } })
  res.json({ id: updated.id, status: updated.status })
}
