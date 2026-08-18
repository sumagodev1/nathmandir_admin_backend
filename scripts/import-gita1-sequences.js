// ── Gitanjali Part 1 → सकाळ / संध्याकाळ ───────────────────────
// Files the morning and evening sequences into their sections, creating a
// section if the Part does not have it yet.
//
// The items come from src/data/gitanjaliPart1.js — the same bundled data the
// "Import Gitanjali Part 1" button uses — so titles, audio paths and lyrics
// are never retyped here. Only the ORDER of each sequence lives in this file,
// because the bundled list is one flat run while the two sequences have their
// own order and overlap:
//
//   जयजयकार, षट्चक्र and अष्टांगयोग belong to BOTH sequences. Each gets its
//   own row in each section — a section is where an item lives, and one row
//   cannot live in two places.
//
// Idempotent: an item whose title is already in that section is skipped, so
// the script can be run twice without duplicating anything.
//
//   node scripts/import-gita1-sequences.js                     # report only
//   node scripts/import-gita1-sequences.js --apply             # both
//   node scripts/import-gita1-sequences.js --apply --only=evening
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { GITANJALI_PART1_ITEMS } from '../src/data/gitanjaliPart1.js'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''
const PRODUCT_CODE = 'gita1'

const SEQUENCES = {
  morning: {
    section: { name: 'सकाळ (Morning)', kind: 'session' },
    order: [
      'jayajaykar',
      'bhupali',
      'kakada',
      'prabhati1',
      'prabhati2',
      'servodya',
      'shatchakra',
      'ashtangyog',
    ],
  },
  evening: {
    section: { name: 'संध्याकाळ (Evening)', kind: 'session' },
    order: [
      'jayajaykar',
      'palana',
      'shejarati',
      'pradakshina',
      'vida',
      'bolawe',
      'hrudaykamal',
      'bharatvakya',
      'anantkoti',
      'sangrah',
      'sodina',
      'lalite',
      'sakya',
      'shatchakra',
      'bhairavi',
      'ashtangyog',
    ],
  },
}

async function fileSequence(product, byId, { section: spec, order }) {
  console.log(`\n  ${spec.name}`)

  let section = await prisma.contentNode.findFirst({
    where: { productId: product.id, parentId: null, name: spec.name },
  })
  if (section) {
    console.log(`    section   ${spec.name}  (already there)`)
  } else if (!APPLY) {
    console.log(`    WOULD ADD section ${spec.name}`)
  } else {
    const count = await prisma.contentNode.count({ where: { productId: product.id, parentId: null } })
    section = await prisma.contentNode.create({
      data: { productId: product.id, parentId: null, name: spec.name, kind: spec.kind, sortOrder: count + 1 },
    })
    console.log(`    ADDED     section ${spec.name}`)
  }

  const taken = new Set(
    section
      ? (await prisma.content.findMany({ where: { nodeId: section.id }, select: { title: true } })).map((c) => c.title)
      : []
  )
  const maxOrder = (
    await prisma.content.aggregate({ where: { productId: product.id }, _max: { sortOrder: true } })
  )._max.sortOrder || 0

  let added = 0
  for (const [i, id] of order.entries()) {
    const item = byId.get(id)
    if (!item) { console.log(`    MISSING   ${id} — not in the bundled data`); continue }
    if (taken.has(item.title)) { console.log(`    ok        ${item.title}`); continue }
    if (!APPLY) { console.log(`    WOULD ADD ${item.title}`); added++; continue }

    await prisma.content.create({
      data: {
        productId: product.id,
        nodeId: section.id,
        type: 'audio',
        title: item.title,
        duration: 0,
        audioUrl: `/uploads/audio/${item.audioFile}`,
        lyrics: item.lyrics || null,
        published: true,
        sortOrder: maxOrder + i + 1,
      },
    })
    console.log(`    ADDED     ${item.title}`)
    added++
  }
  return added
}

async function main() {
  const product = await prisma.product.findUnique({ where: { code: PRODUCT_CODE } })
  if (!product) throw new Error(`Part "${PRODUCT_CODE}" not found.`)

  const wanted = ONLY ? [ONLY] : Object.keys(SEQUENCES)
  for (const key of wanted) {
    if (!SEQUENCES[key]) throw new Error(`Unknown sequence "${key}". Use ${Object.keys(SEQUENCES).join(' or ')}.`)
  }

  const byId = new Map(GITANJALI_PART1_ITEMS.map((i) => [i.id, i]))
  console.log(`${product.name}  (${APPLY ? 'APPLY' : 'dry run'})`)

  let added = 0
  for (const key of wanted) added += await fileSequence(product, byId, SEQUENCES[key])

  console.log(`\n${APPLY ? 'Added' : 'Would add'} ${added} item(s).`)
  if (!APPLY) console.log('Re-run with --apply to write.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
