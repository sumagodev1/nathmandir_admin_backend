// ── Users API ─────────────────────────────────────────────────
// GET   /api/users              — list (search + filter)
// GET   /api/users/:id          — profile + subscriptions/payments
// POST  /api/users              — create a user (optional access grants)
// PATCH /api/users/:id/status   — enable / disable
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as users from '../controllers/users.controller.js'

const router = Router()
router.use(requireAuth) // everything here requires login

router.get('/', users.list)
router.get('/:id', users.get)
router.post('/', users.create)
router.patch('/:id/status', users.updateStatus)

export default router
