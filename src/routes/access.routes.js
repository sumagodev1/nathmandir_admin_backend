// ── Access Control API ────────────────────────────────────────
// GET  /api/access               — access matrix (users × products)
// POST /api/access/grant         — grant a module { userId, productId, duration }
// POST /api/access/revoke        — revoke a module { userId, productId }
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as access from '../controllers/access.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', access.list)
router.post('/grant', access.grant)
router.post('/revoke', access.revoke)

export default router
