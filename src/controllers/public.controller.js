// ── Public website API controller ─────────────────────────────
// Read-only, no-auth endpoints that feed the public website
// (nathmandirnashikweb). Everything here only ever exposes
// *published* content and never leaks admin/user/payment data.
//
// These handlers reuse the same Prisma models as the admin panel,
// so whatever an admin publishes in the panel appears here — the
// backend stays the single source of truth. Nothing in this file
// modifies admin behaviour; it is an additive, separate surface
// mounted at /api/public.
import { prisma } from '../lib/prisma.js'
import { ymd, jsonSafe } from '../lib/helpers.js'

// ── Gallery ─ published albums, each with its photos ───────────
// GET /api/public/gallery?category=<slug>|all
//
// Category names come from the gallery_category master rather than a list
// hard-coded in the website, so adding a category in the panel is enough to
// make it appear here with its Marathi label.
const shapeAlbum = (a) => ({
  id: a.id,
  title: a.title,
  category: a.category,
  categoryName: a.categoryRef?.name || null,
  cover: a.cover,
  date: ymd(a.date),
  photos: (a.photos || [])
    .slice()
    .sort((x, y) => x.sortOrder - y.sortOrder)
    .map((p) => ({ id: p.id, url: p.url, caption: p.caption || '' })),
  photoCount: a.photos ? a.photos.length : 0,
})

export async function gallery(req, res) {
  const { category = 'all' } = req.query

  // Every category an admin has defined, parents first, each carrying its
  // children — the website used to hold its own copy of this list, which meant
  // a new category was invisible until someone edited the code.
  const master = await prisma.galleryCategory.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  const byId = new Map(master.map((c) => [c.id, c]))
  const categories = master
    .filter((c) => !c.parentId)
    .map((c) => ({
      slug: c.slug,
      name: c.name,
      children: master
        .filter((k) => k.parentId === c.id)
        .map((k) => ({ slug: k.slug, name: k.name, parentSlug: c.slug })),
    }))

  const where = { published: true }
  if (category && category !== 'all') {
    // Choosing a parent shows everything beneath it too, so a category never
    // looks empty while its pictures sit one level down.
    const picked = master.find((c) => c.slug === String(category))
    const slugs = picked
      ? [picked.slug, ...master.filter((k) => k.parentId === picked.id).map((k) => k.slug)]
      : [String(category)] // a slug with no master row is still a real album category
    where.category = { in: slugs }
  }

  const albums = await prisma.album.findMany({
    where,
    include: { photos: true, categoryRef: true },
    orderBy: { id: 'desc' },
  })

  const shaped = albums.map(shapeAlbum)

  // Build a flat photo list for the website's gallery grid.
  // For albums that have individual gallery photos, use those.
  // For albums that only have a cover image (no photos added yet via Manage Photos),
  // surface the cover so the album still appears on the website rather than being invisible.
  const photos = shaped.flatMap((a) => {
    if (a.photos.length > 0) {
      return a.photos.map((p) => ({ ...p, albumId: a.id, category: a.category, categoryName: a.categoryName, albumTitle: a.title }))
    }
    if (a.cover) {
      return [{ id: `cover-${a.id}`, url: a.cover, caption: '', albumId: a.id, category: a.category, categoryName: a.categoryName, albumTitle: a.title }]
    }
    return []
  })

  res.json({ albums: shaped, photos, categories, total: shaped.length })
}

// ── Library ─ published books with their chapters ──────────────
// GET /api/public/library?category=all|granth|pothi|stotra
const shapeBook = (b) => ({
  id: b.id,
  title: b.title,
  author: b.author || '',
  category: b.category,
  cover: b.cover,
  description: b.description || '',
  chapters: (b.chapters || [])
    .slice()
    .sort((a, c) => a.sortOrder - c.sortOrder)
    .map((c) => ({ id: c.id, title: c.title, content: c.content, sortOrder: c.sortOrder })),
  chapterCount: b.chapters ? b.chapters.length : 0,
})

export async function library(req, res) {
  const { category = 'all' } = req.query
  const where = { published: true }
  if (category && category !== 'all') where.category = String(category)

  const books = await prisma.book.findMany({
    where,
    include: { chapters: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  res.json({ books: books.map(shapeBook), total: books.length })
}

// GET /api/public/library/:id  — one published book with chapters
export async function libraryBook(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid book id.' })

  const book = await prisma.book.findFirst({
    where: { id, published: true },
    include: { chapters: true },
  })
  if (!book) return res.status(404).json({ error: 'Book not found.' })
  res.json({ book: shapeBook(book) })
}

// ── CMS Pages ─ published माहिती pages ─────────────────────────
// GET /api/public/pages
const shapePage = (p) => ({
  id: p.id,
  title: p.title,
  body: p.body,
  heroImage: p.heroImage,
  updatedOn: ymd(p.updatedOn),
})

export async function pages(req, res) {
  const rows = await prisma.page.findMany({ where: { published: true }, orderBy: { id: 'asc' } })
  res.json({ pages: rows.map(shapePage), total: rows.length })
}

// GET /api/public/pages/:id — one published page
export async function page(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid page id.' })

  const p = await prisma.page.findFirst({ where: { id, published: true } })
  if (!p) return res.status(404).json({ error: 'Page not found.' })
  res.json({ page: shapePage(p) })
}

// ── Notifications ─ recent announcements for the website ───────
// GET /api/public/notifications?limit=20  (audience "all" only — public)
export async function notifications(req, res) {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))
  const rows = await prisma.notification.findMany({
    where: { audience: 'all' },
    orderBy: { sentOn: 'desc' },
    take: limit,
  })
  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      sentOn: ymd(n.sentOn),
    })),
    total: rows.length,
  })
}

// ── Website content sections (CMS) ─────────────────────────────
// GET /api/public/sections        — all sections as { key: data }
const safeParse = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

export async function sections(req, res) {
  const rows = await prisma.siteSection.findMany()
  const out = {}
  for (const r of rows) out[r.key] = safeParse(r.data)
  res.json({ sections: out })
}

// GET /api/public/sections/:key   — one section's data
export async function section(req, res) {
  const row = await prisma.siteSection.findUnique({ where: { key: req.params.key } })
  if (!row) return res.status(404).json({ error: 'Section not found.' })
  res.json({ key: row.key, data: safeParse(row.data) })
}

// ── Contact form submission ────────────────────────────────────
// POST /api/public/contact   { name, email, phone|mobile, subject?, message }
// Inserts into the same `contact` table the admin Contacts page reads.
export async function submitContact(req, res) {
  const body = req.body || {}
  const name = String(body.name || '').trim()
  const email = String(body.email || '').trim()
  const mobile = String(body.phone || body.mobile || '').trim()
  const subject = String(body.subject || '').trim()
  const rawMessage = String(body.message || '').trim()

  if (!name || !rawMessage) {
    return res.status(400).json({ error: 'Name and message are required.' })
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }

  // Keep the subject with the message (the contact table has no subject column).
  const message = subject ? `${subject}\n\n${rawMessage}` : rawMessage

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO contact (name, email, mobile, message) VALUES (?, ?, ?, ?)`,
      name,
      email,
      mobile,
      message
    )
    return res.status(201).json({ ok: true, message: 'Message received. Thank you for reaching out.' })
  } catch {
    return res.status(500).json({ error: 'Could not send your message. Please try again later.' })
  }
}
