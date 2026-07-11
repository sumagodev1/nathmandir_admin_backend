// ── Settings API (key/value store) ────────────────────────────
// GET /api/settings        — all settings as { key: value }
// PUT /api/settings        — upsert many { key: value } pairs
// Pricing lives on /api/products; this covers docs (about/terms/privacy)
// and admin preferences.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as settings from '../controllers/settings.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', settings.get)
router.put('/', settings.update)

export default router
