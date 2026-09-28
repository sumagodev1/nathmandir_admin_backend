// ── SMS gateway helper (HappySMS / DLT) ───────────────────────
// Sends the OTP login SMS. Config comes from env so no keys are
// hard-coded (the old API.php had the authkey inline).
//
//   SMS_API_URL          default http://sms.happysms.in/api/sendhttp.php
//   SMS_AUTH_KEY         authkey for the gateway (required to actually send)
//   SMS_SENDER           sender id (default SMGTCH)
//   SMS_DLT_TEMPLATE_ID  DLT template id (default matches the app template)
//   SMS_ROUTE            route (default 4)
//   SMS_COUNTRY          country code (default 91)
//   SMS_AUTOFILL_TEMPLATE_ID  DLT template id of the OTP text that ends in the
//                        app hash (Android SMS Retriever autofill). Unset =
//                        autofill is off and every SMS uses the old template.
//
// If SMS_AUTH_KEY is not set, sending is skipped (dev mode) and the
// function resolves to false — the OTP is still returned in the API
// response, exactly like the original PHP did.

const {
  SMS_API_URL = 'http://sms.happysms.in/api/sendhttp.php',
  SMS_AUTH_KEY,
  SMS_SENDER = 'SMGTCH',
  SMS_DLT_TEMPLATE_ID = '1207174427425038676',
  SMS_ROUTE = '4',
  SMS_COUNTRY = '91',
  SMS_AUTOFILL_TEMPLATE_ID,
} = process.env

// Build the OTP message body (kept identical to the app's DLT template).
const otpMessage = (otp) =>
  `Your OTP for login is ${otp}. It is valid for 10 minutes. Do not share it with anyone.\n\nTeam Sumago Infotech`

// The autofill template. Must match the DLT-approved text character for
// character, or the gateway rejects the SMS. Android reads the 11-character
// app hash at the end and hands the OTP to the app without the user typing it.
const autofillMessage = (otp, hash) =>
  `Your OTP for login is ${otp}. It is valid for 10 minutes. Do not share it with anyone. Team Sumago Infotech ${hash}`

/**
 * An app hash is exactly 11 characters of base64. Returns it cleaned, or null.
 * A form-encoded body turns an unescaped "+" into a space, so a space is put
 * back — otherwise any hash containing "+" would silently fail to match.
 */
export function cleanAppHash(raw) {
  if (raw === undefined || raw === null) return null
  const hash = String(raw).trim().replace(/ /g, '+')
  return /^[A-Za-z0-9+/]{11}$/.test(hash) ? hash : null
}

/**
 * @param {object} [opts]
 * @param {string} [opts.appHash]  sent by the app for SMS autofill. Used only
 *   when SMS_AUTOFILL_TEMPLATE_ID is set; otherwise the old SMS goes out, so an
 *   old app, or a new app before the template is approved, is unaffected.
 */
export async function sendOtpSms(mobile, otp, { appHash } = {}) {
  if (!SMS_AUTH_KEY) {
    console.warn('[sms] SMS_AUTH_KEY not set — skipping SMS send (dev mode).')
    return false
  }

  const hash = SMS_AUTOFILL_TEMPLATE_ID ? cleanAppHash(appHash) : null

  const params = new URLSearchParams({
    authkey: SMS_AUTH_KEY,
    mobiles: String(mobile),
    message: hash ? autofillMessage(otp, hash) : otpMessage(otp),
    sender: SMS_SENDER,
    route: SMS_ROUTE,
    country: SMS_COUNTRY,
    DLT_TE_ID: hash ? SMS_AUTOFILL_TEMPLATE_ID : SMS_DLT_TEMPLATE_ID,
  })

  try {
    const res = await fetch(`${SMS_API_URL}?${params.toString()}`)
    const body = await res.text()
    if (!res.ok || !body) {
      console.error('[sms] gateway responded with:', res.status, body)
      return false
    }
    return true
  } catch (err) {
    console.error('[sms] send failed:', err.message)
    return false
  }
}
