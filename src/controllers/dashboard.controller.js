// ── Dashboard controller ──────────────────────────────────────
// Handler for /api/dashboard/stats — every KPI the dashboard shows.
import { prisma } from '../lib/prisma.js'
import { productMaps } from '../lib/products.js'
import { isActiveGrant, activeGrantWhere } from '../lib/helpers.js'

// Donation money, from `user_payment` package 3 (status 1 = settled) — the
// same single source the Payments screen reads.
//
// The old `userpayment` table is deliberately NOT counted: it stopped being
// written in Dec 2021, 60 of its 131 rows have a blank amount, and 21 point at
// deleted users. Including it was what made this screen and Payments disagree
// with Donations. It stays in the database as history.
//
// It is a legacy raw table outside the Prisma schema, so a missing one is
// reported as zero rather than taking the whole dashboard down with a 500.
async function donationTotals() {
  try {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) c, SUM(amount + 0) a FROM user_payment WHERE package_id = 3 AND status = 1`
    )
    return { count: Number(row?.c || 0), amount: Number(row?.a || 0) }
  } catch (err) {
    console.error(`⚠️  /api/dashboard/stats: skipping donations — ${err.message.split('\n').pop().trim()}`)
    return { count: 0, amount: 0 }
  }
}

// GET /api/dashboard/stats
export async function stats(req, res) {
  const users = await prisma.user.findMany({ include: { access: true } })
  // access rows hold numeric product ids; the part breakdown below is defined
  // in terms of the public codes, so translate once up front.
  const { codeById } = await productMaps()

  // Every count below is about access a user can still use, so expired grants
  // drop out here once and the rest of the handler works from that. One clock
  // reading for the whole request keeps the KPIs consistent with each other.
  const now = new Date()
  const grantsOf = (u) => u.access.filter((a) => isActiveGrant(a, now))

  const totalUsers = users.length
  const subscribedUsers = users.filter((u) => grantsOf(u).length > 0).length
  const unsubscribedUsers = totalUsers - subscribedUsers
  const activeUsers = users.filter((u) => u.status === 'active').length

  // Inactive = no login in the last 7 days.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const inactive7 = users.filter((u) => !u.lastLogin || u.lastLogin < cutoff).length

  // Gitanjali part breakdown.
  let onlyPart1 = 0, onlyPart2 = 0, both = 0
  for (const u of users) {
    const codes = grantsOf(u).map((a) => codeById.get(a.productId))
    const p1 = codes.includes('gita1')
    const p2 = codes.includes('gita2')
    if (p1 && p2) both++
    else if (p1) onlyPart1++
    else if (p2) onlyPart2++
  }

  const [revenue, donations, plays, products, accessByProduct, salesByProduct] = await Promise.all([
    // Same status filter as the per-module figures below, so the book total
    // always equals the sum of the modules under it.
    prisma.sale.aggregate({ where: { status: 'success' }, _sum: { amount: true } }),
    // Donation money, from the same two places the Payments screen reads it:
    // package 3 of user_payment (in-app), and the legacy Instamojo table.
    // Counting it here is what makes the dashboard headline agree with the
    // Payments headline — they used to disagree by the whole donation total
    // with nothing on either screen explaining the gap.
    donationTotals(),
    prisma.content.aggregate({ _sum: { plays: true } }),
    prisma.product.findMany({ select: { id: true, code: true, name: true, shortName: true, price: true } }),
    // "Subscribers" per module, expired grants excluded — same rule as the
    // Subscribed Users KPI above, so the two never tell different stories.
    prisma.userAccess.groupBy({
      by: ['productId'],
      where: activeGrantWhere(now),
      _count: { productId: true },
    }),
    prisma.sale.groupBy({
      by: ['productId'],
      where: { status: 'success' },
      _count: { productId: true },
      _sum: { amount: true },
    }),
  ])

  const bookRevenue = revenue._sum.amount || 0

  // ── Most Popular Modules — subscribers + revenue per product ──
  const subMap = Object.fromEntries(accessByProduct.map((a) => [a.productId, a._count.productId]))
  const saleMap = Object.fromEntries(
    salesByProduct.map((s) => [s.productId, { count: s._count.productId, amount: s._sum.amount || 0 }])
  )
  const popularModules = products
    .map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      shortName: p.shortName,
      price: p.price,
      subscribers: subMap[p.id] || 0,
      purchases: saleMap[p.id]?.count || 0,
      revenue: saleMap[p.id]?.amount || 0,
    }))
    .sort((a, b) => b.subscribers - a.subscribers || b.revenue - a.revenue)

  res.json({
    totalUsers,
    subscribedUsers,
    unsubscribedUsers,
    activeUsers,
    inactive7,
    partSubscription: { onlyPart1, onlyPart2, both },
    // Headline = books + donations, the same figure the Payments screen shows.
    // `revenueBreakdown` is what lets the UI say WHY it is that number.
    totalRevenue: bookRevenue + donations.amount,
    revenueBreakdown: {
      books: { count: salesByProduct.reduce((n, s) => n + s._count.productId, 0), amount: bookRevenue },
      donations,
      total: { count: 0, amount: bookRevenue + donations.amount },
    },
    totalPlays: plays._sum.plays || 0,
    popularModules,
  })
}
