// ── Sales & Revenue controller ────────────────────────────────
// Handlers for /api/sales.
import { prisma } from '../lib/prisma.js'
import { ymd, paginate } from '../lib/helpers.js'

const shape = (s) => ({
  id: s.txnId,
  userId: s.userId,
  user: s.user?.name || '',
  product: s.productId,
  productCode: s.product?.code || null,
  productName: s.product?.name || String(s.productId),
  amount: s.amount,
  status: s.status,
  date: ymd(s.createdAt),
  ref: s.ref,
})

// GET /api/sales?query=&from=&to=&page=&limit=  — transactions (all products)
export async function list(req, res) {
  const { query = '', from = '', to = '' } = req.query
  const sales = await prisma.sale.findMany({
    include: { user: true, product: true },
    orderBy: { createdAt: 'desc' },
  })

  const q = String(query).trim().toLowerCase()
  const rows = sales.map(shape).filter((s) => {
    const matchQ =
      !q ||
      s.user.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      s.productName.toLowerCase().includes(q)
    const matchFrom = !from || s.date >= from
    const matchTo = !to || s.date <= to
    return matchQ && matchFrom && matchTo
  })

  const pg = paginate(rows, req.query)
  res.json({ sales: pg.data, total: pg.total, page: pg.page, pages: pg.pages, limit: pg.limit })
}

// GET /api/sales/report  — per-product counts + revenue + totals
export async function report(req, res) {
  const products = await prisma.product.findMany({ orderBy: { id: 'asc' } })
  const report = await Promise.all(
    products.map(async (p) => {
      const agg = await prisma.sale.aggregate({
        where: { productId: p.id },
        _sum: { amount: true },
        _count: true,
      })
      return { id: p.id, name: p.name, count: agg._count, amount: agg._sum.amount || 0 }
    })
  )
  const totalAmount = report.reduce((s, r) => s + r.amount, 0)
  const totalCount = report.reduce((s, r) => s + r.count, 0)
  res.json({ report, totalAmount, totalCount })
}

// GET /api/sales/:txnId  — one transaction (for a receipt)
export async function get(req, res) {
  const sale = await prisma.sale.findUnique({
    where: { txnId: req.params.txnId },
    include: { user: true, product: true },
  })
  if (!sale) return res.status(404).json({ error: 'Transaction not found.' })
  res.json({ sale: shape(sale) })
}
