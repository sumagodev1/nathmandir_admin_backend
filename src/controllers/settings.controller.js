// ── Settings controller (key/value store) ─────────────────────
// Handlers for /api/settings. Pricing lives on /api/products; this
// covers docs (about/terms/privacy) and admin preferences.
import { prisma } from '../lib/prisma.js'

// GET /api/settings   — all settings as { key: value }
export async function get(req, res) {
  const rows = await prisma.setting.findMany()
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  res.json({ settings })
}

// PUT /api/settings   — upsert many { key: value } pairs
export async function update(req, res) {
  const updates = req.body || {}
  if (typeof updates !== 'object' || Array.isArray(updates)) {
    return res.status(400).json({ error: 'Expected an object of { key: value } pairs.' })
  }

  await prisma.$transaction(
    Object.entries(updates).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      })
    )
  )

  const rows = await prisma.setting.findMany()
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) })
}
