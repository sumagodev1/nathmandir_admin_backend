// ── Content controller ────────────────────────────────────────
// Handlers for /api/content (audio + text items).
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'
import { resolveProductId } from '../lib/products.js'
import { findOrCreateChild, DAY_KIND } from '../lib/defaultSections.js'
import { sectionMap, sectionPath } from '../lib/sectionTrail.js'
import { groupSchedule, parseSchedule } from '../lib/contentSchedule.js'
import { UPLOADS_ROOT } from './uploads.controller.js'
import { GITANJALI_PART1_ITEMS } from '../data/gitanjaliPart1.js'
import { GITANJALI_PART2_ITEMS } from '../data/gitanjaliPart2.js'
import { UPASANA_ITEMS } from '../data/upasana.js'
import { NITYANIYAM_ITEMS } from '../data/nityaniyam.js'

const shape = (c, map = new Map()) => ({
  id: c.id,
  productId: c.productId,
  productCode: c.product?.code || null,
  partName: c.product?.name || String(c.productId),
  type: c.type,
  title: c.title,
  duration: c.duration,
  plays: c.plays,
  listeners: c.listeners,
  published: c.published,
  sortOrder: c.sortOrder,
  audioUrl: c.audioUrl,
  lyrics: c.lyrics,
  // Always present, even for an unscheduled item, so the form can render its
  // tick boxes without null-checking every time.
  schedule: groupSchedule(c.schedule || []),
  // Which section of the Part's hierarchy the item sits in. null = directly
  // in the Part, which is every item created before the hierarchy existed.
  nodeId: c.nodeId ?? null,
  nodeName: c.node?.name || null,
  // The whole trail, so a day reads "संध्याकाळ › वाराची पदे › सोमवार" rather
  // than just "सोमवार", which on its own says nothing about where it sits.
  nodePath: c.nodeId ? sectionPath(c.nodeId, map) : [],
})

// Every read of a content row needs the product (for the Part name), the
// schedule rows (for the tick boxes) and its section, so keep the shape in
// one place.
const WITH_RELATIONS = { product: true, schedule: true, node: true }

// GET /api/content?product=all|<code>&query=
//   optional: &node=<id>   items in that section
//             &node=none   items sitting directly in the Part
//   Omitting it returns everything, exactly as before.
export async function list(req, res) {
  const { product = 'all', query = '', node } = req.query
  const where = {}
  if (product && product !== 'all') {
    // ?product= accepts either the numeric id or the public code.
    const pid = await resolveProductId(product)
    if (pid === null) return res.json({ content: [], total: 0 })
    where.productId = pid
  }
  if (query) where.title = { contains: String(query) }
  if (node !== undefined && String(node).trim() !== '') {
    if (String(node) === 'none') {
      where.nodeId = null
    } else {
      const nid = Number(node)
      if (Number.isNaN(nid)) return res.status(400).json({ error: 'Invalid node id.' })
      where.nodeId = nid
    }
  }

  const rows = await prisma.content.findMany({
    where,
    include: WITH_RELATIONS,
    orderBy: [{ productId: 'asc' }, { sortOrder: 'asc' }],
  })

  // Listeners = active subscribers to each content item's product.
  // The `listeners` DB column is never written by the app, so we compute it
  // from user_access: count distinct users with a non-expired grant per product.
  const now = new Date()
  const productIds = [...new Set(rows.map((r) => r.productId))]
  const accessCounts = productIds.length
    ? await prisma.userAccess.groupBy({
        by: ['productId'],
        where: {
          productId: { in: productIds },
          OR: [{ expiresOn: null }, { expiresOn: { gt: now } }],
        },
        _count: { _all: true },
      })
    : []
  const listenerMap = new Map(accessCounts.map((a) => [a.productId, a._count._all]))

  // One query for every section name the list needs.
  const sections = await sectionMap(productIds)

  res.json({
    content: rows.map((c) => ({ ...shape(c, sections), listeners: listenerMap.get(c.productId) ?? 0 })),
    total: rows.length,
  })
}

// Blank fields are allowed, so an item can be filled in over several visits.
// A title is only invented when none is given — an untitled row would be
// invisible in every list that shows one.
const UNTITLED = 'Untitled'

// The same title twice in one section is a double submit, not a second item —
// the bundled import treats (product, title) the same way. Items sitting
// directly in a Part are not checked, so nothing about the old flow changes.
// Untitled rows are not checked either: several drafts in one section is a
// normal thing to want, and they are told apart by what is filled in later.
// Returns an error message or null.
async function duplicateInNode({ nodeId, title, ignoreId }) {
  if (!nodeId || !title || title === UNTITLED) return null
  const clash = await prisma.content.findFirst({
    where: { nodeId, title, ...(ignoreId ? { NOT: { id: ignoreId } } : {}) },
    select: { id: true, node: { select: { name: true } } },
  })
  return clash ? `“${title}” is already in “${clash.node?.name}”.` : null
}

// Resolve and check a section id from a request body.
// Returns { nodeId } (null when not filed) or { error }.
async function resolveNode(nodeId, productId) {
  if (nodeId === undefined || nodeId === null || String(nodeId).trim() === '') {
    return { nodeId: null }
  }
  const id = Number(nodeId)
  if (Number.isNaN(id)) return { error: 'Invalid section id.' }

  const node = await prisma.contentNode.findUnique({ where: { id }, select: { id: true, productId: true } })
  if (!node) return { error: 'Section not found.' }
  // A section belongs to one Part; filing an item into another Part's section
  // would make it unreachable from both.
  if (productId !== undefined && node.productId !== productId) {
    return { error: 'That section belongs to a different Part.' }
  }
  return { nodeId: node.id }
}

// POST /api/content
//   { productId, title, audioUrl?, lyrics?, type?, published?,
//     schedule?: { morning: ['mon',…], afternoon: […] },
//     nodeId?, childPath? }
// Omitting `schedule` (or sending empty arrays) leaves the item unscheduled.
// Omitting `nodeId` puts the item directly in the Part, which is where every
// item created before the hierarchy existed sits.
//
// `childPath` files the item deeper than `nodeId`, creating any section on the
// way that does not exist yet:
//
//   nodeId = सकाळ, childPath = [{name:'वाराची पदे'}, {name:'सोमवार (Monday)'}]
//
// It is how the form lets an admin name a new group and a day in one save.
// Each becomes an ordinary section, so both are simply there in the dropdowns
// next time. Accepts plain strings too.
export async function create(req, res) {
  const {
    productId, title, audioUrl = '', lyrics = '', published = true, schedule,
    nodeId, childPath, childName, childKind,
  } = req.body || {}
  // Only the Part is required — an item has to live somewhere. Everything
  // else may be left blank and filled in later.
  if (!productId) return res.status(400).json({ error: 'productId is required.' })

  const pid = await resolveProductId(productId)
  if (pid === null) return res.status(400).json({ error: 'Unknown Part.' })

  // Validate before writing anything, so a typo'd day can't leave a content
  // row behind with half a schedule.
  const { rows: scheduleRows, error } = parseSchedule(schedule)
  if (error) return res.status(400).json({ error })

  let { nodeId: nid, error: nodeError } = await resolveNode(nodeId, pid)
  if (nodeError) return res.status(400).json({ error: nodeError })

  // Deeper sections, created on demand, walked in order. Each needs a section
  // to hang off — a child of nothing has no place to be.
  const steps = Array.isArray(childPath)
    ? childPath
    : childName
      ? [{ name: childName, kind: childKind }]
      : []

  for (const step of steps) {
    const name = typeof step === 'string' ? step : step?.name
    const kind = typeof step === 'string' ? null : step?.kind
    if (!name || !String(name).trim()) continue
    // With no section chosen yet, the first step becomes a top level section
    // of the Part — that is how a Part gets its first section without one
    // having to be created up front.
    const child = await findOrCreateChild(nid, name, kind, pid)
    if (child.error) return res.status(400).json({ error: child.error })
    nid = child.nodeId
  }

  // ── One item per day ───────────────────────────────────────
  // A day holds a single item: once it has content, that day is finished and
  // the next item belongs to another day. Enforced here rather than only in
  // the form so the rule holds however the item arrives. It applies to days
  // alone — an ordinary section still takes as many items as it needs.
  if (nid) {
    const target = await prisma.contentNode.findUnique({
      where: { id: nid },
      select: { name: true, kind: true, _count: { select: { content: true } } },
    })
    if (target?.kind === DAY_KIND && target._count.content > 0) {
      return res.status(409).json({
        error: `“${target.name}” already has content. Choose another day, or edit the item already there.`,
      })
    }
  }

  const cleanTitle = String(title || '').trim() || UNTITLED
  const dupe = await duplicateInNode({ nodeId: nid, title: cleanTitle })
  if (dupe) return res.status(409).json({ error: dupe })

  const count = await prisma.content.count({ where: { productId: pid } })
  const created = await prisma.content.create({
    data: {
      productId: pid,
      title: cleanTitle,
      type: audioUrl ? 'audio' : 'text',
      audioUrl: audioUrl || null,
      lyrics: lyrics || null,
      published: !!published,
      sortOrder: count + 1,
      schedule: scheduleRows.length ? { create: scheduleRows } : undefined,
      nodeId: nid,
    },
    include: WITH_RELATIONS,
  })
  res.status(201).json({ content: shape(created, await sectionMap([pid])) })
}

// PATCH /api/content/:id
//   partial: { published, lyrics, title, sortOrder, audioUrl, schedule, nodeId }
//
// `schedule` is replace-all, not merge: whatever the form last showed is the
// new truth. Sending { morning: [], afternoon: [] } therefore clears it back
// to "None". A PATCH that never mentions `schedule` leaves it untouched.
//
// `nodeId` moves the item to another section; sending null or '' moves it back
// out to sit directly in the Part. A PATCH that never mentions it — every
// PATCH the panel made before the hierarchy existed — leaves it where it is.
export async function update(req, res) {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid content id.' })

  const { published, lyrics, title, sortOrder, audioUrl, schedule, nodeId } = req.body || {}
  const data = {}

  if (schedule !== undefined) {
    const { rows, error } = parseSchedule(schedule)
    if (error) return res.status(400).json({ error })
    data.schedule = { deleteMany: {}, create: rows }
  }

  // Only when the move or rename could create a clash — a publish toggle or a
  // reorder still costs exactly one query, as before.
  if (nodeId !== undefined || title !== undefined) {
    const existing = await prisma.content.findUnique({
      where: { id },
      select: { productId: true, title: true, nodeId: true },
    })
    if (!existing) return res.status(404).json({ error: 'Content item not found.' })

    let targetNode = existing.nodeId
    if (nodeId !== undefined) {
      const { nodeId: nid, error } = await resolveNode(nodeId, existing.productId)
      if (error) return res.status(400).json({ error })
      targetNode = nid
      data.nodeId = nid
    }

    const dupe = await duplicateInNode({
      nodeId: targetNode,
      title: title !== undefined ? String(title).trim() : existing.title,
      ignoreId: id,
    })
    if (dupe) return res.status(409).json({ error: dupe })
  }

  if (published !== undefined) data.published = !!published
  if (lyrics !== undefined) data.lyrics = lyrics
  // Clearing the title falls back rather than leaving a nameless row that no
  // list can show.
  if (title !== undefined) data.title = String(title).trim() || UNTITLED
  if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
  if (audioUrl !== undefined) {
    data.audioUrl = audioUrl || null
    // The type simply follows the audio, in both directions. Attaching a file
    // makes it an audio item; clearing the field makes it a text item.
    //
    // This used to only ever upgrade to 'audio', which left a cleared item
    // marked audio with no file behind it — the Play button sat there dead and
    // the "Text Items" KPI stayed at 0 no matter how many items you emptied.
    // A PATCH that does not mention audioUrl at all still can't change the
    // type, because the whole branch is guarded on `!== undefined`.
    data.type = audioUrl ? 'audio' : 'text'
  }

  try {
    const updated = await prisma.content.update({ where: { id }, data, include: WITH_RELATIONS })
    res.json({ content: shape(updated, await sectionMap([updated.productId])) })
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

// ─────────────────────────────────────────────────────────────
// One-click seed import (POST /api/content/import/:dataset)
//
// Bulk-loads a bundled track list into a Part. Idempotent: an item is skipped
// when a row with the same (product_id, title) already exists, so the button
// can be pressed twice without creating duplicates.
// ─────────────────────────────────────────────────────────────
const DATASETS = {
  // Part 1 = the morning sequence followed by the evening sequence.
  'gitanjali-part1': {
    label: 'Gitanjali Part 1',
    productCode: 'gita1',
    items: GITANJALI_PART1_ITEMS,
  },
  'gitanjali-part2': {
    label: 'Gitanjali Part 2',
    productCode: 'gita2',
    items: GITANJALI_PART2_ITEMS,
  },
  // Upasana track paths are nested ("Upasana/01%20JAYJAYKAR-Master.mp3"), so
  // the files belong in uploads/audio/Upasana/ rather than the audio root.
  upasana: {
    label: 'Upasana',
    productCode: 'upasana',
    items: UPASANA_ITEMS,
  },
  // NOTE: these paths use the folder "Nitayaniyam" (as spelled in the source
  // data), not "Nityaniyam". Kept verbatim so the URLs match the media server;
  // the files belong in uploads/audio/Nitayaniyam/.
  nityaniyam: {
    label: 'Nityaniyam',
    productCode: 'nithya',
    items: NITYANIYAM_ITEMS,
  },
}

export async function importDataset(req, res) {
  const ds = DATASETS[req.params.dataset]
  if (!ds) {
    return res.status(404).json({
      error: `Unknown dataset "${req.params.dataset}". Available: ${Object.keys(DATASETS).join(', ')}.`,
    })
  }

  // 1. Resolve the target Part by its public code.
  const product = await prisma.product.findUnique({ where: { code: ds.productCode } })
  if (!product) {
    return res.status(404).json({ error: `Part "${ds.productCode}" not found. Create it first.` })
  }

  // 2. Existing titles for this Part — one query, not one per item.
  const existing = await prisma.content.findMany({
    where: { productId: product.id },
    select: { title: true, sortOrder: true },
  })
  const taken = new Set(existing.map((c) => c.title))
  const maxOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder || 0), 0)

  // 3. Everything not already present, in source order.
  const fresh = []
  ds.items.forEach((item, i) => {
    const title = String(item.title || '').trim()
    if (!title || taken.has(title)) return
    taken.add(title) // guards against duplicates inside the dataset itself
    fresh.push({
      productId: product.id,
      type: 'audio',
      title,
      duration: 0,
      audioUrl: `/uploads/audio/${item.audioFile}`,
      lyrics: item.lyrics || null,
      published: true,
      // Keep the source ordering so the app plays 00.INTRO first. New rows are
      // appended after anything already in the Part.
      sortOrder: maxOrder + i + 1,
    })
  })

  // 4. Single insert.
  if (fresh.length) await prisma.content.createMany({ data: fresh })

  // 5. Report which audio files are not actually on the server yet. The rows
  //    import fine either way, but without the MP3s nothing will play — better
  //    to say so than to let the admin discover it track by track.
  const audioDir = path.join(UPLOADS_ROOT, 'audio')
  let audioMissing = 0
  for (const item of ds.items) {
    const onDisk = path.join(audioDir, decodeURIComponent(item.audioFile))
    if (!fs.existsSync(onDisk)) audioMissing++
  }

  return res.json({
    success: true,
    inserted: fresh.length,
    skipped: ds.items.length - fresh.length,
    total: ds.items.length,
    part: { id: product.id, code: product.code, name: product.name },
    audioMissing,
  })
}
