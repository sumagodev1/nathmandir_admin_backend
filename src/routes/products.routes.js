// ── Products / Modules API ────────────────────────────────────
// GET   /api/products        — all modules (gita1, gita2, upasana, nithya…)
// POST  /api/products        — add a module/part { name, price, shortName? }
// PATCH /api/products/:id     — update name / price / active (Settings pricing)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as products from '../controllers/products.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', products.list)
router.post('/', products.create)
router.patch('/:id', products.update)
router.delete('/:id', products.remove)

export default router
