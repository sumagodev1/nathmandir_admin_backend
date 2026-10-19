// ── Gitanjali Part 1 → संध्याकाळ: put it in the printed order ──
// Two jobs, nothing else:
//   1. sort_order — the songs and sub parts in ORDER are put in that order.
//   2. published  — the songs in HIDE are switched off, exactly what the
//      admin panel's status pill does. They stay in संध्याकाळ, so switching
//      one back on in the panel brings it back.
// Nothing is added, renamed, deleted or moved to another section.
//
// संध्याकाळ holds two kinds of thing: songs sitting directly in it, and sub
// parts (वाराची पदे, भैरवी, स्तोत्र) that open their own screen. The admin
// tree mixes the two by sortOrder, with a sub part going first on a tie (see
// contentTree.js in the frontend), so one number line gives one mixed order:
//
//   - The songs keep the numbers they already use, just handed out in the
//     new order, hidden songs last. The rest of the Part (सकाळ before, the
//     days after) never sees a number change, so a flat list of the whole
//     Part still reads morning → evening → days.
//   - A sub part takes the number of the song that comes right after it.
//
// Two sub parts in a row (वाराची पदे, भैरवी) share a number, and then their
// id decides — the same (sortOrder, id) rule the API uses. The plan is
// checked against that rule before anything is written, so a database where
// the ids fall the other way stops here instead of half-working.
//
// Anything in संध्याकाळ that is in neither list, or named but not found,
// stops the script: it never guesses. A song that is already switched off is
// not in the app, so it may be left out of both lists.
//
//   node scripts/reorder-evening.js            # report only
//   node scripts/reorder-evening.js --apply    # write
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const APPLY = process.argv.includes('--apply')
const PRODUCT_CODE = 'gita1'
const EVENING = 'संध्याकाळ (Evening)'

// The printed list, top to bottom. `section` is a sub part, `song` an item
// directly in संध्याकाळ. A song may list more than one spelling when the
// title was edited after import (भारतवाक्य → भरतवाक्य).
const ORDER = [
  { song: ['जयजयकार'] },                       //  1
  { section: 'वाराची पदे' },                   //  2
  { section: 'भैरवी' },                        //  3
  { song: ['प्रदक्षिणा'] },                     //  4
  { song: ['अशाश्वत संग्रह'] },                 //  5
  { song: ['बोलावे बहू गोड'] },                 //  6
  { section: 'स्तोत्र' },                       //  7
  { song: ['भरतवाक्य', 'भारतवाक्य'] },          //  8
  { song: ['सोडीना गुरू राया'] },               //  9  भजन
  { song: ['ललिते जननीमसी'] },
  { song: ['विडा'] },                           // 10
  { song: ['पालना', 'पाळणा'] },                 // 11
  { song: ['शेजारती'] },                        // 12
  { song: ['हृदयकमली श्लोक'] },                 // 13
]

// Songs taken out of the app. They go to the bottom of संध्याकाळ in the admin
// panel, in this order. Only songs directly in संध्याकाळ are touched; a name
// found nowhere there is skipped.
const HIDE = [
  ['भैरवी - मज ए नाथ दयेचे देणे'],
  ['अनंतकोटी'],
  ['श्री योगेंद्र सदये'],
  ['षट्चक्र - श्री योगभ्यानंदन'],
  ['अष्टांगयोग - योगाचळ शिखरी'],
]

const label = (e) => (e.section ? `[${e.section}]` : e.song[0])

async function main() {
  const product = await prisma.product.findUnique({ where: { code: PRODUCT_CODE } })
  if (!product) throw new Error(`Part "${PRODUCT_CODE}" not found.`)

  const evening = await prisma.contentNode.findFirst({
    where: { productId: product.id, parentId: null, name: EVENING },
  })
  if (!evening) throw new Error(`Section "${EVENING}" not found in ${product.name}.`)

  const [nodes, songs] = await Promise.all([
    prisma.contentNode.findMany({ where: { parentId: evening.id } }),
    // Binned rows are left alone: they keep their number, so a restore puts
    // them back where they were.
    prisma.content.findMany({ where: { nodeId: evening.id, deletedAt: null } }),
  ])

  // ── Match every entry to exactly one row ──
  const problems = []
  const used = new Set()
  const find = (e, optional = false) => {
    const hits = e.section
      ? nodes.filter((n) => n.name.trim() === e.section)
      : songs.filter((c) => e.song.includes(c.title.trim()))
    if (!hits.length && optional) return null
    if (hits.length !== 1) {
      problems.push(`${label(e)}: ${hits.length ? `${hits.length} matches` : 'not found'} in ${EVENING}`)
      return null
    }
    if (used.has(hits[0])) problems.push(`${label(e)} is named twice`)
    used.add(hits[0])
    return hits[0]
  }
  const rows = ORDER.map((e) => find(e))
  // A song to hide that is not directly in संध्याकाळ is skipped — on a server
  // where it sits inside a sub part (भैरवी), it must stay showing there.
  const found = HIDE.map((song) => find({ song }, true))
  const hidden = found.filter(Boolean)
  const skipped = HIDE.filter((_, i) => !found[i])
  for (const n of nodes) if (!used.has(n)) problems.push(`[${n.name}] is in ${EVENING} but not in the list`)
  for (const c of songs) {
    if (!used.has(c) && c.published) problems.push(`${c.title} is in ${EVENING} but in neither list`)
  }

  if (problems.length) {
    console.log(`${product.name} → ${EVENING}: the list does not match the data, nothing written.\n`)
    for (const p of problems) console.log(`  ✗ ${p}`)
    process.exitCode = 1
    return
  }

  // ── Hand out the numbers: the ordered songs first, the hidden ones last ──
  const listed = rows.filter((_, i) => ORDER[i].song)
  const line = [...listed, ...hidden]
  const numbers = line.map((c) => c.sortOrder).sort((a, b) => a - b)
  const next = new Map(line.map((c, i) => [c, numbers[i]])) // row → new sortOrder
  for (let i = ORDER.length - 1, after = numbers[listed.length - 1] + 1; i >= 0; i--) {
    if (ORDER[i].song) after = next.get(rows[i])
    else next.set(rows[i], after)
  }

  // ── Check: read it back the way the admin tree and the API will ──
  const bySort = (a, b) => next.get(a) - next.get(b) || a.id - b.id
  const sortedNodes = nodes.slice().sort(bySort)
  const sortedSongs = line.slice().sort(bySort)
  const seen = []
  for (let s = 0, c = 0; s < sortedNodes.length || c < sortedSongs.length; ) {
    const takeNode = c >= sortedSongs.length || (s < sortedNodes.length && next.get(sortedNodes[s]) <= next.get(sortedSongs[c]))
    seen.push(takeNode ? sortedNodes[s++] : sortedSongs[c++])
  }
  const wanted = [...rows, ...hidden]
  if (seen.some((row, i) => row !== wanted[i])) {
    console.log('The new numbers would not read back in the printed order (sub part ids fall the other way). Nothing written.')
    process.exitCode = 1
    return
  }

  // ── Report, then write ──
  console.log(`${product.name} → ${EVENING}  (${APPLY ? 'APPLY' : 'dry run'})\n`)
  const show = (row, name, i) => {
    const to = next.get(row)
    const moved = row.sortOrder !== to
    console.log(`  ${String(i + 1).padStart(2)}  ${moved ? '~' : ' '} ${String(row.sortOrder).padStart(3)} → ${String(to).padEnd(3)}  ${name}`)
    return moved
  }
  let changes = 0
  ORDER.forEach((e, i) => { if (show(rows[i], label(e), i)) changes++ })
  console.log('\n  Hidden from the app:')
  hidden.forEach((c, i) => {
    if (show(c, `${c.title}${c.published ? '' : '  (already hidden)'}`, ORDER.length + i)) changes++
    if (c.published) changes++
  })
  for (const s of skipped) console.log(`           ${s[0]}  (not directly in ${EVENING}, skipped)`)

  if (!changes) return console.log('\nAlready done.')
  if (!APPLY) return console.log(`\nWould make ${changes} change(s). Re-run with --apply to write.`)

  await prisma.$transaction([
    ...ORDER.flatMap((e, i) => {
      const row = rows[i]
      const sortOrder = next.get(row)
      if (row.sortOrder === sortOrder) return []
      return [
        e.section
          ? prisma.contentNode.update({ where: { id: row.id }, data: { sortOrder } })
          : prisma.content.update({ where: { id: row.id }, data: { sortOrder } }),
      ]
    }),
    ...hidden
      .filter((c) => c.published || c.sortOrder !== next.get(c))
      .map((c) => prisma.content.update({ where: { id: c.id }, data: { sortOrder: next.get(c), published: false } })),
  ])
  console.log(`\nMade ${changes} change(s).`)
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
