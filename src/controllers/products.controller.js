// ── Products / Modules controller ─────────────────────────────
// Handlers for /api/products.
//
// A product now has a numeric surrogate `id` (what every foreign key points
// at) and a stable public `code` such as "gita1". Both are returned, and
// :id params accept either form — see lib/products.js.
import { prisma } from '../lib/prisma.js'
import { resolveProductId, uniqueCode } from '../lib/products.js'

// GET /api/products   — all modules (gita1, gita2, upasana, nithya…)
export async function list(req, res) {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  res.json({ products })
}

// POST /api/products   — add a module/part { name, price, shortName?, code? }
export async function create(req, res) {
  const { name, price = 0, shortName, code } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Product name is required.' })

  // `id` is auto-increment now; only the public code is derived from the name.
  const existing = await prisma.product.findMany({ select: { code: true } })
  const newCode = uniqueCode(code || name, existing.map((p) => p.code))

  const product = await prisma.product.create({
    data: {
      code: newCode,
      name: name.trim(),
      shortName: shortName?.trim() || name.trim(),
      price: Number(price) || 0,
    },
  })
  res.status(201).json({ product })
}

// PATCH /api/products/:id   — update name / price / active (Settings pricing)
export async function update(req, res) {
  const id = await resolveProductId(req.params.id)
  if (id === null) return res.status(404).json({ error: 'Product not found.' })

  const { name, price, shortName, active } = req.body || {}
  const data = {}
  if (name !== undefined) data.name = String(name).trim()
  if (shortName !== undefined) data.shortName = String(shortName).trim()
  if (price !== undefined) data.price = Number(price) || 0
  if (active !== undefined) data.active = !!active

  try {
    const product = await prisma.product.update({ where: { id }, data })
    res.json({ product })
  } catch {
    res.status(404).json({ error: 'Product not found.' })
  }
}

// DELETE /api/products/:id  — remove a part and all its content
// Blocked if the part has purchase records (sales) or active access grants.
// Expired grants (7d/15d) are not counted — only current active subscribers block deletion.
export async function remove(req, res) {
  const id = await resolveProductId(req.params.id)
  if (id === null) return res.status(404).json({ error: 'Part not found.' })

  const now = new Date()
  const [salesCount, accessCount] = await Promise.all([
    prisma.sale.count({ where: { productId: id } }),
    prisma.userAccess.count({
      where: {
        productId: id,
        OR: [
          { expiresOn: null },        // permanent (purchases + permanent grants)
          { expiresOn: { gt: now } }, // not yet expired (7d / 15d grants still active)
        ],
      },
    }),
  ])

  if (salesCount > 0 || accessCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: this Part has ${salesCount} purchase record(s) and ${accessCount} active subscriber(s). Deactivate it instead using the Edit button.`,
    })
  }

  try {
    await prisma.product.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Part not found.' })
  }
}
