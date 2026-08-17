// ── Give every Part the default sections ──────────────────────
// New Parts get them automatically (see products.controller.js). This brings
// the Parts that already existed into line.
//
// For each Part, for each default section in src/lib/defaultSections.js:
//   • already named exactly right → left alone
//   • named a known alias         → RENAMED, keeping its children and content
//   • nothing matching            → created
//
// Nothing is deleted and no content item is touched. Safe to re-run.
//
//   node scripts/ensure-default-sections.js           # report only
//   node scripts/ensure-default-sections.js --apply   # write
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import {
  DEFAULT_SECTIONS, ALIASES, ensureDefaultSections,
  WEEKDAYS, DAY_ALIASES, DAY_KIND,
} from '../src/lib/defaultSections.js'

const APPLY = process.argv.includes('--apply')

async function preview(productId) {
  const existing = await prisma.contentNode.findMany({
    where: { productId, parentId: null },
    select: { name: true },
  })
  const lines = []
  for (const spec of DEFAULT_SECTIONS) {
    if (existing.some((n) => n.name === spec.name)) {
      lines.push(`    ok       ${spec.name}`)
      continue
    }
    const aliases = ALIASES[spec.name] || []
    const match = existing.find((n) => aliases.includes(n.name.trim().toLowerCase()) || aliases.includes(n.name.trim()))
    lines.push(
      match
        ? `    WOULD RENAME  ${match.name}  →  ${spec.name}`
        : `    WOULD CREATE  ${spec.name}`
    )
  }
  return lines
}

async function main() {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  console.log(`Default sections (${APPLY ? 'APPLY' : 'dry run'})\n`)

  let created = 0
  let renamed = 0

  for (const p of products) {
    console.log(`  ${p.name}`)
    if (!APPLY) {
      for (const line of await preview(p.id)) console.log(line)
      continue
    }
    const r = await ensureDefaultSections(p.id)
    for (const name of r.created) console.log(`    CREATED  ${name}`)
    for (const m of r.renamed) console.log(`    RENAMED  ${m.from}  →  ${m.to}`)
    if (!r.created.length && !r.renamed.length) console.log('    ok       already has both')
    created += r.created.length
    renamed += r.renamed.length
  }

  // ── Days written before the bilingual names settled ────────
  // A day named "सोमवार" anywhere is brought in line with "सोमवार (Monday)",
  // so a day created by the form and one created earlier are the same section
  // rather than two near-identical ones. Only the name changes; children and
  // content stay exactly where they are.
  console.log('\n  Weekday names')
  let days = 0
  for (const canonical of WEEKDAYS) {
    const aliases = DAY_ALIASES[canonical] || []
    const matches = await prisma.contentNode.findMany({
      where: { name: { in: aliases } },
      select: { id: true, name: true },
    })
    for (const m of matches) {
      console.log(`    ${APPLY ? 'RENAMED' : 'WOULD RENAME'}  ${m.name}  →  ${canonical}`)
      if (APPLY) {
        await prisma.contentNode.update({
          where: { id: m.id },
          data: { name: canonical, kind: DAY_KIND },
        })
      }
      days++
    }
  }
  if (!days) console.log('    ok       nothing to rename')

  if (APPLY) {
    console.log(
      `\nCreated ${created}, renamed ${renamed + days}. No content item was created, edited or removed.`
    )
  } else {
    console.log('\nRe-run with --apply to write.')
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
