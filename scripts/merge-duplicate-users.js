// ── Merge users that share one mobile number ──────────────────
// Before the duplicate check existed, the admin panel (and older paths) could
// create a second user for a number that was already registered. The app login
// then picks only one of them, so the other account's access is unreachable.
//
// For each number used by 2+ users this keeps ONE account and moves everything
// from the others onto it, then deletes the others.
//
// Run with:  node scripts/merge-duplicate-users.js              (dry run — lists only)
//            node scripts/merge-duplicate-users.js --apply      (does it)
//            node scripts/merge-duplicate-users.js --keep 536,241 [--apply]
//                (choose the account to keep for those numbers yourself)
//
// Which account is kept (unless --keep names it):
//   1. the one with the most access / purchases / paid flags
//   2. then an active one over a disabled one
//   3. then the most recent login
//   4. then the oldest id
//
// What moves to the kept account:
//   • user_access  — one row per Part; on a clash the better grant wins
//                    (purchased over granted, then the later / permanent expiry)
//   • sales, user_payment, userpayment — re-pointed
//   • user_donation — re-pointed only if the kept id exists in the legacy
//                     `user` table (its foreign key points there)
//   • empty email / city / address are filled from the other account; paid
//     flags are OR-ed; earliest registration and latest login are kept
// The kept account's name and status are left as they are.
//
// Each number is merged in its own transaction: all or nothing. BACK UP FIRST.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'
import { normalizeMobile } from '../src/lib/phone.js'

const APPLY = process.argv.includes('--apply')
const keepArg = process.argv.indexOf('--keep')
const FORCE_KEEP = new Set(
  keepArg !== -1 ? String(process.argv[keepArg + 1] || '').split(',').map(Number).filter(Boolean) : []
)

const FLAGS = ['part1', 'part2', 'upasanaPaid', 'nityaniyamPaid', 'isPaid', 'donation', 'donationAudio']

// A grant that lasts longer / was paid for beats one that doesn't.
function betterAccess(a, b) {
  if (a.source !== b.source) return a.source === 'purchased' ? a : b
  if (!a.expiresOn) return a
  if (!b.expiresOn) return b
  return a.expiresOn >= b.expiresOn ? a : b
}

async function legacyCounts(ids) {
  const out = new Map(ids.map((id) => [id, 0]))
  const rows = await prisma.$queryRawUnsafe(
    `SELECT user_id AS uid, COUNT(*) AS n FROM user_payment WHERE user_id IN (${ids.join(',')}) GROUP BY user_id`
  )
  for (const r of rows) out.set(Number(r.uid), Number(r.n))
  return out
}

function score(u) {
  return u.access.length * 10 + u.sales.length * 10 + FLAGS.slice(0, 4).reduce((s, f) => s + (u[f] ? 5 : 0), 0)
}

function pickKeeper(list) {
  const forced = list.find((u) => FORCE_KEEP.has(u.id))
  if (forced) return forced
  return [...list].sort(
    (a, b) =>
      score(b) - score(a) ||
      (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) ||
      (b.lastLogin?.getTime() || 0) - (a.lastLogin?.getTime() || 0) ||
      a.id - b.id
  )[0]
}

async function merge(keeper, others) {
  const legacyKeeperExists = (await prisma.$queryRawUnsafe('SELECT id FROM `user` WHERE id = ?', keeper.id)).length > 0

  await prisma.$transaction(async (tx) => {
    // ── access: one row per Part, the better one wins ──
    const mine = new Map(keeper.access.map((a) => [a.productId, a]))
    for (const o of others) {
      for (const a of o.access) {
        const have = mine.get(a.productId)
        if (!have) {
          await tx.userAccess.update({ where: { id: a.id }, data: { userId: keeper.id } })
          mine.set(a.productId, { ...a, userId: keeper.id })
        } else if (betterAccess(a, have) === a) {
          await tx.userAccess.update({
            where: { id: have.id },
            data: { source: a.source, duration: a.duration, grantedOn: a.grantedOn, expiresOn: a.expiresOn },
          })
          await tx.userAccess.delete({ where: { id: a.id } })
          mine.set(a.productId, { ...have, source: a.source, expiresOn: a.expiresOn })
        } else {
          await tx.userAccess.delete({ where: { id: a.id } })
        }
      }
    }

    const ids = others.map((o) => o.id)
    await tx.sale.updateMany({ where: { userId: { in: ids } }, data: { userId: keeper.id } })
    await tx.$executeRawUnsafe(`UPDATE user_payment SET user_id = ? WHERE user_id IN (${ids.join(',')})`, keeper.id)
    await tx.$executeRawUnsafe(`UPDATE userpayment SET userId = ? WHERE userId IN (${ids.join(',')})`, keeper.id)
    if (legacyKeeperExists) {
      await tx.$executeRawUnsafe(`UPDATE user_donation SET userID = ? WHERE userID IN (${ids.join(',')})`, keeper.id)
    }

    // ── profile: fill gaps, keep the strongest flags ──
    const data = {}
    for (const f of ['email', 'city', 'address']) {
      if (!String(keeper[f] ?? '').trim()) {
        const from = others.find((o) => String(o[f] ?? '').trim())
        if (from) data[f] = from[f]
      }
    }
    for (const f of FLAGS) {
      const max = Math.max(keeper[f] || 0, ...others.map((o) => o[f] || 0))
      if (max !== (keeper[f] || 0)) data[f] = max
    }
    const earliest = [keeper, ...others].map((u) => u.registeredOn).sort((a, b) => a - b)[0]
    if (earliest < keeper.registeredOn) data.registeredOn = earliest
    const latest = [keeper, ...others].map((u) => u.lastLogin).filter(Boolean).sort((a, b) => b - a)[0]
    if (latest && (!keeper.lastLogin || latest > keeper.lastLogin)) data.lastLogin = latest
    if (Object.keys(data).length) await tx.user.update({ where: { id: keeper.id }, data })

    await tx.user.deleteMany({ where: { id: { in: ids } } })
  })
  return legacyKeeperExists
}

async function main() {
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    include: { access: { include: { product: { select: { name: true } } } }, sales: true },
  })
  const groups = new Map()
  for (const u of users) {
    const n = normalizeMobile(u.phone)
    if (!n) continue
    if (!groups.has(n)) groups.set(n, [])
    groups.get(n).push(u)
  }
  const dupes = [...groups.entries()].filter(([, l]) => l.length > 1)
  if (!dupes.length) return console.log('No duplicate numbers. Nothing to do.')

  const payments = await legacyCounts(dupes.flatMap(([, l]) => l.map((u) => u.id)))
  const describe = (u) =>
    `#${u.id} ${u.name} [${u.status}] access: ${u.access.map((a) => a.product?.name).join(', ') || 'none'}` +
    `${u.sales.length ? `, ${u.sales.length} sale(s)` : ''}${payments.get(u.id) ? `, ${payments.get(u.id)} payment record(s)` : ''}`

  console.log(`${APPLY ? 'Merging' : 'Dry run —'} ${dupes.length} number(s) used by more than one user.\n`)
  for (const [n, list] of dupes) {
    const keeper = pickKeeper(list)
    const others = list.filter((u) => u !== keeper)
    console.log(n)
    console.log(`   KEEP    ${describe(keeper)}`)
    for (const o of others) console.log(`   MERGE   ${describe(o)}`)
    if (APPLY) {
      const donationsMoved = await merge(keeper, others)
      console.log(`   ✓ merged into #${keeper.id}${donationsMoved ? '' : ' (legacy donations left on the old id — no legacy user row for the kept id)'}`)
    }
  }
  if (!APPLY) {
    console.log('\nNothing changed. Check the KEEP lines, then run again with --apply.')
    console.log('To keep a different account for a number, add e.g. --keep 536')
  }
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
