// ── Gallery category master ───────────────────────────────────
// Handlers for /api/gallery-categories.
//
// These used to be two entries hard-coded in the frontend. An admin can now add
// and rename them, which is why `slug` and `name` are separate: `slug` is what
// every deployed APK sends and filters on, `name` is the Marathi label people
// read. Renaming a category is therefore safe — no phone notices.
import { prisma } from '../lib/prisma.js'

const shape = (c) => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  // null = a top-level category; a number = a subcategory of that category.
  parentId: c.parentId ?? null,
  parentName: c.parent?.name ?? null,
  sortOrder: c.sortOrder,
  published: c.published,
  albumCount: c._count?.albums ?? undefined,
  childCount: c._count?.children ?? undefined,
})

const WITH_COUNTS = {
  _count: { select: { albums: true, children: true } },
  parent: { select: { id: true, name: true } },
}

// Only two levels. A subcategory of a subcategory would have to be drawn,
// filtered and explained everywhere, and nothing in the gallery needs it.
async function resolveParent(parentId, selfId = null) {
  if (parentId === undefined || parentId === null || parentId === '') return { parentId: null }
  const id = Number(parentId)
  if (Number.isNaN(id)) return { error: 'Invalid parent category.' }
  if (selfId && id === selfId) return { error: 'A category cannot be inside itself.' }

  const parent = await prisma.galleryCategory.findUnique({ where: { id } })
  if (!parent) return { error: 'Parent category not found.' }
  if (parent.parentId) {
    return { error: `“${parent.name}” is already a subcategory. Subcategories cannot hold more subcategories.` }
  }
  return { parentId: id }
}

// A slug is derived once, on create, and then frozen. Letting it follow the
// name would change the value phones filter on every time someone fixes a typo.
const toSlug = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)

// GET /api/gallery-categories
export async function list(req, res) {
  const categories = await prisma.galleryCategory.findMany({
    include: WITH_COUNTS,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })
  const all = categories.map(shape)
  // Returned flat, but ordered parent-then-its-children so the table reads as
  // a tree without the UI having to sort it.
  const tops = all.filter((c) => !c.parentId)
  const ordered = tops.flatMap((t) => [t, ...all.filter((c) => c.parentId === t.id)])
  // Anything whose parent vanished still has to be listed, or it becomes
  // invisible and un-deletable.
  const orphans = all.filter((c) => c.parentId && !tops.some((t) => t.id === c.parentId))
  res.json({ categories: [...ordered, ...orphans] })
}

// POST /api/gallery-categories  { name, slug?, sortOrder?, published? }
export async function create(req, res) {
  const { name, slug, parentId, sortOrder, published = true } = req.body || {}
  const cleanName = String(name ?? '').trim()
  if (!cleanName) return res.status(400).json({ error: 'Category name is required.' })

  // An admin typing a Marathi name has no latin letters to slugify, so fall
  // back to a stable generated slug rather than an empty one.
  const cleanSlug = toSlug(slug || cleanName) || `cat-${Date.now()}`

  const clash = await prisma.galleryCategory.findUnique({ where: { slug: cleanSlug } })
  if (clash) return res.status(409).json({ error: `A category with the key “${cleanSlug}” already exists.` })

  const parent = await resolveParent(parentId)
  if (parent.error) return res.status(400).json({ error: parent.error })

  const category = await prisma.galleryCategory.create({
    data: {
      name: cleanName,
      slug: cleanSlug,
      parentId: parent.parentId,
      sortOrder: Number(sortOrder) || 0,
      published: !!published,
    },
    include: WITH_COUNTS,
  })
  res.status(201).json({ category: shape(category) })
}

// PATCH /api/gallery-categories/:id  { name?, sortOrder?, published? }
// `slug` is not editable — see the note above.
export async function update(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid category id.' })

  const existing = await prisma.galleryCategory.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Category not found.' })

  const { name, parentId, sortOrder, published } = req.body || {}
  const data = {}
  if (parentId !== undefined) {
    // Moving a category that already has subcategories under another one would
    // make a third level, which this deliberately does not support.
    if (parentId !== null && parentId !== '') {
      const kids = await prisma.galleryCategory.count({ where: { parentId: id } })
      if (kids) {
        return res.status(409).json({
          error: `“${existing.name}” holds ${kids} subcategor${kids === 1 ? 'y' : 'ies'}. Move ${kids === 1 ? 'it' : 'them'} out before making this a subcategory.`,
        })
      }
    }
    const parent = await resolveParent(parentId, id)
    if (parent.error) return res.status(400).json({ error: parent.error })
    data.parentId = parent.parentId
  }
  if (name !== undefined) {
    const cleanName = String(name).trim()
    if (!cleanName) return res.status(400).json({ error: 'Category name cannot be empty.' })
    data.name = cleanName
  }
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0
  if (published !== undefined) data.published = !!published

  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' })

  const category = await prisma.galleryCategory.update({ where: { id }, data, include: WITH_COUNTS })
  res.json({ category: shape(category) })
}

// DELETE /api/gallery-categories/:id
// Refused while albums still use it. Deleting would leave those albums with no
// category and their photos stranded in the app, which is never what an admin
// deleting a label meant to happen — so they are told what to move first.
export async function remove(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid category id.' })

  const category = await prisma.galleryCategory.findUnique({ where: { id }, include: WITH_COUNTS })
  if (!category) return res.status(404).json({ error: 'Category not found.' })

  const kids = category._count.children
  if (kids) {
    return res.status(409).json({
      error: `“${category.name}” holds ${kids} subcategor${kids === 1 ? 'y' : 'ies'}. Delete ${kids === 1 ? 'it' : 'them'} first, then delete this one.`,
      childCount: kids,
    })
  }

  const used = category._count.albums
  if (used) {
    return res.status(409).json({
      error: `“${category.name}” still holds ${used} album${used === 1 ? '' : 's'}. Move ${used === 1 ? 'it' : 'them'} to another category first, then delete this one.`,
      albumCount: used,
    })
  }

  await prisma.galleryCategory.delete({ where: { id } })
  res.json({ ok: true })
}
