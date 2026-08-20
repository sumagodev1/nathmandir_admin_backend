// ── Website donation controller ───────────────────────────────
// Same Razorpay engine as the app-module checkout, but a DIFFERENT
// purpose: a donation is a one-off gift of any amount with NO module
// unlock and NO account. Donor details + amount + category are stored
// in the separate `donation` table.
//
//   POST /api/donate/create-order   { name, mobile, email?, amount, category? }
//   POST /api/donate/verify-payment { razorpay_order_id, razorpay_payment_id, razorpay_signature }
import { prisma } from '../lib/prisma.js'
import { readMobile } from '../lib/phone.js'
import { STATUS, sendOk, sendFail } from '../lib/statusCodes.js'
import {
  razorpayConfigured,
  RAZORPAY_PUBLIC_KEY,
  createRazorpayOrder,
  verifyPaymentSignature,
} from '../lib/razorpay.js'

const VALID_CATEGORIES = ['temple-development', 'annadan', 'festival-support', 'general']

// ── POST /create-order ────────────────────────────────────────
export async function createOrder(req, res) {
  if (!razorpayConfigured()) {
    return sendFail(res, 'Payment gateway not configured yet.', STATUS.SERVER_ERROR)
  }
  const name = String(req.body?.name ?? '').trim()
  const phone = readMobile(req.body?.mobile)
  const mobile = phone.value
  const email = String(req.body?.email ?? '').trim()
  let category = String(req.body?.category ?? '').trim()
  const amount = Math.round(Number(req.body?.amount))

  if (!name) return sendFail(res, 'Name required', STATUS.BAD_REQUEST)
  if (!phone.ok) return sendFail(res, 'Enter a valid 10-digit mobile number', STATUS.BAD_REQUEST)
  if (!amount || amount < 1) return sendFail(res, 'Enter a valid donation amount', STATUS.BAD_REQUEST)
  if (!VALID_CATEGORIES.includes(category)) category = 'general'

  let order
  try {
    order = await createRazorpayOrder({
      amountPaise: amount * 100,
      receipt: `don_${Date.now()}`,
      notes: { type: 'donation', name, mobile, category },
    })
  } catch (err) {
    return sendFail(res, err.message || 'Could not create order', STATUS.SERVER_ERROR)
  }

  // Pending donation row (status '0' = not yet paid).
  await prisma.$executeRawUnsafe(
    `INSERT INTO donation (name, mobile, email, amount, category, razorpay_order_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '0', NOW())`,
    name, mobile, email, String(amount), category, order.id
  )

  return sendOk(res, 'Order created', {
    orderId: order.id,
    amount: order.amount, // paise
    currency: order.currency,
    keyId: RAZORPAY_PUBLIC_KEY,
    prefill: { name, contact: mobile, email },
  })
}

// ── POST /verify-payment ──────────────────────────────────────
export async function verifyPayment(req, res) {
  const orderId = String(req.body?.razorpay_order_id ?? '')
  const paymentId = String(req.body?.razorpay_payment_id ?? '')
  const signature = String(req.body?.razorpay_signature ?? '')
  if (!orderId || !paymentId || !signature) {
    return sendFail(res, 'Missing payment parameters', STATUS.BAD_REQUEST)
  }

  if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
    await prisma.$executeRawUnsafe(
      `UPDATE donation SET status = 'failed', updated_at = NOW() WHERE razorpay_order_id = ?`,
      orderId
    )
    return sendFail(res, 'Payment verification failed', STATUS.UNAUTHORIZED)
  }

  await prisma.$executeRawUnsafe(
    `UPDATE donation SET razorpay_payment_id = ?, status = '1', updated_at = NOW() WHERE razorpay_order_id = ?`,
    paymentId, orderId
  )
  return sendOk(res, 'Thank you for your donation')
}
