// ── Spiritual Library API (Books + Chapters) ──────────────────
// GET    /api/books?category=   — list books (with chapter counts)
// GET    /api/books/:id         — one book with its chapters
// POST   /api/books             — create { title, author, category, ...chapters[] }
// PATCH  /api/books/:id         — update; if `chapters` sent, replaces them all
// DELETE /api/books/:id         — delete book (chapters cascade)
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

const shapeBook = (b) => ({
  id: b.id,
  title: b.title,
  author: b.author,
  category: b.category,
  cover: b.cover,
  description: b.description,
  published: b.published,
  sortOrder: b.sortOrder,
  chapters: (b.chapters || [])
    .slice()
    .sort((a, c) => a.sortOrder - c.sortOrder)
    .map((c) => ({ id: c.id, title: c.title, content: c.content, sortOrder: c.sortOrder })),
  chapterCount: b._count?.chapters ?? (b.chapters ? b.chapters.length : 0),
})

router.get('/', async (req, res) => {
  const { category = 'all' } = req.query
  const where = category && category !== 'all' ? { category: String(category) } : {}
  const books = await prisma.book.findMany({
    where,
    include: { _count: { select: { chapters: true } } },
    orderBy: { id: 'asc' },
  })
  res.json({ books: books.map(shapeBook) })
})

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const book = await prisma.book.findUnique({ where: { id }, include: { chapters: true } })
  if (!book) return res.status(404).json({ error: 'Book not found.' })
  res.json({ book: shapeBook(book) })
})

router.post('/', async (req, res) => {
  const { title, author = '', category, description = '', cover = '', published = false, chapters = [] } = req.body || {}
  if (!title?.trim()) return res.status(400).json({ error: 'Book title is required.' })
  if (!category) return res.status(400).json({ error: 'Category is required.' })

  const book = await prisma.book.create({
    data: {
      title: title.trim(), author: author.trim(), category,
      description, cover: cover || null, published: !!published,
      chapters: {
        create: chapters.map((c, i) => ({ title: c.title || `प्रकरण ${i + 1}`, content: c.content || '', sortOrder: i + 1 })),
      },
    },
    include: { chapters: true },
  })
  res.status(201).json({ book: shapeBook(book) })
})

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await prisma.book.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Book not found.' })

  const { title, author, category, description, cover, published, chapters } = req.body || {}
  const data = {}
  if (title !== undefined) data.title = String(title).trim()
  if (author !== undefined) data.author = String(author).trim()
  if (category !== undefined) data.category = category
  if (description !== undefined) data.description = description
  if (cover !== undefined) data.cover = cover || null
  if (published !== undefined) data.published = !!published

  // If chapters are provided, replace the whole set (matches "Save Book").
  const ops = [prisma.book.update({ where: { id }, data })]
  if (Array.isArray(chapters)) {
    ops.push(prisma.chapter.deleteMany({ where: { bookId: id } }))
    ops.push(
      prisma.chapter.createMany({
        data: chapters.map((c, i) => ({ bookId: id, title: c.title || `प्रकरण ${i + 1}`, content: c.content || '', sortOrder: i + 1 })),
      })
    )
  }
  await prisma.$transaction(ops)

  const book = await prisma.book.findUnique({ where: { id }, include: { chapters: true } })
  res.json({ book: shapeBook(book) })
})

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  try {
    await prisma.book.delete({ where: { id } })
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Book not found.' })
  }
})

export default router
