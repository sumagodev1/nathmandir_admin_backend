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

// A storable mobile: exactly 10 digits after normalization.
// (Kept lenient on the leading digit so the 1234567890 test account still works;
// the website frontend enforces the stricter 6–9 start for real devotees.)
export function isValidMobile(raw) {
  return /^\d{10}$/.test(normalizeMobile(raw))
}
