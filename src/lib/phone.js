// ── Mobile-number normalization ───────────────────────────────
// One canonical form for every phone number so the SAME devotee is never
// stored as several users. The website form, the app and the admin panel
// must all resolve a number to the same 10-digit value, otherwise:
//   • 9420031902 / 09420031902 / +91 9420031902 become different accounts,
//   • a website purchase can't be matched back to the app user, and
//   • the "already owns this module" guard is trivially bypassed.
//
// This mirrors the frontend rule in src/utils/phone.js (admin frontend).

// Reduce any Indian mobile input to its canonical 10-digit form.
// Strips spaces, +, -, leading zero(s) and a 91 country code.
// Returns '' when no plausible 10-digit number can be extracted.
export function normalizeMobile(raw) {
  let d = String(raw ?? '').replace(/\D/g, '') // digits only
  if (!d) return ''
  d = d.replace(/^0+/, '')                      // 09420… → 9420…
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2) // +91 / 91 country code
  if (d.length > 10) d = d.slice(-10)           // keep the last 10 digits
  return d
}

// A storable mobile. Deliberately checked against the RAW digits, not against
// normalizeMobile's output.
//
// normalizeMobile keeps the last 10 digits of anything longer, which is right
// when READING a messy legacy row but disastrous as a validity test: typing 26
// digits sailed through, was stored as its last 10, and in one case matched a
// DIFFERENT devotee's account at registration. What is accepted for storage has
// to be a number somebody actually typed.
//
// So: 10 digits, or 12 with the 91 country code, and nothing longer.
//
// (Lenient on the leading digit so the 1234567890 test account still works; the
// website frontend enforces the stricter 6–9 start for real devotees.)
export function isValidMobile(raw) {
  const d = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '')
  return /^\d{10}$/.test(d) || /^91\d{10}$/.test(d)
}

// Validate AND normalize in one step, because doing them separately is a trap:
// isValidMobile has to see the raw input, but every call site wants the
// normalized value, and
//
//     const mobile = normalizeMobile(input)
//     if (!isValidMobile(mobile)) ...        // ← always passes
//
// reads perfectly and validates nothing. That exact line let a 26-digit number
// through the donation form and the app's registration.
//
// Returns { ok, value }. `value` is '' when ok is false.
export function readMobile(raw) {
  return isValidMobile(raw) ? { ok: true, value: normalizeMobile(raw) } : { ok: false, value: '' }
}
