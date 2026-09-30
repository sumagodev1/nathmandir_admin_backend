// ── Find a user by mobile number, whatever format it was saved in ──
// New rows are stored as 10 digits, but older ones can be "+91…", "0…" or
// "91…". An exact `phone = ?` match misses those, so the same person could be
// registered twice. This compares the normalized forms instead.
import { prisma } from './prisma.js'
import { normalizeMobile } from './phone.js'

/**
 * @param {string} mobile   any format; normalized here
 * @param {number} [exceptId] ignore this user (the one being edited)
 * @returns the first matching user, or null
 */
export async function findUserByMobile(mobile, exceptId) {
  const n = normalizeMobile(mobile)
  if (!n) return null
  // `contains` narrows it in SQL; the exact normalized comparison decides.
  const candidates = await prisma.user.findMany({
    where: { phone: { contains: n }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    orderBy: { id: 'asc' },
  })
  return candidates.find((u) => normalizeMobile(u.phone) === n) || null
}
