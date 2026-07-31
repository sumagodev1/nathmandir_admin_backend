// ── Content controller ────────────────────────────────────────
// Handlers for /api/content (audio + text items).
import fs from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma.js'
import { resolveProductId } from '../lib/products.js'
import { UPLOADS_ROOT } from './uploads.controller.js'
import { GITANJALI_PART1_ITEMS } from '../data/gitanjaliPart1.js'
import { GITANJALI_PART2_ITEMS } from '../data/gitanjaliPart2.js'
import { UPASANA_ITEMS } from '../data/upasana.js'
import { NITYANIYAM_ITEMS } from '../data/nityaniyam.js'

const shape = (c) => ({
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
})

// GET /api/content?product=all|<code>&query=
export async function list(req, res) {
  const { product = 'all', query = '' } = req.query
  const where = {}
  if (product && product !== 'all') {
    // ?product= accepts either the numeric id or the public code.
    const pid = await resolveProductId(product)
    if (pid === null) return res.json({ content: [], total: 0 })
    where.productId = pid
  }
  if (query) where.title = { contains: String(query) }

  const rows = await prisma.content.findMany({
    where,
    include: { product: true },
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

  res.json({
    content: rows.map((c) => ({ ...shape(c), listeners: listenerMap.get(c.productId) ?? 0 })),
    total: rows.length,
  })
}

// POST /api/content   { productId, title, audioUrl?, lyrics?, type?, published? }
export async function create(req, res) {
  const { productId, title, audioUrl = '', lyrics = '', published = true } = req.body || {}
  if (!productId) return res.status(400).json({ error: 'productId is required.' })
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.' })

  const pid = await resolveProductId(productId)
  if (pid === null) return res.status(400).json({ error: 'Unknown Part.' })

  const count = await prisma.content.count({ where: { productId: pid } })
  const created = await prisma.content.create({
    data: {
      productId: pid,
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
