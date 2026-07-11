// ── Dashboard API ─────────────────────────────────────────────
// GET /api/dashboard/stats — every KPI the dashboard shows, in one call.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as dashboard from '../controllers/dashboard.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/stats', dashboard.stats)

export default router
