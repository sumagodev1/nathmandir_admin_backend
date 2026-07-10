// ── Products / Modules API ────────────────────────────────────
// GET   /api/products        — all modules (gita1, gita2, upasana, nithya…)
// POST  /api/products        — add a module/part { name, price, shortName? }
// PATCH /api/products/:id     — update name / price / active (Settings pricing)
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { slugify } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

router.get('/', async (req, res) => {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  res.json({ products })
})

router.post('/', async (req, res) => {
  const { name, price = 0, shortName } = req.body || {}
  if (!name?.trim()) return res.status(400).json({ error: 'Product name is required.' })

  const existing = await prisma.product.findMany({ select: { id: true } })
  const id = slugify(name, existing.map((p) => p.id))

  const product = await prisma.product.create({
    data: { id, name: name.trim(), shortName: shortName?.trim() || name.trim(), price: Number(price) || 0 },
  })
  res.status(201).json({ product })
})

router.patch('/:id', async (req, res) => {
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
})

export default router
