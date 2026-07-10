// ── Photo Gallery API (Albums + Photos) ───────────────────────
// GET    /api/albums?category=            — list albums (with photo counts)
// GET    /api/albums/:id                  — one album with photos
// POST   /api/albums                      — create album
// PATCH  /api/albums/:id                  — update album (title, cover, published…)
// DELETE /api/albums/:id                  — delete album (photos cascade)
// POST   /api/albums/:id/photos           — add a photo { url, caption }
// DELETE /api/albums/:id/photos/:photoId  — remove a photo
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { ymd } from '../lib/helpers.js'

const router = Router()
router.use(requireAuth)

const shapeAlbum = (a) => ({
  id: a.id,
  title: a.title,
  category: a.category,
  cover: a.cover,
  date: ymd(a.date),
  published: a.published,
  photos: (a.photos || [])
    .slice()
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((p) => ({ id: p.id, url: p.url, caption: p.caption, sortOrder: p.sortOrder })),
  photoCount: a._count?.photos ?? (a.photos ? a.photos.length : 0),
})

router.get('/', async (req, res) => {
  const { category = 'all' } = req.query
  const where = category && category !== 'all' ? { category: String(category) } : {}
  const albums = await prisma.album.findMany({
    where,
    include: { _count: { select: { photos: true } } },
    orderBy: { id: 'asc' },
  })
  res.json({ albums: albums.map(shapeAlbum) })
})

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const album = await prisma.album.findUnique({ where: { id }, include: { photos: true } })
  if (!album) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(album) })
})

router.post('/', async (req, res) => {
  const { title, category, date = null, cover = '', published = true } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Album title is required.' })
  if (!category) return res.status(400).json({ error: 'Category is required.' })

  const album = await prisma.album.create({
    data: { title: title.trim(), category, date: date ? new Date(date) : null, cover: cover || null, published: !!published },
    include: { photos: true },
  })
  res.status(201).json({ album: shapeAlbum(album) })
})

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { title, category, date, cover, published } = req.body || {}
  const data = {}
  if (title !== undefined) data.title = String(title).trim()
  if (category !== undefined) data.category = category
  if (date !== undefined) data.date = date ? new Date(date) : null
  if (cover !== undefined) data.cover = cover || null
  if (published !== undefined) data.published = !!published

  try {
    await prisma.album.update({ where: { id }, data })
    const album = await prisma.album.findUnique({ where: { id }, include: { photos: true } })
    res.json({ album: shapeAlbum(album) })
  } catch {
    res.status(404).json({ error: 'Album not found.' })
  }
})

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  try {
    await prisma.album.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Album not found.' })
  }
})

// ── Photos within an album ──
router.post('/:id/photos', async (req, res) => {
  const albumId = Number(req.params.id)
  const { url, caption = '' } = req.body || {}
  if (!url) return res.status(400).json({ error: 'Photo url is required.' })

  const album = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true } })
  if (!album) return res.status(404).json({ error: 'Album not found.' })

  await prisma.photo.create({
    data: { albumId, url, caption, sortOrder: album.photos.length + 1 },
  })
  // First photo becomes the cover if the album has none.
  if (!album.cover) await prisma.album.update({ where: { id: albumId }, data: { cover: url } })

  const updated = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true } })
  res.status(201).json({ album: shapeAlbum(updated) })
})

router.delete('/:id/photos/:photoId', async (req, res) => {
  const albumId = Number(req.params.id)
  const photoId = Number(req.params.photoId)
  await prisma.photo.deleteMany({ where: { id: photoId, albumId } })
  const updated = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true } })
  if (!updated) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(updated) })
})

export default router
