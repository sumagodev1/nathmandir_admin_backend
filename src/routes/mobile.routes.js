// ── Mobile App API (used by the mobile APK) ───────────────────
// Drop-in replacement for the legacy API.php. The app calls:
//   POST /api/mobile?apicall=<operation>   (params as form fields)
//
// AUTH: most operations require the mobile JWT as a Bearer token
//   (Authorization: Bearer <token>). The token is issued by verifyOTP
//   and stored on the user row. These are PUBLIC (no token needed):
//     loginuser, verifyOTP, register, admin_login
//   Everything else returns 401 without a valid token.
//
// Operations (apicall):
//   loginuser            { mobile }                       [public]  → send OTP
//   verifyOTP            { otp, mobile, DID }             [public]  → login → JWT
//   register            { name, email, mobile, city?, address? }  [public]
//   admin_login         { email, password }              [public]
//   receipts            { id }                            [auth]    → paid receipts
//   active_session      { id, mobile }                   [auth]    → logout all devices
//   save_payment        { payment_request_id, payment_status, userID, amount, … } [auth]
//   check_status        { mobile }                        [auth]   → user row
//   fetch_user                                            [auth]   → all users
//   audio_donation_user                                   [auth]   → all users
//   update_session      { mobile, active }               [auth]
//   check_active_session{ mobile, DID }                  [auth]
//
// NOTE: this uses its own mobile JWT — separate from the admin panel auth.
import { Router } from 'express'
import { dispatch } from '../controllers/mobile.controller.js'

const router = Router()

// Both GET and POST are accepted (the app posts form fields with ?apicall=).
router.all('/', dispatch)

export default router
