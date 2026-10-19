// ── Gitanjali Part 1 → संध्याकाळ: put each folder between the songs ──
// Changes ONLY the sort_order of the sub parts (folders) in संध्याकाळ. No song
// is touched — the songs must already be in the right order, which the admin
// panel's ↑ ↓ buttons take care of.
//
// A folder goes just before a song by taking that song's number: on a tie the
// folder goes first, the rule both the admin tree (contentTree.js) and the app
// (get_sections → sortOrder) follow. Two folders before the same song share
// the number and their id decides, so the result is read back and checked
// before anything is written.
//
// Written for the server, where the song titles differ from this machine
// (भजन, पाळणा, हृदयकमली शोभे) — only the folder names and the songs they sit
// in front of need to match. A folder in संध्याकाळ that is not named below, or
// a name that is not found, stops the script: it never guesses.
//
//   node scripts/place-evening-folders.js            # report only
//   node scripts/place-evening-folders.js --apply    # write
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const APPLY = process.argv.includes('--apply')
const PRODUCT_CODE = 'gita1'
const EVENING = 'संध्याकाळ (Evening)'

// Top to bottom. `before` may list more than one spelling of the song.
const PLACES = [
  { folder: 'वाराची पदे', before: ['प्रदक्षिणा'] },
  { folder: 'भैरवी', before: ['प्रदक्षिणा'] },
  { folder: 'स्तोत्र', before: ['भरतवाक्य', 'भारतवाक्य'] },
]

async function main() {
  const product = await prisma.product.findUnique({ where: { code: PRODUCT_CODE } })
  if (!product) throw new Error(`Part "${PRODUCT_CODE}" not found.`)

  const evening = await prisma.contentNode.findFirst({
    where: { productId: product.id, parentId: null, name: EVENING },
  })
  if (!evening) throw new Error(`Section "${EVENING}" not found in ${product.name}.`)

  const [nodes, songs] = await Promise.all([
    prisma.contentNode.findMany({ where: { parentId: evening.id } }),
    prisma.content.findMany({ where: { nodeId: evening.id, deletedAt: null } }),
  ])

  // ── Match every name to exactly one row ──
  const problems = []
  const one = (hits, what) => {
    if (hits.length === 1) return hits[0]
    problems.push(`${what}: ${hits.length ? `${hits.length} matches` : 'not found'} in ${EVENING}`)
    return null
  }
  const plan = PLACES.map((p) => ({
    folder: one(nodes.filter((n) => n.name.trim() === p.folder), `[${p.folder}]`),
    before: one(songs.filter((c) => p.before.includes(c.title.trim())), p.before[0]),
  }))
  for (const n of nodes) {
    if (!plan.some((p) => p.folder === n)) problems.push(`[${n.name}] is in ${EVENING} but not in the list`)
  }

  if (problems.length) {
    console.log(`${product.name} → ${EVENING}: the list does not match the data, nothing written.\n`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exitCode = 1
    return
  }

  const next = new Map(plan.map((p) => [p.folder, p.before.sortOrder]))

  // ── Check: read it back the way the admin tree and the app will ──
  const sortedSongs = songs.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
  const sortedNodes = nodes.slice().sort((a, b) => next.get(a) - next.get(b) || a.id - b.id)
  const seen = []
  for (let s = 0, c = 0; s < sortedNodes.length || c < sortedSongs.length; ) {
    const takeNode = c >= sortedSongs.length || (s < sortedNodes.length && next.get(sortedNodes[s]) <= sortedSongs[c].sortOrder)
    seen.push(takeNode ? sortedNodes[s++] : sortedSongs[c++])
  }
  const wanted = sortedSongs.flatMap((c) => [...plan.filter((p) => p.before === c).map((p) => p.folder), c])
  if (seen.some((row, i) => row !== wanted[i])) {
    console.log('The folders would not land in the planned places (two songs share a number, or the folder ids fall the other way). Nothing written.')
    process.exitCode = 1
    return
  }

  // ── Report, then write ──
  console.log(`${product.name} → ${EVENING}  (${APPLY ? 'APPLY' : 'dry run'})\n`)
  seen.forEach((row, i) => {
    const isFolder = next.has(row)
    const moved = isFolder && row.sortOrder !== next.get(row)
    const name = isFolder ? `[${row.name}]` : `${row.title}${row.published ? '' : '  (hidden)'}`
    const number = isFolder ? `${String(row.sortOrder).padStart(3)} → ${next.get(row)}` : String(row.sortOrder).padStart(3)
    console.log(`  ${String(i + 1).padStart(2)}  ${moved ? '~' : ' '} ${number.padEnd(9)}  ${name}`)
  })

  const changes = plan.filter((p) => p.folder.sortOrder !== next.get(p.folder))
  if (!changes.length) return console.log('\nAlready done.')
  if (!APPLY) return console.log(`\nWould move ${changes.length} folder(s). Re-run with --apply to write.`)

  await prisma.$transaction(
    changes.map((p) => prisma.contentNode.update({ where: { id: p.folder.id }, data: { sortOrder: next.get(p.folder) } }))
  )
  console.log(`\nMoved ${changes.length} folder(s).`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
