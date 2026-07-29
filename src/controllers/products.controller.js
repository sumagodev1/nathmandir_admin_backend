// ── Products / Modules controller ─────────────────────────────
// Handlers for /api/products.
import { prisma } from '../lib/prisma.js'
import { slugify } from '../lib/helpers.js'

// GET /api/products   — all modules (gita1, gita2, upasana, nithya…)
export async function list(req, res) {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  res.json({ products })
}

// POST /api/products   — add a module/part { name, price, shortName? }
export async function create(req, res) {
  const { name, price = 0, shortName } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Product name is required.' })

  const existing = await prisma.product.findMany({ select: { id: true } })
  const id = slugify(name, existing.map((p) => p.id))

  const product = await prisma.product.create({
    data: { id, name: name.trim(), shortName: shortName?.trim() || name.trim(), price: Number(price) || 0 },
  })
  res.status(201).json({ product })
}

// PATCH /api/products/:id   — update name / price / active (Settings pricing)
export async function update(req, res) {
  const { name, price, shortName, active } = req.body || {}
  const data = {}
  if (name !== undefined) data.name = String(name).trim()
  if (shortName !== undefined) data.shortName = String(shortName).trim()
  if (price !== undefined) data.price = Number(price) || 0
  if (active !== undefined) data.active = !!active

  try {
    const product = await prisma.product.update({ where: { id: req.params.id }, data })
    res.json({ product })
  } catch {
    res.status(404).json({ error: 'Product not found.' })
  }
}

// DELETE /api/products/:id  — remove a part and all its content
// Blocked if the part has purchase records (sales/access) to preserve history.
export async function remove(req, res) {
  const id = req.params.id
  const [salesCount, accessCount] = await Promise.all([
    prisma.sale.count({ where: { productId: id } }),
    prisma.userAccess.count({ where: { productId: id } }),
  ])

  if (salesCount > 0 || accessCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: this Part has ${salesCount} purchase record(s) and ${accessCount} subscriber(s). Deactivate it instead using the Edit button.`,
    })
  }

  try {
    await prisma.product.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Part not found.' })
  }
}
