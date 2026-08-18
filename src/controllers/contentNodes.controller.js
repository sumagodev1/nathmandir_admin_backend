// ── Content hierarchy controller ──────────────────────────────
// Handlers for /api/content-nodes — the tree of sections inside a Part.
//
// A node is just a named child of either a Part (parentId = null) or another
// node. That is the whole model: there is no "session" level, no "sub part"
// level and no weekday level in this file. The admin creates whatever levels
// a Part needs, names them in whatever language, and the same three handlers
// serve a two-level tree and a five-level one.
import { prisma } from '../lib/prisma.js'
import { resolveProductId } from '../lib/products.js'

// How deep a branch may go. A guard against a node being made its own
// ancestor through repeated moves, not a business limit.
const MAX_DEPTH = 12

const shape = (n) => ({
  id: n.id,
  productId: n.productId,
  parentId: n.parentId,
  name: n.name,
  kind: n.kind || null,
  sortOrder: n.sortOrder,
  // Counts let the UI show "3 sections · 7 items" without a second request,
  // and tell it whether this node is a folder or a leaf holding content.
  childCount: n._count?.children ?? undefined,
  itemCount: n._count?.content ?? undefined,
})

// Binned items are not counted: a section holding only deleted rows reads as
// empty, and the delete guard below lets it go without a cascade prompt.
const WITH_COUNTS = {
  _count: { select: { children: true, content: { where: { deletedAt: null } } } },
}

// Root → … → node. Walked parent by parent because the depth is not fixed;
// MAX_DEPTH stops a cycle from looping forever if one is ever introduced by
// hand in the database.
async function pathOf(nodeId) {
  const path = []
  let current = nodeId
  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const node = await prisma.contentNode.findUnique({
      where: { id: current },
      include: WITH_COUNTS,
    })
    if (!node) break
    path.unshift(shape(node))
    current = node.parentId
  }
  return path
}

// GET /api/content-nodes?product=<id|code>&parent=<id>
//   no &parent    → the top level of the Part
//   &parent=<id>  → that node's children
//   &all=1        → every section of the Part, flat, at any depth
// Always returns { nodes, path, parent } so one call fills a whole screen:
// the list to show, the breadcrumb above it, and the node being viewed.
//
// `all` exists for the content table, which draws the Part's whole tree at
// once: asking level by level would be one request per section.
export async function list(req, res) {
  const { product, parent, all } = req.query

  if (all === '1' || all === 'true') {
    if (!product) return res.status(400).json({ error: 'product is required.' })
    const productId = await resolveProductId(product)
    if (productId === null) return res.json({ nodes: [], path: [], parent: null })

    const nodes = await prisma.contentNode.findMany({
      where: { productId },
      include: WITH_COUNTS,
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    })
    return res.json({ nodes: nodes.map(shape), path: [], parent: null, productId })
  }

  let parentId = null
  if (parent !== undefined && String(parent).trim() !== '' && String(parent) !== 'root') {
    parentId = Number(parent)
    if (Number.isNaN(parentId)) return res.status(400).json({ error: 'Invalid parent id.' })
  }

  // The Part comes from the parent when there is one, so the caller never has
  // to keep both in sync.
  let productId = null
  let parentNode = null
  if (parentId) {
    parentNode = await prisma.contentNode.findUnique({ where: { id: parentId }, include: WITH_COUNTS })
    if (!parentNode) return res.status(404).json({ error: 'Section not found.' })
    productId = parentNode.productId
  } else {
    if (!product) return res.status(400).json({ error: 'product is required at the top level.' })
    productId = await resolveProductId(product)
    if (productId === null) return res.json({ nodes: [], path: [], parent: null })
  }

  const nodes = await prisma.contentNode.findMany({
    where: { productId, parentId },
    include: WITH_COUNTS,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  })

  res.json({
    nodes: nodes.map(shape),
    path: parentId ? await pathOf(parentId) : [],
    parent: parentNode ? shape(parentNode) : null,
    productId,
  })
}

// GET /api/content-nodes/:id — one node plus its breadcrumb.
export async function get(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid section id.' })

  const node = await prisma.contentNode.findUnique({ where: { id }, include: WITH_COUNTS })
  if (!node) return res.status(404).json({ error: 'Section not found.' })

  res.json({ node: shape(node), path: await pathOf(id) })
}

// Two sections with the same name under the same parent are indistinguishable
// in the UI, so the name is unique among siblings. Case-insensitive because
// MySQL compares that way anyway — better to say so than to let it surprise.
async function duplicateName({ productId, parentId, name, ignoreId }) {
  const clash = await prisma.contentNode.findFirst({
    where: {
      productId,
      parentId,
      name,
      ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
    },
    select: { id: true },
  })
  return clash ? `A section called “${name}” already exists here.` : null
}

// POST /api/content-nodes   { productId | parentId, name, kind? }
// `parentId` alone is enough — the Part is inherited from it.
export async function create(req, res) {
  const { productId, parentId, name, kind } = req.body || {}

  const cleanName = String(name || '').trim()
  if (!cleanName) return res.status(400).json({ error: 'Section name is required.' })

  let pid = null
  let parent = null
  if (parentId) {
    parent = await prisma.contentNode.findUnique({ where: { id: Number(parentId) } })
    if (!parent) return res.status(400).json({ error: 'Parent section not found.' })
    pid = parent.productId

    // Depth is only bounded so a runaway import cannot build a branch the
    // breadcrumb can no longer walk.
    const depth = (await pathOf(parent.id)).length
    if (depth >= MAX_DEPTH) {
      return res.status(400).json({ error: `Sections cannot nest deeper than ${MAX_DEPTH} levels.` })
    }
  } else {
    if (!productId) return res.status(400).json({ error: 'productId or parentId is required.' })
    pid = await resolveProductId(productId)
    if (pid === null) return res.status(400).json({ error: 'Unknown Part.' })
  }

  const dupe = await duplicateName({ productId: pid, parentId: parent?.id ?? null, name: cleanName })
  if (dupe) return res.status(409).json({ error: dupe })

  // Appended after whatever is already here, the same way a new content item
  // is appended inside its Part.
  const count = await prisma.contentNode.count({ where: { productId: pid, parentId: parent?.id ?? null } })

  const node = await prisma.contentNode.create({
    data: {
      productId: pid,
      parentId: parent?.id ?? null,
      name: cleanName,
      kind: kind ? String(kind).trim().slice(0, 64) : null,
      sortOrder: count + 1,
    },
    include: WITH_COUNTS,
  })
  res.status(201).json({ node: shape(node) })
}

// PATCH /api/content-nodes/:id   partial { name, kind, sortOrder }
// The parent is deliberately not editable here: moving a branch has to also
// re-check depth and cycles, and nothing in the admin panel asks for it yet.
export async function update(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid section id.' })

  const existing = await prisma.contentNode.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Section not found.' })

  const { name, kind, sortOrder } = req.body || {}
  const data = {}

  if (name !== undefined) {
    const cleanName = String(name).trim()
    if (!cleanName) return res.status(400).json({ error: 'Section name cannot be empty.' })
    const dupe = await duplicateName({
      productId: existing.productId,
      parentId: existing.parentId,
      name: cleanName,
      ignoreId: id,
    })
    if (dupe) return res.status(409).json({ error: dupe })
    data.name = cleanName
  }
  if (kind !== undefined) data.kind = kind ? String(kind).trim().slice(0, 64) : null
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder) || 0

  if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update.' })

  const node = await prisma.contentNode.update({ where: { id }, data, include: WITH_COUNTS })
  res.json({ node: shape(node) })
}

// Every section at or below `id`, deepest last. Used to work out what a
// cascading delete would actually remove before doing any of it.
async function subtreeIds(id) {
  const ids = [id]
  let frontier = [id]
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const kids = await prisma.contentNode.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    })
    frontier = kids.map((k) => k.id)
    ids.push(...frontier)
  }
  return ids
}

// DELETE /api/content-nodes/:id[?cascade=1]
//
// Without `cascade` a section holding anything is refused, and the message
// says exactly what is in the way.
//
// With `cascade=1` the section and everything below it goes — but the CONTENT
// inside is never deleted. Those items are moved out to sit directly in the
// Part, where they stay visible in the Part's list. Audio and lyrics the admin
// cannot get back must not disappear behind a single click; losing the folder
// is undoable in a minute, losing a recording is not.
export async function remove(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid section id.' })

  const node = await prisma.contentNode.findUnique({ where: { id }, include: WITH_COUNTS })
  if (!node) return res.status(404).json({ error: 'Section not found.' })

  const cascade = req.query.cascade === '1' || req.query.cascade === 'true'
  const children = node._count.children
  const items = node._count.content

  if ((children || items) && !cascade) {
    const bits = []
    if (children) bits.push(`${children} section${children === 1 ? '' : 's'}`)
    if (items) bits.push(`${items} item${items === 1 ? '' : 's'}`)
    return res.status(409).json({
      error: `“${node.name}” still contains ${bits.join(' and ')}. Move or delete those first.`,
    })
  }

  if (!cascade) {
    await prisma.contentNode.delete({ where: { id } })
    return res.json({ ok: true, removedSections: 1, keptItems: 0 })
  }

  const ids = await subtreeIds(id)

  // Items first — moved out, not removed.
  const kept = await prisma.content.updateMany({
    where: { nodeId: { in: ids } },
    data: { nodeId: null },
  })

  // Then the branch. Deleting the top cascades to the rest.
  await prisma.contentNode.delete({ where: { id } })

  res.json({ ok: true, removedSections: ids.length, keptItems: kept.count })
}
