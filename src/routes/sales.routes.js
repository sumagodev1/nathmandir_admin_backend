// ── Sales & Revenue API ───────────────────────────────────────
// GET /api/sales?query=&from=&to=  — transactions (all products)
// GET /api/sales/report            — per-product counts + revenue + totals
// GET /api/sales/:txnId            — one transaction (for a receipt)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as sales from '../controllers/sales.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', sales.list)
router.get('/report', sales.report) // must be before '/:txnId'
router.get('/:txnId', sales.get)

export default router
