// ── Clear the "disabled" flags that logging out left behind ───
// MUST be run together with the change that makes `users.status` actually
// block a login. Before that change the column meant two things at once:
//
//   admin panel → this account is banned
//   mobile app  → this person is logged out   (active_session wrote 'disabled')
//
// Nothing ever enforced it, so nobody noticed. Now that a disabled account is
// turned away at the door, every one of those logout-flags becomes a real ban
// on someone who did nothing wrong — including devotees who paid for books.
//
// The 81 rows carry no token and no device row, which is exactly what a logged
// out account looks like; there is no audit trail separating them from a
// deliberate ban, and locking out a paying customer is far worse than leaving
// one unwanted account enabled. So all of them are reset, and an admin can
// disable anyone again on purpose — which will now actually work.
//
// Run this BEFORE deploying, or those people cannot log in.
//
//   node scripts/reset-logout-disabled-users.js --dry
//   node scripts/reset-logout-disabled-users.js
// ─────────────────────────────────────────────────────────────
import 'dotenv/config'
import { prisma } from '../src/lib/prisma.js'

const DRY = process.argv.includes('--dry')
const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN')

async function main() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT u.id, u.name, u.phone,
            (u.token IS NOT NULL AND u.token <> '')                      AS hasToken,
            EXISTS(SELECT 1 FROM login_user l WHERE l.mobile = u.phone)  AS hasDevice,
            (SELECT COUNT(*) FROM user_access a WHERE a.user_id = u.id)  AS books,
            (SELECT COALESCE(SUM(s.amount), 0) FROM sales s WHERE s.user_id = u.id) AS paid
       FROM users u
      WHERE u.status = 'disabled'
      ORDER BY paid DESC, u.id`
  )

  if (!rows.length) {
    console.log('✓ No disabled accounts — nothing to reset.')
    return
  }

  const payers = rows.filter((r) => Number(r.books) > 0 || Number(r.paid) > 0)
  console.log(`${rows.length} account(s) currently disabled.\n`)

  if (payers.length) {
    console.log('These paid for books and would be locked out of them:')
    for (const p of payers) {
      console.log(`  #${String(p.id).padEnd(4)} ${String(p.name).padEnd(22)} ${p.phone}   ${String(p.books)} book(s)  ${rupees(p.paid)}`)
    }
    console.log('')
  }

  // A row with a live token or device was NOT left this way by a logout, so
  // say so rather than sweeping it in silently.
  const odd = rows.filter((r) => Number(r.hasToken) || Number(r.hasDevice))
  if (odd.length) {
    console.log(`Note: ${odd.length} of these still hold a token or device — they may have been disabled deliberately.\n`)
  }

  if (DRY) {
    console.log('Dry run — nothing was written. Drop --dry to apply.')
    return
  }

  const { count } = await prisma.user.updateMany({
    where: { status: 'disabled' },
    data: { status: 'active' },
  })
  console.log(`✓ re-enabled ${count} account(s). Nothing else on the rows was touched.`)
  console.log('  From now on "disabled" means only what an admin sets in the panel.')
}

main()
  .catch((e) => {
    console.error('✗', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
