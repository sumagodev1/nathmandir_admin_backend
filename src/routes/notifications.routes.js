// ── Notifications API ─────────────────────────────────────────
// GET  /api/notifications?query=&from=&to=  — history
// POST /api/notifications                   — send { title, message, audience }
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as notifications from '../controllers/notifications.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', notifications.list)
router.post('/', notifications.create)

export default router
