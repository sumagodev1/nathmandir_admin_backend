// ── Contacts API (raw production table contact) ───────────────
// GET /api/contacts?query=&page=1&pageSize=50   (766 rows → paginated)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as contacts from '../controllers/contacts.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', contacts.list)

export default router
