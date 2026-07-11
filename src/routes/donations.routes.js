// ── Donations API (raw production table user_donation) ────────
// GET /api/donations
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as donations from '../controllers/donations.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', donations.list)

export default router
