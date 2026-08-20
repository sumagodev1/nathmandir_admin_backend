// ── Products / Modules controller ─────────────────────────────
// Handlers for /api/products.
//
// A product now has a numeric surrogate `id` (what every foreign key points
// at) and a stable public `code` such as "gita1". Both are returned, and
// :id params accept either form — see lib/products.js.
import { prisma } from '../lib/prisma.js'

// A price is whole rupees, zero or more. `Number(x) || 0` was doing the
// checking, which turned a typo into a free book: "abc" became 0 and the
// module was given away with no warning at all. Negatives were stored as-is,
// and 99.99 was silently truncated to 99.
const MAX_PRICE = 1_000_000
function readPrice(raw) {
  const n = Number(raw)
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(n)) {
    return { error: 'Enter a price in rupees.' }
  }
  if (n < 0) return { error: 'Price cannot be negative.' }
  if (!Number.isInteger(n)) return { error: 'Price must be a whole number of rupees.' }
  if (n > MAX_PRICE) return { error: `Price cannot be more than ${MAX_PRICE.toLocaleString('en-IN')}.` }
  return { value: n }
}
import { resolveProductId, uniqueCode } from '../lib/products.js'

// GET /api/products   — all modules (gita1, gita2, upasana, nithya…)
export async function list(req, res) {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  res.json({ products })
}

// POST /api/products   — add a module/part { name, price, shortName?, code? }
export async function create(req, res) {
  const { name, price = 0, shortName, code } = req.body || {}
  const created = readPrice(price)
  if (created.error) return res.status(400).json({ error: created.error })
  if (!name?.trim()) return res.status(400).json({ error: 'Product name is required.' })

  // `id` is auto-increment now; only the public code is derived from the name.
  const existing = await prisma.product.findMany({ select: { code: true } })
  const newCode = uniqueCode(code || name, existing.map((p) => p.code))

  const product = await prisma.product.create({
    data: {
      code: newCode,
      name: name.trim(),
      shortName: shortName?.trim() || name.trim(),
      price: created.value,
    },
  })

  // The default sections are NOT created here. The Add Content form offers
  // them for every Part whether they exist or not, and creates one the first
  // time it is actually used — so a Part that only ever uses सकाळ never grows
  // an empty संध्याकाळ beside it.
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
  if (price !== undefined) {
    const p = readPrice(price)
    if (p.error) return res.status(400).json({ error: p.error })
    data.price = p.value
  }
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
