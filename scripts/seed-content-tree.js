// ── Create a section tree for a Part ──────────────────────────
// A convenience for building a hierarchy that would otherwise be twenty
// clicks in the admin panel. It only creates SECTIONS — never content, never
// a change to an existing row.
//
// The shape below is plain data. Edit it, or copy it for another Part: the
// script has no idea what "सकाळी" or "सोमवार" mean, it just walks the object.
// Nesting can be as deep as you like.
//
// Safe to re-run: a section whose name already exists under the same parent
// is left alone, so this fills in gaps rather than duplicating.
//
//   node scripts/seed-content-tree.js           # report only, changes nothing
//   node scripts/seed-content-tree.js --apply   # create the missing sections
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const APPLY = process.argv.includes('--apply')

// The weekday list lives here, as data, exactly like every other level. The
// application does not know these are days.
const WEEKDAYS = ['सोमवार', 'मंगळवार', 'बुधवार', 'गुरुवार', 'शुक्रवार', 'शनिवार', 'रविवार']
const days = () => WEEKDAYS.map((name) => ({ name, kind: 'day' }))

// productCode → the tree to build under it.
const TREES = {
  gita1: [
    { name: 'सकाळी', kind: 'session' },
    {
      name: 'संध्याकाळी',
      kind: 'session',
      children: [
        { name: 'वाराची पदे', kind: 'sub part', children: days() },
        { name: 'स्तोत्र', kind: 'sub part' },
      ],
    },
  ],
}

let created = 0
let existing = 0

async function build(productId, parentId, list, depth = 0) {
  for (const spec of list) {
    const pad = '  '.repeat(depth + 1)

    let node = await prisma.contentNode.findFirst({
      where: { productId, parentId, name: spec.name },
    })

    if (node) {
      console.log(`${pad}ok      ${spec.name}`)
      existing++
    } else if (!APPLY) {
      console.log(`${pad}WOULD   ${spec.name}${spec.kind ? `  (${spec.kind})` : ''}`)
      created++
      // Nothing was written, so there is no id to hang children off. Report
      // them at the right depth and move on.
      if (spec.children?.length) await report(spec.children, depth + 1)
      continue
    } else {
      const count = await prisma.contentNode.count({ where: { productId, parentId } })
      node = await prisma.contentNode.create({
        data: { productId, parentId, name: spec.name, kind: spec.kind || null, sortOrder: count + 1 },
      })
      console.log(`${pad}ADDED   ${spec.name}${spec.kind ? `  (${spec.kind})` : ''}`)
      created++
    }

    if (spec.children?.length) await build(productId, node.id, spec.children, depth + 1)
  }
}

// Dry-run helper for branches under a section that does not exist yet.
async function report(list, depth) {
  for (const spec of list) {
    console.log(`${'  '.repeat(depth + 1)}WOULD   ${spec.name}${spec.kind ? `  (${spec.kind})` : ''}`)
    created++
    if (spec.children?.length) await report(spec.children, depth + 1)
  }
}

async function main() {
  console.log(`Content sections (${APPLY ? 'APPLY' : 'dry run'})\n`)

  for (const [code, tree] of Object.entries(TREES)) {
    const product = await prisma.product.findUnique({ where: { code } })
    if (!product) {
      console.log(`  skip  Part "${code}" not found`)
      continue
    }
    console.log(`  ${product.name}`)
    await build(product.id, null, tree)
  }

  console.log(
    `\n${APPLY ? 'Created' : 'Would create'} ${created} section(s), ${existing} already existed.` +
      ' No content item was created, edited or removed.'
  )
  if (!APPLY && created) console.log('Re-run with --apply to create them.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
