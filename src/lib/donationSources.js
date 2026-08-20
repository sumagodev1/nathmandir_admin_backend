// ─────────────────────────────────────────────────────────────
// Where donation money lives.
//
// Two live tables, and forgetting either is what made the screens disagree:
//
//   user_payment, package_id = 3   in-app donations
//   donation                       website form, plus cash and bank entries
//                                  an admin types in
//
// A third table, `userpayment`, holds pre-2022 Instamojo donations. It is
// deliberately NOT read: it stopped being written in Dec 2021, 60 of its 131
// rows have a blank amount, and 21 point at users that no longer exist.
//
// Both are raw tables outside the Prisma schema, so a missing one is reported
// as empty rather than taking a whole screen down with a 500.
// ─────────────────────────────────────────────────────────────
import { prisma } from './prisma.js'
import { ymd } from './helpers.js'

// How the money arrived, for a row that never went through a gateway.
export const DONATION_MODE_LABEL = { online: 'Website', cash: 'Cash', bank: 'Bank Transfer' }

async function read(where, sql, ...args) {
  try {
    return await prisma.$queryRawUnsafe(sql, ...args)
  } catch (err) {
    const detail = String(err.message).replace(/\s+/g, ' ').trim().slice(0, 160)
    console.error(`⚠️  ${where}: skipping a donation source — ${detail}`)
    return []
  }
}

/**
 * Every settled donation, from both sources, newest first.
 *
 * One shape whatever the origin:
 *   { id, source, name, mobile, amount, txn, ref, gateway, date, category }
 *
 * `id` is prefixed per source ("A3", "W7") so it stays unique when the two
 * lists are concatenated — the underlying tables both count from 1.
 */
export async function donationRows(where = 'donations') {
  const [inApp, web] = await Promise.all([
    read(
      where,
      `SELECT p.id, u.name AS name, u.phone AS mobile, p.amount,
              p.razorpay_payment_id AS txn, p.razorpay_order_id AS ref, p.created_at AS createdAt
         FROM user_payment p LEFT JOIN users u ON u.id = p.user_id
        WHERE p.package_id = 3 AND p.status = 1
        ORDER BY p.created_at DESC`
    ),
    read(
      where,
      `SELECT id, name, mobile, amount, category, mode,
              razorpay_payment_id AS txn, razorpay_order_id AS ref, txn_ref AS txnRef,
              created_at AS createdAt
         FROM donation WHERE status = '1' ORDER BY created_at DESC`
    ),
  ])

  const rows = [
    ...inApp.map((r) => ({
      id: `A${r.id}`,
      source: 'app',
      name: r.name || '',
      mobile: r.mobile || '',
      amount: Number(r.amount) || 0,
      txn: r.txn || '',
      ref: r.ref || '',
      gateway: 'App',
      category: '',
      date: ymd(r.createdAt),
      createdAt: r.createdAt,
    })),
    ...web.map((r) => ({
      id: `W${r.id}`,
      source: 'website',
      name: r.name || '',
      mobile: r.mobile || '',
      amount: Number(r.amount) || 0,
      txn: r.txn || r.txnRef || '',
      ref: r.ref || '',
      gateway: DONATION_MODE_LABEL[r.mode] || 'Website',
      category: r.category || '',
      date: ymd(r.createdAt),
      createdAt: r.createdAt,
    })),
  ]

  // Sorted across both sources, or the website rows would all sit below the
  // app rows however recent they are.
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  return rows
}

/** { count, amount } across both sources. */
export async function donationTotals(where = 'donations') {
  const rows = await donationRows(where)
  return { count: rows.length, amount: rows.reduce((n, r) => n + r.amount, 0) }
}
