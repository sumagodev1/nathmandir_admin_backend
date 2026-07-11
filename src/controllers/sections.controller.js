// ── Website Content (SiteSection) controller ──────────────────
// Admin CRUD for the public-website content sections. The admin edits
// in ONE language and the backend auto-translates the other two at
// save time (see lib/translate.js), storing the full { en, hi, mr }.
import { prisma } from '../lib/prisma.js'

export const SECTION_KEYS = ['maharaj', 'temple', 'trust', 'events', 'donate', 'story']

const LANG_KEYS = ['en', 'hi', 'mr']

// A "localized" field is an object whose keys are all in { en, hi, mr }.
const isLocalized = (o) =>
  o && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length > 0 && Object.keys(o).every((k) => LANG_KEYS.includes(k))

// Merge the admin's edit into the stored data, changing ONLY `sourceLang`.
// Every localized field keeps its other two languages from `prev`; only the
// edited language is updated. Structural fields take the incoming value.
function applySourceLang(incoming, prev, sourceLang) {
  if (isLocalized(incoming)) {
    const base = isLocalized(prev) ? prev : {}
    return { ...base, ...incoming, [sourceLang]: incoming[sourceLang] ?? '' }
  }
  if (Array.isArray(incoming)) {
    return incoming.map((item, i) =>
      applySourceLang(item, Array.isArray(prev) ? prev[i] : undefined, sourceLang)
    )
  }
  if (incoming && typeof incoming === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(incoming)) {
      out[k] = applySourceLang(v, prev ? prev[k] : undefined, sourceLang)
    }
    return out
  }
  return incoming
}

const parseRow = (row) => ({
  key: row.key,
  data: safeParse(row.data),
  updatedOn: row.updatedOn,
})

const safeParse = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

// GET /api/sections — all sections
export async function list(req, res) {
  const rows = await prisma.siteSection.findMany()
  res.json({ sections: rows.map(parseRow) })
}

// GET /api/sections/:key — one section
export async function get(req, res) {
  const row = await prisma.siteSection.findUnique({ where: { key: req.params.key } })
  if (!row) return res.status(404).json({ error: 'Section not found.' })
  res.json({ section: parseRow(row) })
}

// PUT /api/sections/:key   body: { data, sourceLang }
// Updates ONLY the chosen language. The other two languages are preserved
// exactly as they were — editing English changes only the English text.
export async function update(req, res) {
  const key = req.params.key
  if (!SECTION_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown section.' })

  const { data, sourceLang = 'en' } = req.body || {}
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'A data object is required.' })
  }
  if (!LANG_KEYS.includes(sourceLang)) {
    return res.status(400).json({ error: 'sourceLang must be en, hi or mr.' })
  }

  const existing = await prisma.siteSection.findUnique({ where: { key } })
  const prevData = existing ? safeParse(existing.data) : null

  const merged = applySourceLang(data, prevData, sourceLang)
  const json = JSON.stringify(merged)

  const row = await prisma.siteSection.upsert({
    where: { key },
    update: { data: json },
    create: { key, data: json },
  })
  res.json({ section: parseRow(row) })
}
