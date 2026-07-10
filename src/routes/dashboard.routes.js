// ── Dashboard API ─────────────────────────────────────────────
// GET /api/dashboard/stats — every KPI the dashboard shows, in one call.
import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()
router.use(requireAuth)

router.get('/stats', async (req, res) => {
  const users = await prisma.user.findMany({ include: { access: true } })

  const totalUsers = users.length
  const subscribedUsers = users.filter((u) => u.access.length > 0).length
  const unsubscribedUsers = totalUsers - subscribedUsers
  const activeUsers = users.filter((u) => u.status === 'active').length

  // Inactive = no login in the last 7 days.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 7)
  const inactive7 = users.filter((u) => !u.lastLogin || u.lastLogin < cutoff).length

  // Gitanjali part breakdown.
  let onlyPart1 = 0, onlyPart2 = 0, both = 0
  for (const u of users) {
    const codes = u.access.map((a) => a.productId)
    const p1 = codes.includes('gita1')
    const p2 = codes.includes('gita2')
    if (p1 && p2) both++
    else if (p1) onlyPart1++
    else if (p2) onlyPart2++
  }

  const [revenue, plays, products, accessByProduct, salesByProduct] = await Promise.all([
    prisma.sale.aggregate({ _sum: { amount: true } }),
    prisma.content.aggregate({ _sum: { plays: true } }),
    prisma.product.findMany({ select: { id: true, name: true, shortName: true, price: true } }),
    prisma.userAccess.groupBy({ by: ['productId'], _count: { productId: true } }),
    prisma.sale.groupBy({
      by: ['productId'],
      where: { status: 'success' },
      _count: { productId: true },
      _sum: { amount: true },
    }),
  ])

  // ── Most Popular Modules — subscribers + revenue per product ──
  const subMap = Object.fromEntries(accessByProduct.map((a) => [a.productId, a._count.productId]))
  const saleMap = Object.fromEntries(
    salesByProduct.map((s) => [s.productId, { count: s._count.productId, amount: s._sum.amount || 0 }])
  )
  const popularModules = products
    .map((p) => ({
      id: p.id,
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
    totalRevenue: revenue._sum.amount || 0,
    totalPlays: plays._sum.plays || 0,
    popularModules,
  })
})

export default router
