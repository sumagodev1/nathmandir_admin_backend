// ── Content controller ────────────────────────────────────────
// Handlers for /api/content (audio + text items).
import { prisma } from '../lib/prisma.js'

const shape = (c) => ({
  id: c.id,
  productId: c.productId,
  partName: c.product?.name || c.productId,
  type: c.type,
  title: c.title,
  duration: c.duration,
  plays: c.plays,
  listeners: c.listeners,
  published: c.published,
  sortOrder: c.sortOrder,
  audioUrl: c.audioUrl,
  lyrics: c.lyrics,
})

// GET /api/content?product=all|<code>&query=
export async function list(req, res) {
  const { product = 'all', query = '' } = req.query
  const where = {}
  if (product && product !== 'all') where.productId = String(product)
  if (query) where.title = { contains: String(query) }

  const rows = await prisma.content.findMany({
    where,
    include: { product: true },
    orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
  })
  res.json({ content: rows.map(shape), total: rows.length })
}

// POST /api/content   { productId, title, audioUrl?, lyrics?, type?, published? }
export async function create(req, res) {
  const { productId, title, audioUrl = '', lyrics = '', published = true } = req.body || {}
  if (!productId) return res.status(400).json({ error: 'productId is required.' })
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' })

  const count = await prisma.content.count({ where: { productId } })
  const created = await prisma.content.create({
    data: {
      productId,
      title: title.trim(),
      type: audioUrl ? 'audio' : 'text',
      audioUrl: audioUrl || null,
      lyrics: lyrics || null,
      published: !!published,
      sortOrder: count + 1,
    },
    include: { product: true },
  })
  res.status(201).json({ content: shape(created) })
}

// PATCH /api/content/:id   partial: { published, lyrics, title, sortOrder, audioUrl }
export async function update(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid content id.' })

  const { published, lyrics, title, sortOrder, audioUrl } = req.body || {}
  const data = {}
  if (published !== undefined) data.published = !!published
  if (lyrics !== undefined) data.lyrics = lyrics
  if (title !== undefined) data.title = String(title).trim()
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
  if (audioUrl !== undefined) {
    data.audioUrl = audioUrl || null
    // Attaching/replacing an audio file makes this an audio item so the app
    // (and the admin "Play" button) treat it correctly. Never auto-downgrade.
    if (audioUrl) data.type = 'audio'
  }

  try {
    const updated = await prisma.content.update({ where: { id }, data, include: { product: true } })
    res.json({ content: shape(updated) })
  } catch {
    res.status(404).json({ error: 'Content item not found.' })
  }
}

// DELETE /api/content/:id
export async function remove(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid content id.' })
  try {
    await prisma.content.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Content item not found.' })
  }
}
