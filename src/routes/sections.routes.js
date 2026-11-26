// ── Website Content API (admin) ───────────────────────────────
// GET /api/sections        — all website content sections
// GET /api/sections/:key   — one section (maharaj, temple, …)
// PUT /api/sections/:key    — save a section (auto-translates on save)
import express, { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import * as sections from '../controllers/sections.controller.js'

const router = Router()
router.use(requireAuth)

// A save sends the whole section; "library" (the 35 Kiran) is ~1.2 MB, so
// this route gets a larger JSON cap than the app-wide 100 KB default. It is
// parsed only after requireAuth, so anonymous requests never get that far.
// Keep it at or below nginx's client_max_body_size (50M).
const parseSectionJson = express.json({ limit: '10mb' })

router.get('/', sections.list)
router.get('/:key', sections.get)
router.put('/:key', parseSectionJson, sections.update)

export default router
