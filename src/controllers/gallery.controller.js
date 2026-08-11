// ── Photo Gallery controller (Albums + Photos) ────────────────
// Handlers for /api/albums.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

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

// GET /api/albums?category=&page=&limit=  — list albums (with photo counts)
export async function list(req, res) {
  const { category = 'all' } = req.query
  const where = category && category !== 'all' ? { category: String(category) } : {}
  const albums = await prisma.album.findMany({
    where,
    include: { _count: { select: { photos: true } } },
    // Newest first, which also matches the public gallery (public.controller.js
    // already serves albums id desc) — the two used to disagree.
    orderBy: { id: 'desc' },
  })
  const pg = paginate(albums.map(shapeAlbum), req.query)
  res.json({ albums: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}

// GET /api/albums/:id  — one album with photos
export async function get(req, res) {
  const id = Number(req.params.id)
  const album = await prisma.album.findUnique({ where: { id }, include: { photos: true } })
  if (!album) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(album) })
}

// POST /api/albums  — create album
export async function create(req, res) {
  const { title, category, date = null, cover = '', published = true } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Album title is required.' })
  if (!category) return res.status(400).json({ error: 'Category is required.' })

  const album = await prisma.album.create({
    data: { title: title.trim(), category, date: date ? new Date(date) : null, cover: cover || null, published: !!published },
    include: { photos: true },
  })
  res.status(201).json({ album: shapeAlbum(album) })
}

// PATCH /api/albums/:id  — update album (title, cover, published…)
export async function update(req, res) {
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
}

// DELETE /api/albums/:id  — delete album (photos cascade)
export async function remove(req, res) {
  const id = Number(req.params.id)
  try {
    await prisma.album.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Album not found.' })
  }
}

// POST /api/albums/:id/photos  — add a photo { url, caption }
export async function addPhoto(req, res) {
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
}

// DELETE /api/albums/:id/photos/:photoId  — remove a photo
export async function removePhoto(req, res) {
  const albumId = Number(req.params.id)
  const photoId = Number(req.params.photoId)
  await prisma.photo.deleteMany({ where: { id: photoId, albumId } })
  const updated = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true } })
  if (!updated) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(updated) })
}
