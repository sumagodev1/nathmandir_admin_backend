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
import { productMaps } from '../lib/products.js'
import { jsonSafe } from '../lib/helpers.js'
import { normalizeMobile, isValidMobile } from '../lib/phone.js'
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

// How long a website checkout OTP stays valid, and how many wrong guesses are
// allowed before the devotee has to request a fresh code.
const OTP_TTL_MS = 10 * 60 * 1000 // 10 minutes
const OTP_MAX_ATTEMPTS = 5

// Build the public module list (code, name, price) from the products table.
// Returns ALL active products so newly created Parts appear on the website immediately.
async function moduleList() {
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { id: 'asc' } })
  return products.map((p) => ({ code: p.code, name: p.name, price: p.price }))
}

// Fetch all product IDs from the DB (used for code validation in orders/payments).
// The set of valid module CODES (what the website posts), not numeric ids.
async function fetchAllProductIds() {
  const products = await prisma.product.findMany({ select: { code: true } })
  return new Set(products.map((p) => p.code))
}

// Modules this number already has — bought or granted, and not expired.
// user_access is the single source of truth for ownership.
// Used twice: verify-otp returns it so the website can grey out books the
// devotee already owns, and create-order re-checks it so a second payment for
// the same book is refused even if the browser skipped that hint (two tabs,
// back button, slow network).
// An unknown number returns [] — nothing is leaked, and the caller has proven
// the number with an OTP before this is ever sent back.
async function ownedModules(mobile) {
  const user = await prisma.user.findFirst({
    where: { phone: mobile },
    include: { access: { include: { product: true } } },
  })
  if (!user) return []
  const now = new Date()
  return user.access
    .filter((a) => a.product && (!a.expiresOn || a.expiresOn > now))
    .map((a) => ({ id: a.product.id, code: a.product.code, name: a.product.name }))
}

// Find a user by phone, or create a lightweight account (auto-register).
// Always keyed on the canonical 10-digit number so a devotee is one account
// no matter how the number was typed (09420…, +91 9420…, 9420…).
async function findOrCreateUser({ mobile, name, email }) {
  const phone = normalizeMobile(mobile)
  const existing = await prisma.user.findFirst({ where: { phone } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      name: (name || '').trim() || phone, // fall back to the number if no name
      phone,
      email: (email || '').trim(),
      city: '',
    },
  })
}

// Grant purchased modules: write UserAccess + Sale rows.
// user_access is the single source of truth for ownership — no flag columns are touched.
// Idempotent: safe to call from both verify-payment and the webhook.
async function recordAccessAndSales({ userId, codes, paymentId, orderId }) {
  for (const code of codes) {
    // `code` is the public module code the website posts; rows join on the
    // numeric surrogate id.
    const product = await prisma.product.findUnique({ where: { code } })
    if (!product) continue // module removed since the order was created
    const productId = product.id

    // Access row (purchased). Upsert on the (userId, productId) unique key.
    await prisma.userAccess.upsert({
      where: { userId_productId: { userId, productId } },
      update: { source: 'purchased', expiresOn: null },
      create: { userId, productId, source: 'purchased' },
    })

    // Sale row — one per module, keyed by a unique txn id so a replayed
    // verify-payment / webhook can't create duplicates.
    const txnId = `${paymentId || orderId}:${code}`
    await prisma.sale.upsert({
      where: { txnId },
      update: {},
      create: {
        txnId,
        userId,
        productId,
        amount: product?.price ?? 0,
        status: 'success',
        ref: orderId || null,
        gateway: 'razorpay',
      },
    })
  }
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
  const mobile = normalizeMobile(req.body?.mobile)
  if (!isValidMobile(mobile)) {
    return sendFail(res, 'Enter a valid 10-digit mobile number', STATUS.BAD_REQUEST)
  }

  // No account is created here. The number is unproven until the OTP comes
  // back, and creating a User row on "Send OTP" left a permanent ghost entry
  // in the admin Users list for every mistyped number or abandoned checkout.
  // The pending code lives in otp_challenge; the account is created only once
  // payment clears (verifyPayment → findOrCreateUser).
  //
  // Fixed OTP for the test account, random 4-digit otherwise (same as the app).
  const otp = mobile === '1234567890' ? '1947' : String(Math.floor(1000 + Math.random() * 9000))
  const expiresAt = new Date(Date.now() + OTP_TTL_MS)

  // Upsert on phone so a resend replaces the previous code (and clears any
  // earlier verification / attempt count) instead of piling up rows.
  await prisma.otpChallenge.upsert({
    where: { phone: mobile },
    update: { otp, expiresAt, verifiedAt: null, attempts: 0 },
    create: { phone: mobile, otp, expiresAt },
  })

  const sent = await sendOtpSms(mobile, otp)
  // In dev (no SMS gateway configured) sendOtpSms returns false and we echo the
  // OTP so testing works — exactly like the mobile API. In production it is withheld.
  return sendOk(res, 'OTP sent to your mobile', sent ? {} : { otp })
}

// ── OTP: verify ─ POST /verify-otp { mobile, otp } ────────────
// Confirms the OTP for the number entered on the form. On success the OTP is
// cleared; the frontend then proceeds to create the Razorpay order and pay.
export async function verifyOtp(req, res) {
  const mobile = normalizeMobile(req.body?.mobile)
  const otp = String(req.body?.otp ?? '').trim()
  if (!mobile || !otp) return sendFail(res, 'Enter the OTP', STATUS.BAD_REQUEST)

  const challenge = await prisma.otpChallenge.findUnique({ where: { phone: mobile } })
  if (!challenge) return sendFail(res, 'Please request an OTP first.', STATUS.UNAUTHORIZED)

  if (challenge.expiresAt < new Date()) {
    return sendFail(res, 'This OTP has expired. Please resend.', STATUS.UNAUTHORIZED)
  }

  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    return sendFail(res, 'Too many incorrect attempts. Please resend the OTP.', STATUS.UNAUTHORIZED)
  }

  if (challenge.otp !== otp) {
    await prisma.otpChallenge.update({
      where: { phone: mobile },
      data: { attempts: { increment: 1 } },
    })
    return sendFail(res, 'Incorrect OTP. Please try again.', STATUS.UNAUTHORIZED)
  }

  // Verified. The row is kept (not deleted) so the order step can confirm this
  // number was proven; it is cleared once payment completes.
  await prisma.otpChallenge.update({
    where: { phone: mobile },
    data: { verifiedAt: new Date(), attempts: 0 },
  })

  // Send back what this number already owns so the website can grey those books
  // out and re-total the cart HERE, instead of letting the devotee press
  // "Verify & Pay ₹1305" and only then be refused by create-order.
  const owned = await ownedModules(mobile)
  return sendOk(res, 'Mobile verified', {
    verified: true,
    owned: owned.map((p) => ({ code: p.code, name: p.name })),
    ownedCodes: owned.map((p) => p.code),
  })
}

// Normalise the requested module code(s) from the body. Accepts either
// `modules: ['gita1','gita2']` (new, multi-buy) or `module: 'gita1'` (single).
// Returns a de-duplicated array of valid codes (unknown product IDs dropped).
// `validIds` is a Set<string> of known product IDs fetched from the DB.
function readModuleCodes(body, validIds) {
  const raw = Array.isArray(body?.modules)
    ? body.modules
    : body?.module != null
      ? [body.module]
      : []
  const codes = []
  for (const c of raw) {
    const code = String(c).trim()
    if (validIds.has(code) && !codes.includes(code)) codes.push(code)
  }
  return codes
}

// ── 2. POST /create-order { mobile, name, email, modules[] } ──
// Supports buying ONE OR MORE modules in a single payment.
export async function createOrder(req, res) {
  if (!razorpayConfigured()) {
    return sendFail(res, 'Payment gateway not configured yet.', STATUS.SERVER_ERROR)
  }
  const mobile = normalizeMobile(req.body?.mobile)
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()

  // Validate codes against all products in the DB so newly created Parts are accepted.
  const allProductIds = await fetchAllProductIds()
  const codes = readModuleCodes(req.body, allProductIds)

  if (!isValidMobile(mobile)) return sendFail(res, 'Enter a valid 10-digit mobile number', STATUS.BAD_REQUEST)
  if (!name) return sendFail(res, 'Name required', STATUS.BAD_REQUEST)
  if (!codes.length) return sendFail(res, 'Select at least one module', STATUS.BAD_REQUEST)

  // Load the products for every selected module.
  // For legacy MODULES entries use their productId; for new products the code IS the productId.
  const items = []
  for (const code of codes) {
    const m = MODULES[code] ?? null
    const product = await prisma.product.findUnique({ where: { code } })
    if (!product) return sendFail(res, `Module not found: ${code}`, STATUS.NOT_FOUND)
    items.push({ code, m, product })
  }

  // If the number already owns any of the selected modules, stop early so the
  // devotee isn't charged twice. Two different situations, two messages:
  //   • owns SOME  → they can still pay for the rest, so name the ones to drop.
  //   • owns ALL   → "deselect" would leave an empty cart; there is nothing to
  //     buy, so point them at the app instead of a dead end.
  const ownedIds = new Set((await ownedModules(mobile)).map((p) => p.id))
  const ownedNames = items
    .filter((it) => ownedIds.has(it.product.id))
    .map((it) => it.product.name)
  if (ownedNames.length) {
    const message =
      ownedNames.length === items.length
        ? `This number already owns ${items.length === 1 ? 'this' : 'all these'}: ${ownedNames.join(', ')}. There is nothing left to buy — open the Nath Mandir app and log in with ${mobile}.`
        : `This number already owns: ${ownedNames.join(', ')}. Please deselect it.`
    return sendFail(res, message, STATUS.CONFLICT, { owned: ownedNames, ownsAll: ownedNames.length === items.length })
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

  // One pending payment row per legacy module that has a packageId.
  // New products (no MODULES entry) skip this legacy table — access is tracked via UserAccess.
  for (const it of items) {
    if (it.m?.packageId) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO user_payment
           (user_id, package_id, amount, razorpay_order_id, razorpay_stageOfPayment, payment_type, status, created_at)
         VALUES (NULL, ?, ?, ?, 'created', ?, '0', NOW())`,
        it.m.packageId, String(it.product.price), order.id, it.code
      )
    }
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
  const mobile = normalizeMobile(req.body?.mobile)
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()

  // Validate codes against all products (active or not) — payment already captured.
  const allProductIds = await fetchAllProductIds()
  const codes = readModuleCodes(req.body, allProductIds)

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

  // Payment is genuine → create/find the account and grant access via user_access.
  // No flag columns are written — user_access is the single source of truth.
  const user = await findOrCreateUser({ mobile, name, email })
  await prisma.user.update({ where: { id: user.id }, data: { isPaid: 1 } })
  await recordAccessAndSales({ userId: user.id, codes, paymentId, orderId })

  // Checkout is done — drop the pending verification so a stale "verified"
  // row can't be reused for a later order.
  await prisma.otpChallenge.deleteMany({ where: { phone: mobile } })

  // Finalise the payment row (status '1' = complete, unlocked).
  await prisma.$executeRawUnsafe(
    `UPDATE user_payment
       SET user_id = ?, razorpay_payment_id = ?, razorpay_stageOfPayment = 'completed', status = '1', updated_at = NOW()
     WHERE razorpay_order_id = ?`,
    user.id, paymentId, orderId
  )

  // Build owned map from user_access so it covers ALL products (not just the 4 hardcoded ones).
  const now = new Date()
  const freshAccess = await prisma.userAccess.findMany({
    where: { userId: user.id, OR: [{ expiresOn: null }, { expiresOn: { gt: now } }] },
    select: { productId: true },
  })
  const ownedSet = new Set(freshAccess.map((a) => a.productId))
  const allProducts = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, code: true },
  })
  // Keyed by code — the website identifies modules that way.
  const owned = Object.fromEntries(allProducts.map((p) => [p.code, ownedSet.has(p.id)]))

  return sendOk(res, 'Payment successful', {
    user: { id: user.id, name: user.name, mobile: user.phone },
    owned,
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
    // Validate against all products in DB so newly created Parts are accepted.
    const allProductIds = await fetchAllProductIds()
    const codes = String(notes.modules || notes.module || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c) => allProductIds.has(c))

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
        const user = await findOrCreateUser({ mobile: normalizeMobile(notes.mobile), name: notes.name, email: notes.email })
        await prisma.user.update({ where: { id: user.id }, data: { isPaid: 1 } })
        await recordAccessAndSales({ userId: user.id, codes, paymentId, orderId })
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
