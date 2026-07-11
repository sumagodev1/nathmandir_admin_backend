// ── Payments API (raw production tables) ──────────────────────
// GET /api/payments?gateway=all|razorpay|instamojo&status=&query=
// Merges Razorpay (user_payment) + legacy Instamojo (userpayment).
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as payments from '../controllers/payments.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', payments.list)

export default router
