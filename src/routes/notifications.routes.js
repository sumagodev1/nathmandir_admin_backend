// ── Notifications API ─────────────────────────────────────────
// GET  /api/notifications?query=&from=&to=  — announcement history
// POST /api/notifications                   — send { title, message, audience }
// GET  /api/notifications/alerts            — topbar bell feed + unread count
// POST /api/notifications/alerts/seen       — mark the feed as read
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as notifications from '../controllers/notifications.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/alerts', notifications.alerts)
router.post('/alerts/seen', notifications.markAlertsSeen)

router.get('/', notifications.list)
router.post('/', notifications.create)

export default router
