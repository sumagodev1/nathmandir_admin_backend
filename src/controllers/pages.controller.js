// ── CMS Pages controller (माहिती) ─────────────────────────────
// Handlers for /api/pages.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

const shape = (p) => ({
  id: p.id,
  title: p.title,
  body: p.body,
  heroImage: p.heroImage,
  published: p.published,
  updatedOn: ymd(p.updatedOn),
})

// GET /api/pages?page=&limit=   — list
export async function list(req, res) {
  const pages = await prisma.page.findMany({ orderBy: { id: 'asc' } })
  const pg = paginate(pages.map(shape), req.query)
  // Note: the resource key is `pages`, so the page-count is exposed as `pageCount`.
  res.json({ pages: pg.data, total: pg.total, page: pg.page, pageCount: pg.pages, limit: pg.limit })
}

// GET /api/pages/:id   — one
export async function get(req, res) {
  const page = await prisma.page.findUnique({ where: { id: Number(req.params.id) } })
  if (!page) return res.status(404).json({ error: 'Page not found.' })
  res.json({ page: shape(page) })
}

// POST /api/pages   — create
export async function create(req, res) {
  const { title, body = '', heroImage = '', published = true } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Page title is required.' })
  const page = await prisma.page.create({
    data: { title: title.trim(), body, heroImage: heroImage || null, published: !!published },
  })
  res.status(201).json({ page: shape(page) })
}

// PATCH /api/pages/:id   — update
export async function update(req, res) {
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
}

// DELETE /api/pages/:id   — delete
export async function remove(req, res) {
  try {
    await prisma.page.delete({ where: { id: Number(req.params.id) } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Page not found.' })
  }
}
