// ── List mobile numbers that belong to more than one user ─────
// Read-only: prints the duplicates and changes nothing.
//
// Run with:  node scripts/find-duplicate-users.js
//
// Numbers are compared in their normalized 10-digit form, so "+91 98…" and
// "98…" count as the same. When a number has two users, the app login picks
// only one of them — often the older one — so the other account's access is
// unreachable. Fix each pair from the admin panel.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { normalizeMobile } from '../src/lib/phone.js'

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    include: { access: { include: { product: { select: { name: true } } } } },
  })
  const byNumber = new Map()
  for (const u of users) {
    const n = normalizeMobile(u.phone)
    if (!n) continue
    if (!byNumber.has(n)) byNumber.set(n, [])
    byNumber.get(n).push(u)
  }
  const dupes = [...byNumber.entries()].filter(([, list]) => list.length > 1)

  console.log(`${users.length} users, ${dupes.length} number(s) used by more than one user.\n`)
  for (const [n, list] of dupes) {
    console.log(n)
    for (const u of list) {
      const parts = u.access.map((a) => a.product?.name).filter(Boolean)
      console.log(`   #${u.id}  ${u.name}  [${u.status || 'active'}]  access: ${parts.length ? parts.join(', ') : 'none'}`)
    }
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
