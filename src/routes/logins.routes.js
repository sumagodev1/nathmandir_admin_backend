// ── App Logins API (raw production table login_user) ──────────
// GET /api/logins?query=   — mobile + device_id from the mobile app
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as logins from '../controllers/logins.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', logins.list)

export default router
