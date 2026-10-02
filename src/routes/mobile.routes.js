// ── Mobile App API (used by the mobile APK) ───────────────────
// Drop-in replacement for the legacy API.php. The app calls:
//   POST /api/mobile?apicall=<operation>   (params as form fields)
//
// AUTH: most operations require the mobile JWT as a Bearer token
//   (Authorization: Bearer <token>). The token is issued by verifyOTP
//   and stored on the user row. These are PUBLIC (no token needed):
//     loginuser, verifyOTP, register, admin_login, gallery, gallery_album,
//     gallery_category, get_policy
//   Everything else returns 401 without a valid token.
//
// Operations (apicall):
//   loginuser            { mobile, appHash? }             [public]  → send OTP
//                        (appHash optional: 11-char Android SMS Retriever hash → OTP autofill)
//   verifyOTP            { otp, mobile, DID? }            [public]  → login → JWT
//                        (DID optional: sent = bind this device; omitted = no device row)
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
//   home                                                 [auth]   → all modules + owned flag + song counts
//   get_content         { product }                      [auth]   → songs of a module (gated by ownership)
//   mark_played         { id }                           [auth]   → +1 play count for a song
//   subscribed_items                                     [auth]   → main items the user has subscribed to
//   sub_items           { product }                      [auth]   → detailed sub-items of a subscribed module
//   get_media           { id }                           [auth]   → media URL + lyrics for a tapped item
//   gallery             { category?, page?, limit? }     [public] → published albums + flat photo list
//   gallery_album       { id }                           [public] → one published album with its photos
//   gallery_category    { category, photoId?, page?, limit? } [public] → one category's albums + photos
//   get_policy          { type? }                        [public] → type=privacy|terms → { policy };
//                                                                   no type → { policies }. Each has a
//                                                                   `url` (web page for a WebView)
//   accept_policy       { type }                         [auth]   → type=privacy|terms|all; records the
//                                                                   current version for this user
//   policy_status                                        [auth]   → per type: currentVersion,
//                                                                   acceptedVersion, needsAcceptance
//
// NOTE: this uses its own mobile JWT — separate from the admin panel auth.
import { Router } from 'express'
import { dispatch } from '../controllers/mobile.controller.js'

const router = Router()

// Both GET and POST are accepted (the app posts form fields with ?apicall=).
router.all('/', dispatch)

export default router
