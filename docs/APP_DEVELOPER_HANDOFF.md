w# Shreenath Gitanjali — App Developer Handoff

## Why we are changing the app

The current APK has **Razorpay payment inside the app**. Google Play and the
Apple App Store reject apps that sell digital content through a third‑party
gateway. The fix (the "Spotify model"):

- **Payment moves to the website** (`nathmandirnashik.com`), already built.
- The **app no longer sells anything** — it only **reads what the user owns**
  and unlocks the matching module's songs.
- The link between the two is the **mobile number**: the user pays on the
  website with a number, then logs into the app with the **same number** and
  the content is unlocked.

---

## 1. What to REMOVE from the app

1. **The entire Razorpay SDK + checkout code.** No payment screens.
2. Any **"Buy / Subscribe / Pay"** button that starts a payment.
3. Any call to the old `save_payment` payment API from the app.
4. **Do NOT add Google Play Billing or Apple StoreKit either.** The model is
   external (website) purchase. The app must not show a price, a buy button, or
   a link to the website (store "reader app" rules). Locked modules just show a
   **locked state** — the user learns to buy on the website separately.

## 2. What to ADD / CHANGE

The app must **gate each module by an entitlement flag** returned by the
backend, and **refresh those flags** so website purchases appear.

### Module → unlock flag

| Module in app      | Flag field       | Unlocked when |
|--------------------|------------------|---------------|
| Gitanjali Part 1   | `Part_1`         | `= 1`         |
| Gitanjali Part 2   | `Part_2`         | `= 1`         |
| Upasana            | `upasanaPaid`    | `= 1`         |
| Nityaniyam         | `nityaniyamPaid` | `= 1`         |

(`0` = locked, `1` = owned.)

### When to read the flags

- Right after **login** (`verifyOTP` returns the user object).
- On **app open / resume** and on **pull‑to‑refresh**, call **`check_status`**
  so a purchase made on the website unlocks **without reinstalling**.

---

## 3. Backend API the app uses

**Base URL:** `https://<backend-domain>/api/mobile`
**Call style (unchanged from the old API.php):** `POST` form fields, with
`?apicall=<operation>`.
**Auth:** send the JWT from `verifyOTP` as `Authorization: Bearer <token>` on
authenticated calls.

| Operation | Params | Auth | Returns |
|-----------|--------|------|---------|
| `loginuser` | `mobile` | no | sends OTP |
| `verifyOTP` | `otp`, `mobile`, `DID` | no | `{ token, data: <user> }` |
| `check_status` | `mobile` | yes | `{ data: <user> }` — **use to refresh entitlements** |

### The `<user>` object (relevant fields)

```json
{
  "id": 42,
  "name": "Devotee Name",
  "mobile": "9112223334",
  "isPaid": 1,
  "Part_1": 1,
  "Part_2": 0,
  "upasanaPaid": 1,
  "nityaniyamPaid": 0,
  "donation_audio": 0,
  "token": "<jwt>"
}
```

### Gating logic (pseudocode)

```text
user = check_status(mobile)          // or the object from verifyOTP
gita1.locked   = user.Part_1        != 1
gita2.locked   = user.Part_2        != 1
upasana.locked = user.upasanaPaid   != 1
nithya.locked  = user.nityaniyamPaid!= 1
```

If a module is locked → show the locked UI (no buy button, no website link).
If unlocked → play the songs exactly as before.

---

## 4. Songs / content — new mobile endpoints

The songs for each module are managed by the **admin panel** and now served to
the app by **new authenticated `apicall` operations** on the same
`/api/mobile` endpoint. Ownership is enforced **server-side** from the token —
locked modules never leak their audio/lyrics.

| Operation | Params | Returns |
|-----------|--------|---------|
| `home` | — | `{ modules: [{ code, name, price, owned, songCount }] }` — for the home screen |
| `get_content` | `product` (module code) | `{ owned, product, content: [ …songs… ] }` |
| `mark_played` | `id` (content id) | `{ }` — +1 play count (only if owned) |

**Song item shape** (from `get_content`):
```json
{
  "id": 1,
  "title": "Mangalacharan",
  "type": "audio",          // "audio" (has audioUrl) or "text" (lyrics only)
  "duration": 312,           // seconds
  "sortOrder": 1,            // render ascending
  "plays": 1841,
  "locked": false,           // true when the user hasn't purchased this module
  "audioUrl": "https://<host>/uploads/audio/mangalacharan.mp3",  // null when locked
  "lyrics": "…"              // null when locked
}
```

Rules:
- `product` is the module **code**: `gita1` | `gita2` | `upasana` | `nithya`.
- **Owned** → `owned: true`, full `audioUrl` (absolute, ready to stream) + `lyrics`.
- **Not owned** → `owned: false`, items come back with `locked: true` and
  `audioUrl`/`lyrics` = `null`. Show a locked state (no price, no buy button,
  no website link).
- Only **published** songs are returned.
- `audioUrl` is already an **absolute URL** — play it directly. (`/uploads/*`
  is served without auth.)

See `postman/NathMandir-Mobile-API.postman_collection.json` for live payloads
and example responses for every operation.

---

## 5. End‑to‑end flow (for testing)

1. User opens the website (`/subscribe`), picks "Upasana", fills name + mobile
   `9112223334` + email.
2. **Website sends an OTP to `9112223334` and the user verifies it** — this
   confirms they control the number (the number is the identity key). Works the
   same whether the number is brand‑new OR already an existing "Free" app user.
3. User pays via Razorpay. Backend sets `upasanaPaid = 1` for that number
   (on the **existing** account if the number already had one).
4. User opens the app → `loginuser` → `verifyOTP` with `9112223334`.
5. App reads `upasanaPaid = 1` → **Upasana songs unlocked**.
6. If already logged in, `check_status` on resume picks up the unlock.

> Website checkout OTP endpoints (not called by the app): `POST /api/checkout/send-otp`,
> `POST /api/checkout/verify-otp`. The app is unaffected — it still just reads the flags.

**Test account:** mobile `1234567890` always gets OTP `1947` (backend shortcut).

---

## 6. Summary of deliverables to the app developer

- This document.
- **Postman collection:** `postman/NathMandir-Mobile-API.postman_collection.json`
  (import it — every operation has example payloads + responses; `verifyOTP`
  auto-saves the token so authed calls just work).
- Backend base URL (dev: `http://localhost:5000/api/mobile`; production URL TBD).
- The module→flag table above.
- The content endpoints in §4 (`home`, `get_content`, `mark_played`).
- Instruction: **remove all in‑app payment**, gate by flags, fetch songs via
  `get_content`, refresh via `check_status`.
- Note for store review: it's a **reader app** — content is purchased on the
  website; the app must not advertise or link to that purchase.
- Test account: mobile `1234567890`, OTP `1947`.
