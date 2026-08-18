// ── Gitanjali Part 1 → संध्याकाळ → <sub part> → <day> ─────────
// Files a weekday's tracks into its own section, creating any section on the
// path that the Part does not have yet:
//
//   Gitanjali Part 1
//    └── संध्याकाळ (Evening)      (session)
//         ├── वाराची पदे          (sub part)
//         │    └── रविवार (Sunday) (day)  → the items
//         └── स्तोत्र              (sub part)
//              └── रविवार (Sunday) (day)  → the items
//
// Both sub parts are keyed the same way — one list per weekday — so they
// share this script rather than a copy each. A day lives under its sub part,
// so the same weekday appears once in वाराची पदे and once in स्तोत्र, each
// holding its own items.
//
// Day names match lib/defaultSections.js WEEKDAYS, so a day created here is
// the same row the Add Content form would have made — it just appears in the
// dropdown already filled.
//
// The items come from src/data/ so titles, audio paths and lyrics are never
// retyped here; this file only says where they go.
//
// Idempotent: an item whose title is already in that day's section is
// skipped, so the script can be run twice without duplicating anything.
//
//   node scripts/import-evening-days.js                        # report only
//   node scripts/import-evening-days.js --apply                # write
//   node scripts/import-evening-days.js --apply --only=stotra
//   node scripts/import-evening-days.js --apply --only=stotra:monday
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { DAY_KIND, WEEKDAYS } from '../src/lib/defaultSections.js'
import * as pade from '../src/data/varachiPade.js'
import * as stotra from '../src/data/stotra.js'

const APPLY = process.argv.includes('--apply')
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || ''
const PRODUCT_CODE = 'gita1'

const EVENING = { name: 'संध्याकाळ (Evening)', kind: 'session' }

// A day's sortOrder is its position in WEEKDAYS, not the order it happened to
// be imported in — so a sub part reads सोमवार…रविवार in the admin tree
// however many runs it took to fill.
const day = (name, items) => ({
  section: { name, kind: DAY_KIND, sortOrder: WEEKDAYS.indexOf(name) + 1 },
  items,
})

// One entry per sub part, and under it one entry per weekday that has a
// bundled list. Add a day by exporting its array from the sub part's data
// file and naming it here.
//
// गुरुवार (Thursday) is absent from वाराची पदे because no list has been
// supplied for it yet; स्तोत्र has all seven.
const SUBPARTS = {
  'varachi-pade': {
    section: { name: 'वाराची पदे', kind: 'sub part' },
    days: {
      monday: day('सोमवार (Monday)', pade.MONDAY_ITEMS),
      tuesday: day('मंगळवार (Tuesday)', pade.TUESDAY_ITEMS),
      wednesday: day('बुधवार (Wednesday)', pade.WEDNESDAY_ITEMS),
      friday: day('शुक्रवार (Friday)', pade.FRIDAY_ITEMS),
      saturday: day('शनिवार (Saturday)', pade.SATURDAY_ITEMS),
      sunday: day('रविवार (Sunday)', pade.SUNDAY_ITEMS),
    },
  },
  stotra: {
    section: { name: 'स्तोत्र', kind: 'sub part' },
    days: {
      monday: day('सोमवार (Monday)', stotra.MONDAY_ITEMS),
      tuesday: day('मंगळवार (Tuesday)', stotra.TUESDAY_ITEMS),
      wednesday: day('बुधवार (Wednesday)', stotra.WEDNESDAY_ITEMS),
      thursday: day('गुरुवार (Thursday)', stotra.THURSDAY_ITEMS),
      friday: day('शुक्रवार (Friday)', stotra.FRIDAY_ITEMS),
      saturday: day('शनिवार (Saturday)', stotra.SATURDAY_ITEMS),
      sunday: day('रविवार (Sunday)', stotra.SUNDAY_ITEMS),
    },
  },
}

// Resolve one section under `parentId`, creating it when --apply is given.
// Returns null on a dry run for a section that is not there yet — there is no
// id to hang children off, so the caller reports the rest and stops.
async function resolveSection(productId, parentId, spec, indent) {
  const pad = '  '.repeat(indent)

  const found = await prisma.contentNode.findFirst({
    where: { productId, parentId: parentId ?? null, name: spec.name },
  })
  if (found) {
    // A day imported before its siblings sits wherever it landed. Nudge it
    // back into weekday order; nothing else about the section is touched.
    if (spec.sortOrder && found.sortOrder !== spec.sortOrder) {
      if (APPLY) {
        await prisma.contentNode.update({ where: { id: found.id }, data: { sortOrder: spec.sortOrder } })
        console.log(`${pad}section   ${spec.name}  (already there, reordered to ${spec.sortOrder})`)
      } else {
        console.log(`${pad}section   ${spec.name}  (already there, WOULD reorder to ${spec.sortOrder})`)
      }
      return found
    }
    console.log(`${pad}section   ${spec.name}  (already there)`)
    return found
  }
  if (!APPLY) {
    console.log(`${pad}WOULD ADD section ${spec.name}  (${spec.kind})`)
    return null
  }

  const count = await prisma.contentNode.count({ where: { productId, parentId: parentId ?? null } })
  const node = await prisma.contentNode.create({
    data: {
      productId,
      parentId: parentId ?? null,
      name: spec.name,
      kind: spec.kind,
      sortOrder: spec.sortOrder ?? count + 1,
    },
  })
  console.log(`${pad}ADDED     section ${spec.name}  (${spec.kind})`)
  return node
}

async function fileDay(product, subpart, dayKey) {
  const { section: daySpec, items } = subpart.days[dayKey]
  const trail = [EVENING, subpart.section, daySpec]

  let parentId = null
  let depth = 2
  for (const [i, spec] of trail.entries()) {
    const node = await resolveSection(product.id, parentId, spec, depth)
    if (!node) {
      // Dry run against a path that does not exist yet: nothing below it can
      // be looked up, so report what would follow and move on.
      for (const rest of trail.slice(i + 1)) {
        console.log(`${'  '.repeat(depth + 1)}WOULD ADD section ${rest.name}  (${rest.kind})`)
      }
      items.forEach((it) => console.log(`${'  '.repeat(depth + 1)}WOULD ADD ${it.title}`))
      return items.length
    }
    parentId = node.id
    depth++
  }

  const pad = '  '.repeat(depth)
  const taken = new Set(
    (await prisma.content.findMany({ where: { nodeId: parentId }, select: { title: true } })).map((c) => c.title)
  )
  // Sort order is per Part, so continue after whatever the Part already holds.
  const maxOrder =
    (await prisma.content.aggregate({ where: { productId: product.id }, _max: { sortOrder: true } }))._max
      .sortOrder || 0

  let added = 0
  for (const [i, item] of items.entries()) {
    if (taken.has(item.title)) {
      console.log(`${pad}ok        ${item.title}`)
      continue
    }
    if (!APPLY) {
      console.log(`${pad}WOULD ADD ${item.title}`)
      added++
      continue
    }

    await prisma.content.create({
      data: {
        productId: product.id,
        nodeId: parentId,
        type: 'audio',
        title: item.title,
        duration: 0,
        audioUrl: `/uploads/audio/${item.audioFile}`,
        lyrics: item.lyrics || null,
        published: true,
        sortOrder: maxOrder + i + 1,
      },
    })
    console.log(`${pad}ADDED     ${item.title}`)
    added++
  }
  return added
}

// --only= takes a sub part ("stotra") or one day of one ("stotra:monday").
// Absent, everything runs.
function selection() {
  if (!ONLY) {
    return Object.entries(SUBPARTS).flatMap(([sk, sp]) => Object.keys(sp.days).map((dk) => [sk, dk]))
  }

  const [subKey, dayKey] = ONLY.split(':')
  const sub = SUBPARTS[subKey]
  if (!sub) throw new Error(`Unknown sub part "${subKey}". Use ${Object.keys(SUBPARTS).join(' or ')}.`)
  if (!dayKey) return Object.keys(sub.days).map((dk) => [subKey, dk])
  if (!sub.days[dayKey]) {
    throw new Error(`Unknown day "${dayKey}" for ${subKey}. Use ${Object.keys(sub.days).join(' or ')}.`)
  }
  return [[subKey, dayKey]]
}

async function main() {
  const product = await prisma.product.findUnique({ where: { code: PRODUCT_CODE } })
  if (!product) throw new Error(`Part "${PRODUCT_CODE}" not found.`)

  const wanted = selection()
  console.log(`${product.name}  (${APPLY ? 'APPLY' : 'dry run'})`)

  let added = 0
  for (const [subKey, dayKey] of wanted) {
    console.log(`\n  ${subKey} / ${dayKey}`)
    added += await fileDay(product, SUBPARTS[subKey], dayKey)
  }

  console.log(`\n${APPLY ? 'Added' : 'Would add'} ${added} item(s).`)
  if (!APPLY) console.log('Re-run with --apply to write.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
