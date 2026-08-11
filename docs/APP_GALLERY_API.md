# Gallery API for the mobile app (छायाचित्रे screen)

**For:** the app developer
**Goal:** the gallery screen in the app must show the same photos the admin
manages in the panel — not images bundled inside the APK.

Right now the photos on that screen are hard-coded in the app, so adding a
photo needs a new APK. The website already reads them live. These two API
operations give the app the same live data.

Admin panel: `/admin/gallery` → website: `/events` → **app: the API below.**
An admin adds or removes a photo and the app shows it on the next refresh.
No app update needed.

---

## 1. Endpoint

Same endpoint and same style the app already uses for login and songs:

```
POST {baseUrl}/api/mobile?apicall=<operation>
```

- Params go as normal **form fields** (`application/x-www-form-urlencoded`).
- `GET` with query params also works.
- **No Bearer token needed** for these two operations. The gallery is public
  content (it is already on the website), so the screen works even before
  login and never breaks when a token expires.

| baseUrl | value |
|---------|-------|
| Dev | `http://localhost:5000` |
| Production | `https://api.nathmandir.sumago.ai` |

---

## 2. `gallery` — everything the screen needs, in one call

**Params (all optional)**

| Param | Default | Meaning |
|-------|---------|---------|
| `category` | `all` | `all`, or one of the keys from `categories[]` (today: `maharaj`, `events`) |
| `page` | — | page number, 1-based |
| `limit` | `30` | photos per page, max 200 |

Send **no** `page`/`limit` → you get every photo in one response (best for a
small gallery). Send them → `photos[]` is paged; `albums[]` is never paged.

**Request**

```
POST https://api.nathmandir.sumago.ai/api/mobile?apicall=gallery
Content-Type: application/x-www-form-urlencoded

category=all
```

**Response**

```json
{
  "status": 200,
  "error": "false",
  "message": "Gallery loaded",

  "categories": [
    { "key": "events",  "albumCount": 1 },
    { "key": "maharaj", "albumCount": 1 }
  ],

  "albums": [
    {
      "id": 3,
      "title": "demoo",
      "category": "maharaj",
      "date": "2026-08-10",
      "cover": "https://api.nathmandir.sumago.ai/uploads/image/1786358735697-659042-screenshot-1163.png",
      "photoCount": 2,
      "photos": [
        {
          "key": "p3",
          "id": 3,
          "url": "https://api.nathmandir.sumago.ai/uploads/image/1786358886461-683277-15.png",
          "caption": "test",
          "sortOrder": 1,
          "isCover": false
        }
      ]
    }
  ],

  "photos": [
    {
      "key": "p3",
      "id": 3,
      "url": "https://api.nathmandir.sumago.ai/uploads/image/1786358886461-683277-15.png",
      "caption": "test",
      "sortOrder": 1,
      "isCover": false,
      "albumId": 3,
      "albumTitle": "demoo",
      "category": "maharaj"
    }
  ],

  "total": 3,
  "page": 1,
  "pages": 1,
  "limit": 3
}
```

### How to use each part on the screen in the screenshot

| Screen part | Use this |
|-------------|----------|
| Top carousel | `photos` — take the first 10–15 |
| "मंदिर छायाचित्रे" grid | `photos` — the whole list |
| Category tabs / filter (if you add one) | `categories`, then re-call with `category=<key>` |
| Album list screen (if you add one) | `albums` |

---

## 3. `gallery_album` — one album

For an album-detail screen. Skip it if you only build the flat grid.

**Params**

| Param | Required | Meaning |
|-------|----------|---------|
| `id` | yes | album id, from `albums[].id` or `photos[].albumId` |

**Request**

```
POST https://api.nathmandir.sumago.ai/api/mobile?apicall=gallery_album
Content-Type: application/x-www-form-urlencoded

id=3
```

**Response**

```json
{
  "status": 200,
  "error": "false",
  "message": "Album loaded",
  "album": {
    "id": 3,
    "title": "demoo",
    "category": "maharaj",
    "date": "2026-08-10",
    "cover": "https://api.nathmandir.sumago.ai/uploads/image/…png",
    "photoCount": 2,
    "photos": [ { "key": "p3", "id": 3, "url": "…", "caption": "test", "sortOrder": 1, "isCover": false } ]
  }
}
```

---

## 4. Field reference

**Album**

| Field | Type | Notes |
|-------|------|-------|
| `id` | int | |
| `title` | string | may be Marathi |
| `category` | string | `maharaj` or `events` today — **do not hard-code**, read `categories[]` |
| `date` | string \| null | `"YYYY-MM-DD"` |
| `cover` | string \| null | full URL |
| `photoCount` | int | number of photos in the album |
| `photos` | array | sorted by `sortOrder` ascending |

**Photo** (inside `albums[].photos` and inside `photos[]`)

| Field | Type | Notes |
|-------|------|-------|
| `key` | string | **unique** — use this as the list/widget key |
| `id` | int \| null | photo id; `null` when the item is an album cover stand-in |
| `url` | string | **full absolute URL** — load it directly |
| `caption` | string | `""` when the admin left it empty |
| `sortOrder` | int | render ascending |
| `isCover` | bool | see the note below |
| `albumId` | int | only in the flat `photos[]` |
| `albumTitle` | string | only in the flat `photos[]` |
| `category` | string | only in the flat `photos[]` |

---

## 5. Things to get right (please read)

1. **`url` is already a full URL.** Do **not** prepend the base URL again.
   `/uploads/*` is served publicly with no auth, so the image loads directly.
2. **Use `key`, not `id`, as the list key.** When an admin creates an album and
   sets only a cover (no photos added yet), the API returns that cover as one
   entry with `id: null` and `isCover: true`, so the new album is still visible
   in the app instead of missing. `key` is always unique (`"p3"` / `"c4"`).
3. **`caption` is often `""`.** Only draw the caption when it is non-empty.
4. **Do not hard-code the categories.** Read `categories[]`. An admin can add a
   new category later and the tabs should follow.
5. **Unpublished albums never arrive.** When an admin unpublishes an album it
   disappears from this response — the app does not need to filter anything.
6. **Empty gallery is normal.** `albums: []` and `photos: []` with
   `status: 200`. Show an empty state, not an error.
7. **Response envelope is the same as every other call:** check
   `error === "false"` (it is the *string* `"false"`, kept from the old PHP API)
   or check the HTTP status.

## 6. Errors

| Case | HTTP | Body |
|------|------|------|
| `gallery_album` with no `id` / non-numeric `id` | 400 | `{"status":400,"error":"true","message":"Check parameter"}` |
| `gallery_album` with an id that is missing or unpublished | 404 | `{"status":404,"error":"true","message":"Album not found"}` |
| Wrong `apicall` spelling | 404 | `{"status":404,"error":"true","message":"Invalid Operation Called"}` |

## 7. Try it before coding

Postman: import `postman/NathMandir-Mobile-API.postman_collection.json` →
folder **Gallery (no token)**. Both calls have saved example responses.

Or from a terminal:

```bash
curl "https://api.nathmandir.sumago.ai/api/mobile?apicall=gallery"
curl "https://api.nathmandir.sumago.ai/api/mobile?apicall=gallery&category=maharaj"
curl "https://api.nathmandir.sumago.ai/api/mobile?apicall=gallery_album&id=3"
```
