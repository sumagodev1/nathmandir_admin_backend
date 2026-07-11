// ── Auth API ──────────────────────────────────────────────────
// POST /api/auth/login            — email + password → JWT token
// GET  /api/auth/me               — current admin (from token)
// POST /api/auth/logout           — stateless; client just discards the token
// POST /api/auth/change-password  — { currentPassword, newPassword }
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as auth from '../controllers/auth.controller.js'

const router = Router()

router.post('/login', auth.login)
router.get('/me', requireAuth, auth.me)
router.post('/logout', requireAuth, auth.logout)
router.post('/change-password', requireAuth, auth.changePassword)

export default router
