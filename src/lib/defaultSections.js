// ─────────────────────────────────────────────────────────────
// Default sections every Part starts with.
//
// Each Part opens with the same two sections, so the Add Content form always
// offers them whichever Part is chosen. They are ordinary rows in
// `content_node` — not a special case in the UI or the API — so they can be
// renamed, added to, or nested under like any other section. Removing one
// from this list stops NEW Parts getting it and changes nothing that exists.
//
// Names carry both languages because the admin panel is read in both.
// ─────────────────────────────────────────────────────────────
import { prisma } from './prisma.js'

export const DEFAULT_SECTIONS = [
  { name: 'सकाळ (Morning)', kind: 'session' },
  { name: 'संध्याकाळ (Evening)', kind: 'session' },
]

// Names that mean the same thing but were typed before this list settled.
// A Part holding one of these is renamed rather than given a second section
// beside it, so its existing children and content stay where they are.
export const ALIASES = {
  'सकाळ (Morning)': ['सकाळ', 'सकाळी', 'sakal', 'sakaal', 'morning'],
  'संध्याकाळ (Evening)': ['संध्याकाळ', 'संध्याकाळी', 'sandhaykal', 'sandhyakal', 'evening'],
}

// ── Weekdays ─────────────────────────────────────────────────
// Offered by the Add Content form under any section that has no sub-sections
// yet, and created on demand when one is actually used — so a Part only ever
// holds the days it needs rather than seven empty ones everywhere.
//
// This is a list of names, not behaviour: a day is an ordinary section once
// created, and nothing in the API treats `kind: 'day'` specially beyond
// stopping the form offering days inside a day.
export const WEEKDAYS = [
  'सोमवार (Monday)',
  'मंगळवार (Tuesday)',
  'बुधवार (Wednesday)',
  'गुरुवार (Thursday)',
  'शुक्रवार (Friday)',
  'शनिवार (Saturday)',
  'रविवार (Sunday)',
]

export const DAY_KIND = 'day'

// Older spellings, so a day written before this list settled is renamed
// instead of sitting beside a near-identical twin.
export const DAY_ALIASES = {
  'सोमवार (Monday)': ['सोमवार', 'monday'],
  'मंगळवार (Tuesday)': ['मंगळवार', 'tuesday'],
  'बुधवार (Wednesday)': ['बुधवार', 'wednesday'],
  'गुरुवार (Thursday)': ['गुरुवार', 'thursday'],
  'शुक्रवार (Friday)': ['शुक्रवार', 'friday'],
  'शनिवार (Saturday)': ['शनिवार', 'saturday'],
  'रविवार (Sunday)': ['रविवार', 'sunday'],
}

// Find a child section by name under `parentId`, creating it if it is not
// there. Used when the form files content into a day the Part has never had
// before: the day becomes a real section, indistinguishable from one added by
// hand, so it simply appears in the dropdown next time.
// `parentId` may be null, which means "a top level section of this Part" —
// that is how सकाळ or संध्याकाळ comes into being the first time one is used.
// `productId` is only needed for that case; under a parent it is inherited.
export async function findOrCreateChild(parentId, name, kind = null, productId = null) {
  const cleanName = String(name || '').trim()
  if (!cleanName) return { error: 'Section name is required.' }

  let pid = productId
  if (parentId) {
    const parent = await prisma.contentNode.findUnique({
      where: { id: parentId },
      select: { id: true, productId: true },
    })
    if (!parent) return { error: 'Parent section not found.' }
    pid = parent.productId
  }
  if (!pid) return { error: 'Part not known for this section.' }

  const existing = await prisma.contentNode.findFirst({
    where: { productId: pid, parentId: parentId ?? null, name: cleanName },
    select: { id: true },
  })
  if (existing) return { nodeId: existing.id, created: false }

  const count = await prisma.contentNode.count({
    where: { productId: pid, parentId: parentId ?? null },
  })
  const node = await prisma.contentNode.create({
    data: {
      productId: pid,
      parentId: parentId ?? null,
      name: cleanName,
      kind: kind ? String(kind).trim().slice(0, 64) : null,
      sortOrder: count + 1,
    },
    select: { id: true },
  })
  return { nodeId: node.id, created: true }
}

// Give a Part its default sections. Returns what it did, so a caller can
// report it. Safe to call on a Part that already has them.
//
//   • a section already named exactly right  → left alone
//   • a section named one of its aliases     → renamed, keeping its contents
//   • nothing matching                       → created
export async function ensureDefaultSections(productId) {
  const existing = await prisma.contentNode.findMany({
    where: { productId, parentId: null },
    select: { id: true, name: true },
  })

  const created = []
  const renamed = []

  for (const [index, spec] of DEFAULT_SECTIONS.entries()) {
    if (existing.some((n) => n.name === spec.name)) continue

    const aliases = ALIASES[spec.name] || []
    const match = existing.find((n) => aliases.includes(n.name.trim().toLowerCase()) || aliases.includes(n.name.trim()))

    if (match) {
      await prisma.contentNode.update({
        where: { id: match.id },
        data: { name: spec.name, kind: spec.kind },
      })
      renamed.push({ from: match.name, to: spec.name })
      continue
    }

    // Ordered ahead of anything the admin has already added, so the two
    // defaults stay at the top of the dropdown.
    await prisma.contentNode.create({
      data: { productId, parentId: null, name: spec.name, kind: spec.kind, sortOrder: index + 1 },
    })
    created.push(spec.name)
  }

  return { created, renamed }
}
