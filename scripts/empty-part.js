// ── Empty a Part ──────────────────────────────────────────────
// Removes every content item and every section from one Part, leaving the
// Part itself in place. The Part keeps its name, code, price and any sales or
// access grants — only its contents go.
//
// Deleting the Part instead would also remove it from the app and the website,
// which is a different and much larger step; this script never does that.
//
//   node scripts/empty-part.js gita1           # report only, changes nothing
//   node scripts/empty-part.js gita1 --apply   # delete
//
// THERE IS NO UNDO. Take a mysqldump first. The bundled track lists can be
// re-imported afterwards from the Part screen ("Import Gitanjali Part 1").
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const code = process.argv[2]
const APPLY = process.argv.includes('--apply')

async function main() {
  if (!code) throw new Error('Usage: node scripts/empty-part.js <part-code> [--apply]')

  const product = await prisma.product.findUnique({ where: { code } })
  if (!product) throw new Error(`Part "${code}" not found.`)

  const items = await prisma.content.findMany({
    where: { productId: product.id },
    select: { id: true, title: true },
    orderBy: { sortOrder: 'asc' },
  })
  const nodes = await prisma.contentNode.findMany({
    where: { productId: product.id },
    select: { id: true, name: true, parentId: true },
  })

  console.log(`${product.name}  (${APPLY ? 'APPLY' : 'dry run'})\n`)
  console.log(`  ${items.length} content item(s):`)
  for (const i of items) console.log(`    ${APPLY ? 'DELETED' : 'would delete'}  ${i.title}`)
  console.log(`\n  ${nodes.length} section(s):`)
  for (const n of nodes) console.log(`    ${APPLY ? 'DELETED' : 'would delete'}  ${n.name}`)

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply to delete.')
    return
  }

  // Items first: a section cannot be removed while it still holds one.
  const removedItems = await prisma.content.deleteMany({ where: { productId: product.id } })
  // Then the sections. Deleting a parent cascades to its children, so the
  // top level is enough — but deleting them all by Part is simpler and covers
  // any section whose parent was already gone.
  const removedNodes = await prisma.contentNode.deleteMany({ where: { productId: product.id } })

  const leftItems = await prisma.content.count({ where: { productId: product.id } })
  const leftNodes = await prisma.contentNode.count({ where: { productId: product.id } })

  console.log(
    `\nRemoved ${removedItems.count} item(s) and ${removedNodes.count} section(s).` +
      ` ${leftItems} item(s) and ${leftNodes} section(s) remain.`
  )
  console.log(`The Part "${product.name}" itself is untouched.`)
  console.log('To give it the two default sections again:  node scripts/ensure-default-sections.js --apply')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
