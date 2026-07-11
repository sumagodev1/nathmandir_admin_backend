// ── Spiritual Library API (Books + Chapters) ──────────────────
// GET    /api/books?category=   — list books (with chapter counts)
// GET    /api/books/:id         — one book with its chapters
// POST   /api/books             — create { title, author, category, ...chapters[] }
// PATCH  /api/books/:id         — update; if `chapters` sent, replaces them all
// DELETE /api/books/:id         — delete book (chapters cascade)
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as library from '../controllers/library.controller.js'

const router = Router()
router.use(requireAuth)

router.get('/', library.list)
router.get('/:id', library.get)
router.post('/', library.create)
router.patch('/:id', library.update)
router.delete('/:id', library.remove)

export default router
