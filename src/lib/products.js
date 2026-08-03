// ─────────────────────────────────────────────────────────────
// Product identity helpers.
//
// The `products` table has TWO identifiers and they serve different jobs:
//
//   id   Int     — surrogate primary key. Every foreign key (content,
//                  sales, user_access) points at this. It also lines up with
//                  the legacy PHP package_id (1=gita1, 2=gita2, 4=upasana,
//                  5=nithya), which is why the numbers are not contiguous.
//
//   code String  — the STABLE PUBLIC identifier ("gita1"). The deployed
//                  mobile APK and the website checkout both send and receive
//                  this on the wire, so it can never change for an existing
//                  module and must keep appearing in those payloads.
//
// Rule of thumb: join on `id`, speak `code`. These helpers do the translation
// in one place so no controller has to hand-roll it.
// ─────────────────────────────────────────────────────────────
import { prisma } from './prisma.js'

// Accepts whatever a client sent — "gita1", "1", or 1 — and returns the
// numeric product id, or null when nothing matches.
export async function resolveProductId(ref) {
  if (ref === null || ref === undefined || ref === '') return null

  // A bare number (or numeric string) is treated as the surrogate id.
  const asNum = Number(ref)
  if (Number.isInteger(asNum) && String(ref).trim() !== '' && !Number.isNaN(asNum)) {
    const byId = await prisma.product.findUnique({ where: { id: asNum }, select: { id: true } })
    if (byId) return byId.id
  }

  const byCode = await prisma.product.findUnique({
    where: { code: String(ref) },
    select: { id: true },
  })
  return byCode ? byCode.id : null
}

// id → code and code → id lookup tables, for turning a page of rows into
// wire-shaped data without one query per row.
export async function productMaps() {
  const rows = await prisma.product.findMany({ select: { id: true, code: true, name: true } })
  return {
    all: rows,
    codeById: new Map(rows.map((p) => [p.id, p.code])),
    idByCode: new Map(rows.map((p) => [p.code, p.id])),
    nameById: new Map(rows.map((p) => [p.id, p.name])),
  }
}

// Turn a slug into a `code` that is not already taken.
export const uniqueCode = (base, taken = []) => {
  const root =
    String(base).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'part'
  let code = root
  let n = 2
  while (taken.includes(code)) code = `${root}-${n++}`
  return code
}
