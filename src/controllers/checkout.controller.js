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

// ── 2. POST /create-order { mobile, name, email, module } ─────
export async function createOrder(req, res) {
  if (!razorpayConfigured()) {
    return sendFail(res, 'Payment gateway not configured yet.', STATUS.SERVER_ERROR)
  }
  const mobile = String(req.body?.mobile ?? '').trim()
  const name = String(req.body?.name ?? '').trim()
  const email = String(req.body?.email ?? '').trim()
  const moduleCode = String(req.body?.module ?? '').trim()
  const m = MODULES[moduleCode]

  if (!mobile) return sendFail(res, 'Mobile number required', STATUS.BAD_REQUEST)
  if (!name) return sendFail(res, 'Name required', STATUS.BAD_REQUEST)
  if (!m) return sendFail(res, 'Invalid module', STATUS.BAD_REQUEST)

  const product = await prisma.product.findUnique({ where: { id: m.productId } })
  if (!product) return sendFail(res, 'Module not found', STATUS.NOT_FOUND)

  // If the number already exists AND already owns this module, stop early.
  const existing = await prisma.user.findFirst({ where: { phone: mobile } })
  if (existing && existing[m.flag] === 1) {
    return sendFail(res, 'This number already owns this module', STATUS.CONFLICT)
  }

  let order
  try {
    order = await createRazorpayOrder({
      amountPaise: product.price * 100,
      receipt: `rcpt_${moduleCode}_${Date.now()}`,
      notes: { mobile, name, email, module: moduleCode },
    })
  } catch (err) {
    return sendFail(res, err.message || 'Could not create order', STATUS.SERVER_ERROR)
  }

  // Pending payment row (user_id filled in once the user is created).
  await prisma.$executeRawUnsafe(
    `INSERT INTO user_payment
       (user_id, package_id, amount, razorpay_order_id, razorpay_stageOfPayment, payment_type, status, created_at)
     VALUES (NULL, ?, ?, ?, 'created', ?, '0', NOW())`,
    m.packageId, String(product.price), order.id, moduleCode
  )

  return sendOk(res, 'Order created', {
    orderId: order.id,
    amount: order.amount, // paise
    currency: order.currency,
    keyId: RAZORPAY_PUBLIC_KEY,
    module: moduleCode,
    name: product.name,
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
  const moduleCode = String(req.body?.module ?? '').trim()
  const m = MODULES[moduleCode]

  if (!orderId || !paymentId || !signature || !mobile || !m) {
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
  // unlock the module straight away against the mobile from the form.
  const user = await findOrCreateUser({ mobile, name, email })
  await prisma.user.update({
    where: { id: user.id },
    data: { [m.flag]: 1, isPaid: 1 },
  })

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
    const m = MODULES[notes.module]

    if (orderId && m && notes.mobile) {
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
        await prisma.user.update({ where: { id: user.id }, data: { [m.flag]: 1, isPaid: 1 } })
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
