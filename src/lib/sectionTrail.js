// ─────────────────────────────────────────────────────────────
// Turning a content item's section id into a readable trail.
//
//   nodeId 221  →  [ संध्याकाळ (Evening), varachi pade 2, सोमवार (Monday) ]
//
// Shared by the admin content API and the mobile app API so both describe an
// item's place the same way, from one query rather than one per row.
// ─────────────────────────────────────────────────────────────
import { prisma } from './prisma.js'

// How far a trail is walked. A guard against a hand-edited cycle in the table
// hanging a request, not a limit on how deep a Part may go.
const MAX_DEPTH = 12

// id → { name, kind, parentId } for every section of the given Parts.
export async function sectionMap(productIds = []) {
  if (!productIds.length) return new Map()
  const nodes = await prisma.contentNode.findMany({
    where: { productId: { in: productIds } },
    select: { id: true, name: true, kind: true, parentId: true },
  })
  return new Map(nodes.map((n) => [n.id, n]))
}

// Root → … → the item's own section. Each step carries its `kind` so a caller
// can tell a day apart from the sections above it without another query.
// Empty for an item that is not filed under any section.
export function sectionPath(nodeId, map) {
  const steps = []
  let current = nodeId
  for (let i = 0; i < MAX_DEPTH && current; i++) {
    const node = map.get(current)
    if (!node) break
    steps.unshift({ name: node.name, kind: node.kind || null })
    current = node.parentId
  }
  return steps
}
