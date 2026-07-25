// ── Website checkout controller ───────────────────────────────
// "Spotify model" payment flow. Payment happens on the WEBSITE (not in
// the app). The mobile number used to pay is the SAME number the user
// logs into the app with — that is how access follows the user.
//
// Flow (pay, then unlock — no OTP; the mobile is collected on the form):
//   1. GET  modules                                      → module list + prices
//   2. POST create-order   { mobile, name, email, module } → Razorpay order
//   3. (browser) Razorpay Checkout → payment
//   4. POST verify-payment { order, payment, signature, mobile, name, email, module }
//        → signature check → create/find the user → unlock the module
//   5. POST webhook  (Razorpay → server) → same unlock as a reliability net
//
// The account is auto-created on the first successful payment, and the
// module flag is set against the mobile number entered on the form.
import { prisma } from '../lib/prisma.js'
import { jsonSafe } from '../lib/helpers.js'
import { STATUS, sendOk, sendFail } from '../lib/statusCodes.js'
import { sendOtpSms } from '../lib/sms.js'
import {
  MODULES,
  razorpayConfigured,
  RAZORPAY_PUBLIC_KEY,
  createRazorpayOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../lib/razorpay.js'

// Build the public module list (code, name, price) from the products table.
async function moduleList() {
  const products = await prisma.product.findMany()
  const byId = new Map(products.map((p) => [p.id, p]))
  return Object.entries(MODULES).map(([code, m]) => {
    const p = byId.get(m.productId)
    return { code, name: p?.name || code, price: p?.price ?? 0 }
  })
}

// Which modules a given user already owns (for the "owned" badges).
function ownedFlags(user) {
  return Object.fromEntries(Object.entries(MODULES).map(([code, m]) => [code, user[m.flag] === 1]))
}

// Find a user by phone, or create a lightweight account (auto-register).
async function findOrCreateUser({ mobile, name, email }) {
  const existing = await prisma.user.findFirst({ where: { phone: mobile } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      name: (name || '').trim() || mobile, // fall back to the number if no name
      phone: mobile,
      email: (email || '').trim(),
      city: '',
    },
  })
}

// ── 1. GET /modules — public list with prices ─────────────────
export async function modules(req, res) {
  return sendOk(res, 'Modules', { modules: await moduleList() })
}

// ── OTP: send ─ POST /send-otp { mobile, name?, email? } ──────
// Proves the devotee controls the number BEFORE payment. Creates/finds the
// account by phone (so an EXISTING app user keeps the same account and their
// purchase attaches to it), stores an OTP, and sends it by SMS.
export async function sendOtp(req, res) {
  const mobile = String(req.body?.mobile ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()
  if (!/^\d{10,15}$/.test(mobile)) {
    return sendFail(res, 'Enter a valid mobile number', STATUS.BAD_REQUEST)
  }

  // Find-or-create by phone: existing (incl. "Free" app) users are reused.
  const user = await findOrCreateUser({ mobile, name, email })

  // Fixed OTP for the test account, random 4-digit otherwise (same as the app).
  const otp = mobile === '1234567890' ? '1947' : String(Math.floor(1000 + Math.random() * 9000))
  await prisma.user.update({ where: { id: user.id }, data: { otp } })

  const sent = await sendOtpSms(mobile, otp)
  // In dev (no SMS gateway configured) sendOtpSms returns false and we echo the
  // OTP so testing works — exactly like the mobile API. In production it is withheld.
  return sendOk(res, 'OTP sent to your mobile', sent ? {} : { otp })
}

// ── OTP: verify ─ POST /verify-otp { mobile, otp } ────────────
// Confirms the OTP for the number entered on the form. On success the OTP is
// cleared; the frontend then proceeds to create the Razorpay order and pay.
export async function verifyOtp(req, res) {
  const mobile = String(req.body?.mobile ?? '').trim()
  const otp = String(req.body?.otp ?? '').trim()
  if (!mobile || !otp) return sendFail(res, 'Enter the OTP', STATUS.BAD_REQUEST)

  const user = await prisma.user.findFirst({ where: { phone: mobile, otp } })
  if (!user) return sendFail(res, 'Incorrect OTP. Please try again.', STATUS.UNAUTHORIZED)

  await prisma.user.update({ where: { id: user.id }, data: { otp: '' } })
  return sendOk(res, 'Mobile verified', { verified: true })
}

// Normalise the requested module code(s) from the body. Accepts either
// `modules: ['gita1','gita2']` (new, multi-buy) or `module: 'gita1'` (single).
// Returns a de-duplicated array of valid codes (unknown codes dropped).
function readModuleCodes(body) {
  const raw = Array.isArray(body?.modules)
    ? body.modules
    : body?.module != null
      ? [body.module]
      : []
  const codes = []
  for (const c of raw) {
    const code = String(c).trim()
    if (MODULES[code] && !codes.includes(code)) codes.push(code)
  }
  return codes
}

// ── 2. POST /create-order { mobile, name, email, modules[] } ──
// Supports buying ONE OR MORE modules in a single payment.
export async function createOrder(req, res) {
  if (!razorpayConfigured()) {
    return sendFail(res, 'Payment gateway not configured yet.', STATUS.SERVER_ERROR)
  }
  const mobile = String(req.body?.mobile ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()
  const codes = readModuleCodes(req.body)

  if (!mobile) return sendFail(res, 'Mobile number required', STATUS.BAD_REQUEST)
  if (!name) return sendFail(res, 'Name required', STATUS.BAD_REQUEST)
  if (!codes.length) return sendFail(res, 'Select at least one module', STATUS.BAD_REQUEST)

  // Load the products for every selected module.
  const items = []
  for (const code of codes) {
    const m = MODULES[code]
    const product = await prisma.product.findUnique({ where: { id: m.productId } })
    if (!product) return sendFail(res, `Module not found: ${code}`, STATUS.NOT_FOUND)
    items.push({ code, m, product })
  }

  // If the number already owns any of the selected modules, stop early so the
  // devotee isn't charged twice — tell them which ones to deselect.
  const existing = await prisma.user.findFirst({ where: { phone: mobile } })
  if (existing) {
    const owned = items.filter((it) => existing[it.m.flag] === 1).map((it) => it.product.name)
    if (owned.length) {
      return sendFail(res, `This number already owns: ${owned.join(', ')}. Please deselect it.`, STATUS.CONFLICT)
    }
  }

  const totalRupees = items.reduce((sum, it) => sum + it.product.price, 0)

  let order
  try {
    order = await createRazorpayOrder({
      amountPaise: totalRupees * 100,
      receipt: `rcpt_${Date.now()}`,
      // Store the full module list on the order so the webhook can unlock all.
      notes: { mobile, name, email, module: codes.join(','), modules: codes.join(',') },
    })
  } catch (err) {
    return sendFail(res, err.message || 'Could not create order', STATUS.SERVER_ERROR)
  }

  // One pending payment row per module (all share the razorpay_order_id).
  for (const it of items) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO user_payment
         (user_id, package_id, amount, razorpay_order_id, razorpay_stageOfPayment, payment_type, status, created_at)
       VALUES (NULL, ?, ?, ?, 'created', ?, '0', NOW())`,
      it.m.packageId, String(it.product.price), order.id, it.code
    )
  }

  return sendOk(res, 'Order created', {
    orderId: order.id,
    amount: order.amount, // paise (total)
    currency: order.currency,
    keyId: RAZORPAY_PUBLIC_KEY,
    modules: codes,
    name: items.map((it) => it.product.name).join(', '),
    prefill: { contact: mobile, name, email },
  })
}

// ── 3. POST /verify-payment ───────────────────────────────────
// { razorpay_order_id, razorpay_payment_id, razorpay_signature, mobile, name, email, module }
// Verifies the signature, creates/finds the account, and grants access
// immediately. The mobile number was already collected on the form
// before payment, so no separate OTP step is needed.
export async function verifyPayment(req, res) {
  const orderId = String(req.body?.razorpay_order_id ?? '')
  const paymentId = String(req.body?.razorpay_payment_id ?? '')
  const signature = String(req.body?.razorpay_signature ?? '')
  const mobile = String(req.body?.mobile ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()
  const codes = readModuleCodes(req.body)

  if (!orderId || !paymentId || !signature || !mobile || !codes.length) {
    return sendFail(res, 'Missing payment parameters', STATUS.BAD_REQUEST)
  }

  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    await prisma.$executeRawUnsafe(
      `UPDATE user_payment SET razorpay_stageOfPayment = 'failed' WHERE razorpay_order_id = ?`,
      orderId
    )
    return sendFail(res, 'Payment verification failed', STATUS.UNAUTHORIZED)
  }

  // Payment is genuine → create/find the account (auto-register) and
  // unlock EVERY purchased module against the mobile from the form.
  const user = await findOrCreateUser({ mobile, name, email })
  const unlock = { isPaid: 1 }
  for (const code of codes) unlock[MODULES[code].flag] = 1
  await prisma.user.update({ where: { id: user.id }, data: unlock })

  // Finalise the payment row (status '1' = complete, unlocked).
  await prisma.$executeRawUnsafe(
    `UPDATE user_payment
       SET user_id = ?, razorpay_payment_id = ?, razorpay_stageOfPayment = 'completed', status = '1', updated_at = NOW()
     WHERE razorpay_order_id = ?`,
    user.id, paymentId, orderId
  )

  const fresh = await prisma.user.findUnique({ where: { id: user.id } })
  return sendOk(res, 'Payment successful', {
    user: { id: fresh.id, name: fresh.name, mobile: fresh.phone },
    owned: ownedFlags(fresh),
  })
}

// ── 4. POST /webhook — Razorpay backup (server-to-server) ─────
// Reliability net: if the browser closes before verify-payment runs,
// Razorpay still notifies us here so access is granted from the order
// notes (mobile/name/email/module).
export async function webhook(req, res) {
  const signature = req.headers['x-razorpay-signature']
  const raw = req.rawBody
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    return sendFail(res, 'Invalid webhook signature', STATUS.UNAUTHORIZED)
  }

  const event = req.body?.event
  if (event === 'payment.captured' || event === 'order.paid') {
    const entity = req.body?.payload?.payment?.entity || {}
    const orderId = entity.order_id
    const paymentId = entity.id
    const notes = entity.notes || {}
    // notes.module(s) may be a single code or a comma-separated list (multi-buy).
    const codes = String(notes.modules || notes.module || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => MODULES[c])

    if (orderId && codes.length && notes.mobile) {
      // Idempotent: only act if this order hasn't been unlocked already
      // (the browser's verify-payment usually gets there first).
      const rows = jsonSafe(
        await prisma.$queryRawUnsafe(
          `SELECT status FROM user_payment WHERE razorpay_order_id = ? LIMIT 1`,
          orderId
        )
      )
      if (!rows.length || rows[0].status !== '1') {
        const user = await findOrCreateUser({ mobile: notes.mobile, name: notes.name, email: notes.email })
        const unlock = { isPaid: 1 }
        for (const code of codes) unlock[MODULES[code].flag] = 1
        await prisma.user.update({ where: { id: user.id }, data: unlock })
        await prisma.$executeRawUnsafe(
          `UPDATE user_payment
             SET user_id = ?, razorpay_payment_id = COALESCE(razorpay_payment_id, ?),
                 razorpay_stageOfPayment = 'completed', status = '1', updated_at = NOW()
           WHERE razorpay_order_id = ?`,
          user.id, paymentId, orderId
        )
      }
    }
  }
  return res.status(200).json({ status: 'ok' })
}
