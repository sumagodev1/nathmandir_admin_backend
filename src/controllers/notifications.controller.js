// ── Notifications controller ──────────────────────────────────
// Handlers for /api/notifications.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

const shape = (n) => ({
  id: n.id,
  title: n.title,
  message: n.message,
  audience: n.audience,
  reach: n.reach,
  sentOn: ymd(n.sentOn),
})

// GET /api/notifications?query=&from=&to=&page=&limit=  — history
export async function list(req, res) {
  const { query = '', from = '', to = '' } = req.query
  const rows = await prisma.notification.findMany({ orderBy: { sentOn: 'desc' } })

  const q = String(query).trim().toLowerCase()
  const list = rows.map(shape).filter((n) => {
    const matchQ =
      !q || n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q) || n.audience.toLowerCase().includes(q)
    const matchFrom = !from || n.sentOn >= from
    const matchTo = !to || n.sentOn <= to
    return matchQ && matchFrom && matchTo
  })

  const pg = paginate(list, req.query)
  res.json({ notifications: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}

// POST /api/notifications  — send { title, message, audience }
export async function create(req, res) {
  const { title, message, audience = 'all' } = req.body || {}
  if (!title?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Title and message are required.' })
  }

  // Estimate reach: 'all' = every user, else users who own that product.
  let reach
  if (audience === 'all') {
    reach = await prisma.user.count()
  } else {
    reach = await prisma.userAccess.count({ where: { productId: audience } })
  }

  const created = await prisma.notification.create({
    data: { title: title.trim(), message: message.trim(), audience, reach },
  })
  res.status(201).json({ notification: shape(created) })
}

// ─────────────────────────────────────────────────────────────
// Admin alert feed (the topbar bell)
//
// The bell shows real activity, derived on read from the tables that already
// record it — new devotee registrations, successful purchases and incoming
// contact messages. Each source is gated by the matching `pref.alert.*`
// toggle on the Settings screen (absent = enabled).
//
// Read state is per-admin and lives in the Setting store:
//   admin.<id>.alerts.lastSeenAt        — ISO timestamp
//   admin.<id>.alerts.lastSeenContactId — watermark for `contact`, which has
//                                         no date column to compare against
// ─────────────────────────────────────────────────────────────

// Items pulled per source. This alone bounds the feed — there is deliberately
// no "last N days" cut-off: this temple's most recent purchase is months old,
// and a date window made purchases look permanently absent (i.e. broken). Age
// is communicated by the `ago` label instead, and what counts as unread is
// decided by the read watermark, not by recency.
//
// Keep FEED_LIMIT * (number of sources) <= FEED_TOTAL so every enabled source
// survives the final slice. Contact items carry no timestamp and therefore sort
// last, so a tighter total would silently drop them altogether.
const FEED_LIMIT = 8
const FEED_TOTAL = 30

const seenAtKey = (adminId) => `admin.${adminId}.alerts.lastSeenAt`
const seenContactKey = (adminId) => `admin.${adminId}.alerts.lastSeenContactId`

// Contact messages are free-text with hard line breaks; flatten to one line so
// the bell's preview doesn't blow out its row height.
const oneLine = (s, max) => {
  const flat = String(s || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

// Relative-time label the UI can show as-is ("2h ago").
const ago = (date) => {
  if (!date) return ''
  const secs = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}

async function readAlertState(adminId) {
  const keys = [
    'pref.alert.newUser',
    'pref.alert.newSale',
    'pref.alert.newContact',
    seenAtKey(adminId),
    seenContactKey(adminId),
  ]
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } })
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    // Absent means "not configured yet" → on, so the bell works out of the box.
    enabled: (key) => map[key] !== 'false',
    lastSeenAt: map[seenAtKey(adminId)] ? new Date(map[seenAtKey(adminId)]) : null,
    lastSeenContactId: Number(map[seenContactKey(adminId)] || 0),
  }
}

// GET /api/notifications/alerts
export async function alerts(req, res) {
  const adminId = req.admin.id
  const { enabled, lastSeenAt, lastSeenContactId } = await readAlertState(adminId)
  const isNew = (at) => !lastSeenAt || new Date(at) > lastSeenAt

  const items = []

  if (enabled('pref.alert.newUser')) {
    const users = await prisma.user.findMany({
      orderBy: { registeredOn: 'desc' },
      take: FEED_LIMIT,
      select: { id: true, name: true, city: true, registeredOn: true },
    })
    items.push(
      ...users.map((u) => ({
        id: `user-${u.id}`,
        kind: 'user',
        title: 'New devotee registered',
        body: [u.name, u.city].filter(Boolean).join(' · '),
        at: u.registeredOn,
        ago: ago(u.registeredOn),
        link: `/admin/users/${u.id}`,
        unread: isNew(u.registeredOn),
      }))
    )
  }

  if (enabled('pref.alert.newSale')) {
    const sales = await prisma.sale.findMany({
      where: { status: 'success' },
      orderBy: { createdAt: 'desc' },
      take: FEED_LIMIT,
      include: { user: { select: { name: true } }, product: { select: { name: true } } },
    })
    items.push(
      ...sales.map((s) => ({
        id: `sale-${s.id}`,
        kind: 'sale',
        title: `Purchase — ₹${s.amount.toLocaleString('en-IN')}`,
        body: [s.user?.name, s.product?.name].filter(Boolean).join(' · '),
        at: s.createdAt,
        ago: ago(s.createdAt),
        link: '/admin/sales',
        unread: isNew(s.createdAt),
      }))
    )
  }

  if (enabled('pref.alert.newContact')) {
    // `contact` is a legacy table with no date column, so "new" is decided by
    // an id watermark and these items carry no timestamp.
    try {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT id, name, message FROM contact ORDER BY id DESC LIMIT ${FEED_LIMIT}`
      )
      items.push(
        ...rows.map((c) => ({
          id: `contact-${c.id}`,
          kind: 'contact',
          title: 'New contact message',
          body: [oneLine(c.name, 40), oneLine(c.message, 70)].filter(Boolean).join(' — '),
          at: null,
          ago: '',
          link: '/admin/contacts',
          unread: Number(c.id) > lastSeenContactId,
        }))
      )
    } catch {
      // Table absent (fresh install) — just skip this source.
    }
  }

  // Unread first (that's what the bell is for), then newest first. Contact
  // items have no timestamp, so they settle at the end once read.
  items.sort((a, b) => {
    if (a.unread !== b.unread) return a.unread ? -1 : 1
    if (a.at && b.at) return new Date(b.at) - new Date(a.at)
    if (a.at) return -1
    if (b.at) return 1
    return 0
  })

  res.json({
    alerts: items.slice(0, FEED_TOTAL),
    unread: items.filter((i) => i.unread).length,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
  })
}

// POST /api/notifications/alerts/seen  — clear the unread badge
export async function markAlertsSeen(req, res) {
  const adminId = req.admin.id
  const now = new Date().toISOString()

  // Watermark the contact table at its current max id.
  let maxContactId = 0
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(id), 0) AS maxId FROM contact`)
    maxContactId = Number(rows?.[0]?.maxId || 0)
  } catch {
    /* table absent — leave the watermark alone */
  }

  const put = (key, value) =>
    prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } })

  await prisma.$transaction([
    put(seenAtKey(adminId), now),
    put(seenContactKey(adminId), String(maxContactId)),
  ])

  res.json({ ok: true, lastSeenAt: now })
}
