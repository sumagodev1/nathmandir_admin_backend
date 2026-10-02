// ── Policies API (admin) ──────────────────────────────────────
// GET /api/policies          — both policies
// GET /api/policies/:type    — one policy (type: privacy | terms), null if not written yet
// PUT /api/policies/:type    — { title, content } create or update; bumps the
//                              version when something changed
// Readers (website, app, browser) use /api/public/policies — see public.routes.js.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as policies from '../controllers/policies.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', policies.list)
router.get('/:type', policies.get)
router.put('/:type', policies.save)

export default router
