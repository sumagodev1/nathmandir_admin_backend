# Mobile API — Backend Developer Handoff

**Audience:** the next backend developer inheriting this codebase.
**Scope:** the 6 mobile-app APIs that back the "subscribe → browse → play" flow.

## 1. Where the code lives

| Piece | Path |
|---|---|
| All 6 handlers + dispatcher | `src/controllers/mobile.controller.js` |
| Router (mounts `/api/mobile`) | `src/routes/mobile.routes.js` |
| Prisma models used | `prisma/schema.prisma` — `User`, `Product`, `Content` |
| Module → unlock-flag map | `src/lib/razorpay.js` (`MODULES`) |
| Response envelope helpers | `src/lib/statusCodes.js` (`sendOk`, `sendFail`) |
| JWT + auth helper | inside `mobile.controller.js` (`authenticateMobile`) |
| SMS OTP sender | `src/lib/sms.js` |

There is **one HTTP endpoint** — `POST /api/mobile?apicall=<name>` — and one dispatcher (`dispatch` at the bottom of the controller). Every API is a handler in the `handlers` map and is selected by the `apicall` query/body field. This mirrors the legacy `API.php` the mobile app was originally built against, so the app's URL shape didn't have to change.

## 2. The mental model

The website sells modules. The app plays them. Nothing is sold inside the app.

- Payment happens on the website. A successful Razorpay payment sets a **flag column** on the `users` row (`part_1`, `part_2`, `upasana_paid`, `nityaniyam_paid`) — 1 means owned.
- The app authenticates with mobile + OTP → gets a JWT. Every content call reads those flags to decide what the user is allowed to see and play.
- Media URLs are **never** returned in list responses. They are only returned by `get_media`, and only after re-checking the flag on the user row. This prevents URL harvesting from the list endpoints.

The `MODULES` map in `src/lib/razorpay.js` is the single source of truth for "module code ↔ product row ↔ user flag":

```js
gita1:   { flag: 'part1',          productId: 'gita1'   }
gita2:   { flag: 'part2',          productId: 'gita2'   }
upasana: { flag: 'upasanaPaid',    productId: 'upasana' }
nithya:  { flag: 'nityaniyamPaid', productId: 'nithya'  }
```

Every ownership check in every handler goes through this map — so adding a new module is a one-line change here plus a new flag column on `users`.

## 3. The user journey → which APIs fire when

```
App install
   ↓
[If not registered]  register            (public)
   ↓
   loginuser        (public)  → server generates OTP, sends SMS, stores otp on user row
   ↓
   verifyOTP        (public)  → validates OTP, issues JWT, stores token on user row
   ↓
[App has token from here on — sends Authorization: Bearer <token> on every call]
   ↓
Home / "My Subscriptions" screen
   → subscribed_items                 → returns modules where user's flag = 1
   ↓
User taps a subscribed module
   → sub_items { product }            → returns list of Content rows (metadata only)
   ↓
User taps a sub-item to play
   → get_media { id }                 → returns absolute audioUrl + lyrics
```

The three public calls fire during onboarding. The three protected calls fire on every session.

## 4. How each API works, step by step

Every handler follows the same three-part pattern: read params → check DB → return envelope.

### 4.1 `register` (public)

**Purpose:** create a new devotee account.

**Body:** `name`, `email`, `mobile` (required); `city`, `address` (optional).

**Internals:**
1. Read the three required fields via the `field()` helper (reads body first, falls back to query string — matches PHP `$_POST`).
2. Look up the phone number: `prisma.user.findFirst({ where: { phone: mobile } })`.
3. If already present → 409 `Mobile Number Already exist`.
4. Otherwise: `prisma.user.create(...)`. All the flag columns default to 0 (see `schema.prisma`), so a fresh user has no subscriptions.
5. Return `201 Register Successfully`.

**No SMS, no OTP, no auth.** This is just an insert.

### 4.2 `loginuser` (public)

**Purpose:** send an OTP to a registered mobile.

**Body:** `mobile` (required).

**Internals:**
1. Find the user by phone.
2. If not found → 404 `Please Register First` (the app should route back to register).
3. Generate a 4-digit OTP — `1947` for the test number `1234567890`, random otherwise.
4. `prisma.user.update` — save the OTP on the user row.
5. Call `sendOtpSms(mobile, otp)` (`src/lib/sms.js`). In dev this is a no-op; in prod it hits the SMS provider using the env auth key.
6. **Also echo the OTP back in the JSON.** This is a legacy convenience for dev/testing — production apps should ignore it.

### 4.3 `verifyOTP` (public)

**Purpose:** verify OTP, issue a JWT, bind the device.

**Body:** `mobile`, `otp` (required); `DID` (optional device id).

**Internals:**
1. Find user where phone AND otp match.
2. On miss → 401 `OTP Incorrect`.
3. Sign a JWT with `{ id, mobile, name }` and `JWT_SECRET`. `MOBILE_JWT_EXPIRES` (default `365d`) controls the lifetime.
4. Clear the OTP field, mark the user active, and **persist the JWT on `users.token`** via a raw SQL update (Prisma didn't originally know about this column).
5. If a `DID` was supplied, delete any existing `login_user` row for this mobile and insert a fresh one — this is what "single-device login" is built on.
6. Return `Login Success` with `token` + the full user object (via `toPhpUser`).

**Why persist the token?** Because `authenticateMobile` (see §5) compares the incoming Bearer against `users.token`. A new login on another device overwrites this field, so old JWTs get rejected even though they're still cryptographically valid. That's how "logged in on another device" works.

### 4.4 `subscribed_items` (Bearer)

**Purpose:** the home / My Subscriptions screen — only modules the user has paid for.

**Body:** none.

**Internals:**
1. Load the user row by `req.mobileUser.id` (set by `authenticateMobile`).
2. Filter `MODULES` entries by `user[m.flag] === 1` — that's the "did they pay for this?" check.
3. If nothing owned → return `200 No subscriptions` with `items: []`. Empty list is NOT an error.
4. For the owned entries:
   - `prisma.product.findMany({ id: { in: productIds } })` → names and prices.
   - `prisma.content.groupBy({ productId, where: { published: true }, _count })` → sub-item counts per module.
5. Return `items: [{ code, name, price, itemCount }]`.

**Deliberately does not return media URLs, IDs, or content titles.** Those are only fetched when the user drills in.

### 4.5 `sub_items` (Bearer)

**Purpose:** detail screen for one subscribed module.

**Body:** `product` (module code, required).

**Internals:**
1. Validate `product` maps to a `MODULES` entry → else 400 `Invalid module`.
2. Load the user; if `user[m.flag] !== 1` → 403 `This module is not subscribed`. (Note the difference vs `get_content`: `get_content` returns locked rows with `locked: true`; `sub_items` refuses outright — because this endpoint powers a screen the user should only reach if they own the module.)
3. `prisma.content.findMany` for `{ productId, published: true }` ordered by `sortOrder`.
4. Project each row to `{ id, title, type, duration, sortOrder, plays, hasAudio, hasLyrics }`. **No `audioUrl` and no `lyrics`** — the app calls `get_media` on tap.

### 4.6 `get_media` (Bearer)

**Purpose:** onclick — return the playable media for one sub-item.

**Body:** `id` (Content id, required).

**Internals:**
1. Load the content row. Not found or unpublished → 404.
2. Find the `MODULES` entry whose `productId` matches this content's `productId`. Missing → 400 `Invalid module` (shouldn't happen unless the DB was hand-edited).
3. Re-check the user's flag: `user[entry[1].flag] !== 1` → 403 `This module is not subscribed`. This check is deliberately redundant with `sub_items` — a stolen `id` from a leaked list still can't be played by a non-subscriber.
4. Convert the stored `audioUrl` to an absolute URL via `absUrl(req, ...)`:
   - Full `http(s)://` URLs pass through untouched.
   - Relative `/uploads/...` refs get prefixed with `PUBLIC_BASE_URL` (env) or the request origin.
5. Return `{ id, title, type, duration, audioUrl, lyrics }`.

## 5. Auth — how Bearer tokens are validated

Look at `dispatch` and `authenticateMobile` at the bottom of `mobile.controller.js`.

- `PUBLIC_APICALLS` = `{ loginuser, verifyOTP, register, admin_login }`. Everything else is protected.
- For a protected call, `authenticateMobile(req)`:
  1. Reads the `Authorization: Bearer <token>` header.
  2. Verifies the JWT signature with `JWT_SECRET`.
  3. Looks up `users.token` for the id in the payload — **rejects the request if it doesn't match**. That's the "another device replaced you" check.
  4. On success, sets `req.mobileUser = { id, mobile, name }` for the handler to use.
- Failure returns 401. The app is expected to route back to the login flow on 401.

## 6. Response envelope — non-negotiable shape

Everything goes through `sendOk` / `sendFail` from `src/lib/statusCodes.js`:

```json
{ "status": 200, "error": "false", "message": "...", "...": "..." }
```

- `error` is a **string** (`"true"` / `"false"`), never a boolean. Legacy PHP behavior — kept as-is because the shipped APK reads it as a string.
- `LEGACY_ALWAYS_200` in `statusCodes.js` can force every reply to HTTP 200 (older APKs treated non-200 as a network error). It's currently `false` — flip it if an old APK build breaks.

Do NOT `res.json(...)` directly in a handler — always use the helpers. This is how the envelope stays consistent.

## 7. Adding another module (worked example)

Say we want to add `bhajan` at ₹199.

1. Add a Prisma field on `User`: `bhajanPaid Int @default(0) @map("bhajan_paid")` and migrate.
2. Add to `MODULES` in `src/lib/razorpay.js`:
   ```js
   bhajan: { flag: 'bhajanPaid', packageId: 6, productId: 'bhajan' }
   ```
3. Add the row in `products`: `INSERT INTO products (id, name, short_name, price) VALUES ('bhajan', 'Bhajan Sangraha', 'Bhajan', 199)`.
4. Add `bhajanPaid` to `toPhpUser` in `mobile.controller.js` so it round-trips in the user object.
5. That's it. All 3 protected APIs pick it up automatically because they iterate `MODULES`.

## 8. Local dev checklist

```powershell
cd "D:\Nathmandir backend\nathmandir_admin_backend"

# One-time
npm install
npx prisma migrate dev

# Every session
npm run dev
```

Env vars that matter for these APIs (see `.env`):
- `DATABASE_URL` — MySQL connection.
- `JWT_SECRET` — signs and verifies mobile JWTs.
- `MOBILE_JWT_EXPIRES` — default `365d`.
- `SMS_AUTH_KEY` — for `sendOtpSms`. Dev leaves this unset; OTPs still work because they're echoed in the login response.
- `PUBLIC_BASE_URL` — set in prod so `get_media` returns HTTPS URLs even behind a reverse proxy.

## 9. How to test end-to-end

Import `postman/NathMandir-App-Developer.postman_collection.json`. Run the requests in order 1 → 6. The token is auto-saved by request 3, so 4/5/6 work with no manual copying.

To exercise the paid path without going through Razorpay, flip a flag directly:
```sql
UPDATE users SET part_1 = 1 WHERE phone = '1234567890';
```
Then `subscribed_items` will include `gita1`, `sub_items?product=gita1` returns the list, and `get_media?id=<row id>` returns the audio URL.

## 10. Common pitfalls

- **`get_content` vs `sub_items`** — both list Content for a product. `get_content` is the old endpoint that returns rows with `locked: true` when the user doesn't own the module (drives a locked UI). `sub_items` is the new endpoint that refuses (403) when not subscribed. Don't merge them — they exist for different screens.
- **Never trust the module code from the client for authorization.** The code decides which flag to check, not whether the user has access. Access is always `user[MODULES[code].flag] === 1`.
- **`req.mobileUser` is the only trustworthy identity in protected handlers.** Never take a `userId` from the body for anything that mutates data — always use `req.mobileUser.id`. `authenticateMobile` re-verifies the token against `users.token`, so this is the checked identity.
- **Prisma vs raw SQL** — the codebase uses raw `$executeRawUnsafe` in a few spots (`users.token`, `login_user`, `userpayment`) because those columns/tables aren't in the Prisma schema. Keep parameters bound (`?` placeholders) — do NOT concatenate strings. The legacy PHP was SQL-injectable; the Node port isn't and shouldn't regress.
- **`error: "false"` is a string.** Do not "fix" it to a boolean — you'll break the shipped APK.
