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
} = process.env

// Build the OTP message body (kept identical to the app's DLT template).
const otpMessage = (otp) =>
  `Your OTP for login is ${otp}. It is valid for 10 minutes. Do not share it with anyone.\n\nTeam Sumago Infotech`

export async function sendOtpSms(mobile, otp) {
  if (!SMS_AUTH_KEY) {
    console.warn('[sms] SMS_AUTH_KEY not set — skipping SMS send (dev mode).')
    return false
  }

  const params = new URLSearchParams({
    authkey: SMS_AUTH_KEY,
    mobiles: String(mobile),
    message: otpMessage(otp),
    sender: SMS_SENDER,
    route: SMS_ROUTE,
    country: SMS_COUNTRY,
    DLT_TE_ID: SMS_DLT_TEMPLATE_ID,
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
