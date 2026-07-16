// ── HTTP status codes — single source of truth ────────────────
// Shared by the mobile app API so every response carries BOTH a real
// HTTP status code AND a visible `status` field in the JSON body.
//
// The legacy PHP API always replied 200 and put the outcome in
// `error: 'true'|'false'`. That envelope is preserved (so the shipped
// APK keeps working); `status` is simply added alongside it.
//
//   sendOk(res, 'Login Success', { token })
//     → 200  { status: 200, error: 'false', message: 'Login Success', token }
//
//   sendFail(res, 'OTP Incorrect', STATUS.UNAUTHORIZED)
//     → 401  { status: 401, error: 'true', message: 'OTP Incorrect' }

export const STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400, // missing / invalid parameters
  UNAUTHORIZED: 401, // bad credentials, wrong OTP, invalid or replaced token
  FORBIDDEN: 403,
  NOT_FOUND: 404, // user / record does not exist
  CONFLICT: 409, // duplicate (e.g. mobile already registered)
  SERVER_ERROR: 500, // unexpected failure
}

// Human-readable label for a code (handy for logs/docs).
export const STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  500: 'Internal Server Error',
}

// ── Compatibility switch ──────────────────────────────────────
// false → send the real HTTP status code (400/401/404/…).
// true  → always send HTTP 200 (exact legacy API.php behaviour) while the
//         body still shows the real code in `status`.
//
// Flip this to `true` if an older APK build treats any non-200 reply as a
// network error instead of reading the JSON body.
export const LEGACY_ALWAYS_200 = false

const httpCode = (code) => (LEGACY_ALWAYS_200 ? STATUS.OK : code)

// Success reply — keeps `error: 'false'` for backward compatibility.
export const sendOk = (res, message, extra = {}, code = STATUS.OK) =>
  res.status(httpCode(code)).json({ status: code, error: 'false', message, ...extra })

// Failure reply — keeps `error: 'true'` for backward compatibility.
export const sendFail = (res, message, code = STATUS.BAD_REQUEST, extra = {}) =>
  res.status(httpCode(code)).json({ status: code, error: 'true', message, ...extra })
