// ── Razorpay helper ───────────────────────────────────────────
// Server-side Razorpay integration for the WEBSITE payment flow.
// Uses the Razorpay REST API directly (fetch + Basic auth) and Node's
// built-in crypto for signature verification — no extra npm package.
//
// Config comes from env (see .env):
//   RAZORPAY_KEY_ID          test/live key id  (rzp_test_… / rzp_live_…)
//   RAZORPAY_KEY_SECRET      key secret        (NEVER sent to the client)
//   RAZORPAY_WEBHOOK_SECRET  webhook signing secret (optional)
import crypto from 'node:crypto'

const {
  RAZORPAY_KEY_ID = '',
  RAZORPAY_KEY_SECRET = '',
  RAZORPAY_WEBHOOK_SECRET = '',
} = process.env

// True once real keys are set — endpoints refuse to run without them.
export const razorpayConfigured = () =>
  Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && !RAZORPAY_KEY_ID.includes('REPLACE_ME'))

// The key id is public (the browser needs it to open the checkout).
export const RAZORPAY_PUBLIC_KEY = RAZORPAY_KEY_ID

// ── Module → unlock map ───────────────────────────────────────
// One entry per LEGACY purchasable module. `flag` is the boolean column on the
// User row that unlocks the module in the old app; `packageId` matches the PKG
// map in payments.controller.js.
//
// NOTE: `code` is the public module code (products.code). It is NOT the row's
// primary key — products.id is a numeric surrogate that happens to equal
// packageId for these four legacy modules (1, 2, 4, 5). Look products up by
// `code` and join on the id you get back.
export const MODULES = {
  gita1:   { flag: 'part1',          packageId: 1, code: 'gita1'   },
  gita2:   { flag: 'part2',          packageId: 2, code: 'gita2'   },
  upasana: { flag: 'upasanaPaid',    packageId: 4, code: 'upasana' },
  nithya:  { flag: 'nityaniyamPaid', packageId: 5, code: 'nithya'  },
}

// ── Create an order ───────────────────────────────────────────
// amountPaise = price in paise (₹251 → 25100). Returns the Razorpay
// order object ({ id, amount, currency, ... }).
export async function createRazorpayOrder({ amountPaise, receipt, notes }) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes,
      payment_capture: 1, // auto-capture on success
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body?.error?.description || `Razorpay order failed (${res.status})`)
  }
  return body
}

// Constant-time compare that tolerates unequal-length / missing input.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''))
  const bufB = Buffer.from(String(b || ''))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

// ── Verify a checkout signature ───────────────────────────────
// Razorpay signs `order_id|payment_id` with the key secret (HMAC-SHA256).
// This is what proves a browser-reported payment is genuine.
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const expected = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
  return safeEqual(expected, signature)
}

// ── Verify a webhook signature ────────────────────────────────
// Razorpay signs the exact raw request body with the webhook secret.
export function verifyWebhookSignature(rawBody, signature) {
  if (!RAZORPAY_WEBHOOK_SECRET) return false
  const expected = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  return safeEqual(expected, signature)
}
