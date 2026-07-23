// ── Website checkout API ──────────────────────────────────────
// "Spotify model" — pay on the website, unlock in the app. Consumed by
// the public website (no admin auth). The mobile number is collected on
// the form before payment, so access is granted straight after a
// verified payment (no separate OTP step). The account is auto-created.
//
//   GET  /api/checkout/modules                         → [{code,name,price}]
//   POST /api/checkout/create-order   { mobile, name, email, module }
//   POST /api/checkout/verify-payment { razorpay_order_id, razorpay_payment_id,
//                                       razorpay_signature, mobile, name, email, module }
//   POST /api/checkout/webhook        (Razorpay server-to-server)
import { Router } from 'express'
import * as checkout from '../controllers/checkout.controller.js'

const router = Router()

router.get('/modules', checkout.modules)
router.post('/create-order', checkout.createOrder)
router.post('/verify-payment', checkout.verifyPayment)
router.post('/webhook', checkout.webhook)

export default router
