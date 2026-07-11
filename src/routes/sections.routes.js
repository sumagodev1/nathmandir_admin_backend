// ── Website Content API (admin) ───────────────────────────────
// GET /api/sections        — all website content sections
// GET /api/sections/:key   — one section (maharaj, temple, …)
// PUT /api/sections/:key    — save a section (auto-translates on save)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as sections from '../controllers/sections.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', sections.list)
router.get('/:key', sections.get)
router.put('/:key', sections.update)

export default router
