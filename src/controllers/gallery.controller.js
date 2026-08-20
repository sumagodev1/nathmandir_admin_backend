// ── Photo Gallery controller (Albums + Photos) ────────────────
// Handlers for /api/albums.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

// Resolve whatever the form sent into the pair an album stores: the master row
// it belongs to, and the slug every deployed APK filters on.
//
// `categoryId` is what the panel's dropdown now sends. A bare `category` slug
// is still accepted so older callers keep working; it is looked up so the two
// columns can never drift apart.
async function resolveCategory({ categoryId, category }) {
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    const row = await prisma.galleryCategory.findUnique({ where: { id: Number(categoryId) } })
    if (!row) return { error: 'Unknown category.' }
    return { categoryId: row.id, category: row.slug }
  }
  if (category) {
    const row = await prisma.galleryCategory.findUnique({ where: { slug: String(category) } })
    // An unknown slug is kept as-is rather than refused: albums created before
    // the master existed still have to be editable.
    return { categoryId: row?.id ?? null, category: String(category) }
  }
  return { error: 'Category is required.' }
}

const shapeAlbum = (a) => ({
  id: a.id,
  category: a.category,
  categoryId: a.categoryId ?? null,
  // The label the panel shows. Null for an album whose slug predates the
  // master, which the panel renders as the raw slug.
  categoryName: a.categoryRef?.name ?? null,
  title: a.title,
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
    include: { _count: { select: { photos: true } }, categoryRef: true },
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
  const album = await prisma.album.findUnique({ where: { id }, include: { photos: true, categoryRef: true } })
  if (!album) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(album) })
}

// POST /api/albums  — create album
export async function create(req, res) {
  const { title, category, categoryId, date = null, cover = '', published = true } = req.body || {}
  // Title is optional. Some albums are just a set of pictures with nothing
  // worth naming, and forcing a name only produces rows called "1" or "-".
  // An empty title is stored empty; the card then shows its cover alone.

  const cat = await resolveCategory({ categoryId, category })
  if (cat.error) return res.status(400).json({ error: cat.error })

  const album = await prisma.album.create({
    data: {
      title: String(title ?? '').trim(),
      category: cat.category,
      categoryId: cat.categoryId,
      date: date ? new Date(date) : null,
      cover: cover || null,
      published: !!published,
    },
    include: { photos: true, categoryRef: true },
  })
  res.status(201).json({ album: shapeAlbum(album) })
}

// PATCH /api/albums/:id  — update album (title, cover, published…)
export async function update(req, res) {
  const id = Number(req.params.id)
  const { title, category, categoryId, date, cover, published } = req.body || {}
  const data = {}
  if (title !== undefined) data.title = String(title).trim()
  // Both columns move together, or the app and the panel would disagree about
  // which category an album is in.
  if (categoryId !== undefined || category !== undefined) {
    const cat = await resolveCategory({ categoryId, category })
    if (cat.error) return res.status(400).json({ error: cat.error })
    data.category = cat.category
    data.categoryId = cat.categoryId
  }
  if (date !== undefined) data.date = date ? new Date(date) : null
  if (cover !== undefined) data.cover = cover || null
  if (published !== undefined) data.published = !!published

  try {
    await prisma.album.update({ where: { id }, data })
    const album = await prisma.album.findUnique({ where: { id }, include: { photos: true, categoryRef: true } })
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

  const album = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true, categoryRef: true } })
  if (!album) return res.status(404).json({ error: 'Album not found.' })

  await prisma.photo.create({
    data: { albumId, url, caption, sortOrder: album.photos.length + 1 },
  })
  // First photo becomes the cover if the album has none.
  if (!album.cover) await prisma.album.update({ where: { id: albumId }, data: { cover: url } })

  const updated = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true, categoryRef: true } })
  res.status(201).json({ album: shapeAlbum(updated) })
}

// DELETE /api/albums/:id/photos/:photoId  — remove a photo
export async function removePhoto(req, res) {
  const albumId = Number(req.params.id)
  const photoId = Number(req.params.photoId)
  await prisma.photo.deleteMany({ where: { id: photoId, albumId } })
  const updated = await prisma.album.findUnique({ where: { id: albumId }, include: { photos: true, categoryRef: true } })
  if (!updated) return res.status(404).json({ error: 'Album not found.' })
  res.json({ album: shapeAlbum(updated) })
}
