// ── CMS Pages API (माहिती) ────────────────────────────────────
// GET    /api/pages        — list
// GET    /api/pages/:id    — one
// POST   /api/pages        — create
// PATCH  /api/pages/:id    — update
// DELETE /api/pages/:id    — delete
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

const shape = (p) => ({
  id: p.id,
  title: p.title,
  body: p.body,
  heroImage: p.heroImage,
  published: p.published,
  updatedOn: ymd(p.updatedOn),
})

router.get('/', async (req, res) => {
  const pages = await prisma.page.findMany({ orderBy: { id: 'asc' } })
  res.json({ pages: pages.map(shape) })
})

router.get('/:id', async (req, res) => {
  const page = await prisma.page.findUnique({ where: { id: Number(req.params.id) } })
  if (!page) return res.status(404).json({ error: 'Page not found.' })
  res.json({ page: shape(page) })
})

router.post('/', async (req, res) => {
  const { title, body = '', heroImage = '', published = true } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Page title is required.' })
  const page = await prisma.page.create({
    data: { title: title.trim(), body, heroImage: heroImage || null, published: !!published },
  })
  res.status(201).json({ page: shape(page) })
})

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { title, body, heroImage, published } = req.body || {}
  const data = {}
  if (title !== undefined) data.title = String(title).trim()
  if (body !== undefined) data.body = body
  if (heroImage !== undefined) data.heroImage = heroImage || null
  if (published !== undefined) data.published = !!published

  try {
    const page = await prisma.page.update({ where: { id }, data })
    res.json({ page: shape(page) })
  } catch {
    res.status(404).json({ error: 'Page not found.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.page.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Page not found.' })
  }
})

export default router
