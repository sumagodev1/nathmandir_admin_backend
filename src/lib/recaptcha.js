// ── reCAPTCHA v2 verification ─────────────────────────────────
// Guards the admin login against automated password guessing. There is one
// admin account, so an unlimited-rate login form is the whole attack surface.
//
// The secret NEVER reaches the browser — it lives in RECAPTCHA_SECRET_KEY and
// is only ever sent to Google from this server. The site key is public by
// design and is baked into the frontend build.
//
// Deliberately OPTIONAL: with no secret configured, verification is skipped and
// a warning is logged. Making it mandatory would mean that deploying this code
// before setting the env var locks everybody out of the only admin account,
// with no way back in except SSH.
const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify'

export const recaptchaConfigured = () => !!process.env.RECAPTCHA_SECRET_KEY

// Google's own words, turned into something an admin can act on.
const MESSAGES = {
  'missing-input-response': 'Please tick the "I\'m not a robot" box.',
  'invalid-input-response': 'That verification has expired. Please tick the box again.',
  'timeout-or-duplicate': 'That verification has already been used. Please tick the box again.',
  'missing-input-secret': 'Verification is not set up on the server.',
  'invalid-input-secret': 'Verification is not set up correctly on the server.',
}

/**
 * @returns {Promise<{ ok: boolean, error?: string }>}
 *
 * Never throws. A network failure between this server and Google must not be
 * the reason an admin cannot sign in, so it fails OPEN and says so in the log —
 * the password is still required either way.
 */
export async function verifyRecaptcha(token, ip) {
  if (!recaptchaConfigured()) {
    console.warn('⚠️  login: RECAPTCHA_SECRET_KEY is not set — captcha not checked')
    return { ok: true }
  }
  if (!token) return { ok: false, error: MESSAGES['missing-input-response'] }

  const body = new URLSearchParams({
    secret: process.env.RECAPTCHA_SECRET_KEY,
    response: String(token),
  })
  // Ties the solved captcha to the machine that solved it.
  if (ip) body.set('remoteip', String(ip))

  let data
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    })
    data = await res.json()
  } catch (err) {
    console.error(`⚠️  login: could not reach reCAPTCHA (${err.message}) — allowing the attempt`)
    return { ok: true }
  }

  if (data?.success) {
    // A v3 key would also return a score. This project uses a v2 checkbox key,
    // but honouring a score costs nothing and means swapping the key later
    // does not silently disable the check.
    if (typeof data.score === 'number' && data.score < 0.5) {
      return { ok: false, error: 'This request looked automated. Please try again.' }
    }
    return { ok: true }
  }

  const code = (data?.['error-codes'] || [])[0]
  if (code && code.endsWith('-secret')) {
    // A server misconfiguration, not the admin's fault — say so in the log.
    console.error(`✗ login: reCAPTCHA rejected our secret (${code})`)
  }
  return { ok: false, error: MESSAGES[code] || 'Verification failed. Please tick the box again.' }
}
