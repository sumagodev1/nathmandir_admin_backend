// ── Website donation API ──────────────────────────────────────
// Public (no auth) — used by the website Donate page. Reuses the same
// Razorpay engine as the app-module checkout, but records a one-off gift
// in the `donation` table (no module unlock).
//
//   POST /api/donate/create-order   { name, mobile, email?, amount, category? }
//   POST /api/donate/verify-payment { razorpay_order_id, razorpay_payment_id, razorpay_signature }
import { Router } from 'express'
import * as donate from '../controllers/donate.controller.js'

const router = Router()

router.post('/create-order', donate.createOrder)
router.post('/verify-payment', donate.verifyPayment)

export default router
