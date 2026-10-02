// ── Policies controller (admin) ───────────────────────────────
// Handlers for /api/policies: the Privacy Policy and Terms & Conditions the
// admin edits. One row per type. Saving creates the row the first time and
// afterwards bumps its version — but only when the title or content really
// changed, so pressing Save twice does not make every app user re-accept.
import { prisma } from '../lib/prisma.js'
import {
  POLICY_LABELS,
  isPolicyType,
  cleanPolicyHtml,
  isBlankHtml,
  shapePolicy,
  findPolicy,
  listPolicies,
} from '../lib/policies.js'

const badType = (res) =>
  res.status(400).json({ error: 'Unknown policy type. Use "privacy" or "terms".' })

// GET /api/policies   — both policies (a type not written yet is simply absent)
export async function list(req, res) {
  const rows = await listPolicies()
  res.json({ policies: rows.map(shapePolicy) })
}

// GET /api/policies/:type   — one policy, or { policy: null } before the first save
// null rather than 404, so the editor can tell "not written yet" from "failed".
export async function get(req, res) {
  const { type } = req.params
  if (!isPolicyType(type)) return badType(res)
  const row = await findPolicy(type)
  res.json({ policy: row ? shapePolicy(row) : null })
}

// PUT /api/policies/:type   { title, content }   — create or update
export async function save(req, res) {
  const { type } = req.params
  if (!isPolicyType(type)) return badType(res)

  const title = String(req.body?.title ?? '').trim()
  const content = cleanPolicyHtml(req.body?.content)
  if (!title) return res.status(400).json({ error: 'Title is required.' })
  if (title.length > 191) return res.status(400).json({ error: 'Title must be 191 characters or fewer.' })
  if (isBlankHtml(content)) return res.status(400).json({ error: 'Content is required.' })

  const existing = await findPolicy(type)

  if (!existing) {
    const row = await prisma.policy.create({ data: { type, title, content, version: 1 } })
    return res.status(201).json({
      policy: shapePolicy(row),
      changed: true,
      message: `${POLICY_LABELS[type]} created (version 1).`,
    })
  }

  if (existing.title === title && existing.content === content) {
    return res.json({
      policy: shapePolicy(existing),
      changed: false,
      message: `No changes. ${POLICY_LABELS[type]} is still version ${existing.version}.`,
    })
  }

  const row = await prisma.policy.update({
    where: { type },
    data: { title, content, version: { increment: 1 } },
  })
  res.json({
    policy: shapePolicy(row),
    changed: true,
    message: `${POLICY_LABELS[type]} updated. Now on version ${row.version}.`,
  })
}
