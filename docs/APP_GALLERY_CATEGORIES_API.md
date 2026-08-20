# Gallery — mobile APK integration (छायाचित्रे)

**For:** the app developer
**Date:** 20 August 2026
**Base URL:** `https://api.nathmandir.sumago.ai`

Three screens. **Two API calls.** Two taps.

Everything is admin-managed. An admin adds a category, an album or a photo in
the panel and it appears on the next refresh — **no new APK**.

> The APK already in the store keeps working. Everything here is either a new
> operation or a new key added next to the existing ones. Nothing was renamed
> or removed.

---

## The flow at a glance

```
SCREEN 1  छायाचित्रे                 apicall=gallery
   ┌───────────────────────────┐
   │      [ carousel ]         │   ← optional, use `photos`
   └───────────────────────────┘
     ( महाराजांची छायाचित्रे )        one button per categoryTree entry
     ( कार्यक्रमाचे छायाचित्रे )
                ↓ tap a category
SCREEN 2  कार्यक्रमाचे छायाचित्रे     apicall=gallery_category
     ram utsav                       ← album.title
   ┌───────────────────────────┐
   │      [ cover image ]      │     ← album.cover
   └───────────────────────────┘
   │    अधिक छायाचित्रे          │     ← your own label, opens screen 3
     nath utsav
   ┌───────────────────────────┐
   │      [ cover image ]      │
   └───────────────────────────┘
   │    अधिक छायाचित्रे          │
                ↓ tap a card
SCREEN 3  ram utsav                  NO CALL — already downloaded
   [img] [img]
   [img] [img]
```

**Screen 3 costs nothing.** Every card on screen 2 already carries its own
photos in the same response.

---

## Endpoint

```
POST {baseUrl}/api/mobile?apicall=<operation>
```

- Params as normal form fields (`application/x-www-form-urlencoded`).
  `GET` with query params works too.
- **No Bearer token.** The gallery is public — the screen works before login
  and never breaks when a token expires.

---

## Screen 1 — the category buttons

### Request

```
POST /api/mobile?apicall=gallery
```

No parameters.

### Response (live, trimmed to what you need)

```json
{
  "status": 200,
  "error": "false",
  "message": "Gallery loaded",

  "categoryTree": [
    {
      "key": "events",
      "name": "कार्यक्रमाचे छायाचित्रे",
      "parent": null,
      "sortOrder": 1,
      "albumCount": 2,
      "children": []
    }
  ],

  "categories": [ … ], "albums": [ … ], "photos": [ … ]
}
```

### How to show it

**One button per entry in `categoryTree`, in the order given, printing `name`.**

| Field | What to do with it |
|---|---|
| `name` | print this on the button |
| `key` | keep it — you send it to screen 2 |
| `sortOrder` | already sorted; just keep the order |
| `albumCount` | how many cards screen 2 will have. Optional to show. |
| `children` | **ignore** — see below |
| `parent` | **ignore** |

**The top carousel** on screen 1 can use the top-level `photos` array from this
same response (every published photo, newest album first). That is what it is
there for. If you do not want a carousel, ignore it.

**Do not build a subcategory screen.** `children` exists because the website
uses it. In the app, a subcategory is only a way for the admin to group albums
in the panel — its albums already appear inside the parent on screen 2. If you
render `children` as buttons, devotees will see the same albums twice.

A category with no albums anywhere is left out of `categoryTree`, so a button
never opens an empty screen.

---

## Screen 2 — the album cards

### Request

```
POST /api/mobile?apicall=gallery_category
category=events
```

| Param | Required | Value |
|---|---|---|
| `category` | **yes** | a `key` from `categoryTree` |

### Response (live)

```json
{
  "status": 200,
  "error": "false",
  "message": "Category loaded",
  "category": "events",
  "albumCount": 2,
  "photoCount": 6,

  "albums": [
    {
      "id": 7,
      "title": "ram utsav",
      "category": "events",
      "date": "2026-08-20",
      "cover": "https://api.nathmandir.sumago.ai/uploads/image/1787203181552-288078-slider-3.jpg",
      "photoCount": 3,
      "photos": [
        { "key": "p7", "id": 7,
          "url": "https://api.nathmandir.sumago.ai/uploads/image/1787203191989-122794-sapkal.png",
          "caption": "1", "sortOrder": 1, "isCover": false },
        { "key": "p8", "id": 8,
          "url": "https://api.nathmandir.sumago.ai/uploads/image/1787203200521-44398-3.png",
          "caption": "", "sortOrder": 2, "isCover": false }
      ]
    },
    {
      "id": 6,
      "title": "nath utsav",
      "cover": "https://api.nathmandir.sumago.ai/uploads/image/1787203106204-766413-wp91611f77-05.jpg",
      "photoCount": 3,
      "photos": [ … ]
    }
  ],

  "subcategories": [],
  "photos": [ … ],
  "startIndex": -1,
  "total": 6, "page": 1, "pages": 1, "limit": 6
}
```

### How to show it

**One card per entry in `albums`, in the order given.**

```
   album.title                    ← heading above the image
 ┌─────────────────────────────┐
 │   album.cover               │  ← full-width image
 └─────────────────────────────┘
 │   अधिक छायाचित्रे             │  ← your own text, not from the API
```

| Card part | Field |
|---|---|
| Title above the image | `title` |
| Image | `cover` — already a full `https://` URL |
| "अधिक छायाचित्रे" bar | your own label. Tapping it (or the card) opens screen 3. |
| Photo count, if you want it | `photoCount` |

Albums come **newest first**, the same order as the panel and the website.
Keep that order.

### Ignore these on this screen

| Field | Why |
|---|---|
| `subcategories` | the website uses it for a second row of chips; the app does not |
| `photos` (top level) | the same pictures flattened across the category — only for the optional viewer below |
| `startIndex`, `page`, `pages`, `limit` | see *Optional extras* |

### One thing that looks odd but is correct

An album's own `category` may be a **subcategory key** while you asked for the
parent. That is the flattening working. **Never filter `albums` yourself** —
show exactly what came back.

---

## Screen 3 — the photo grid

### Request

**None.** Use `photos` from the card the user tapped.

```json
"photos": [
  { "key": "p7", "id": 7, "url": "https://…/…-sapkal.png",
    "caption": "1", "sortOrder": 1, "isCover": false },
  { "key": "p8", "id": 8, "url": "https://…/…-3.png",
    "caption": "", "sortOrder": 2, "isCover": false }
]
```

### How to show it

- Grid of `url`, in the order given (already sorted by `sortOrder`).
- Title bar: the album's `title`.
- `caption` is often empty — do not reserve space for it unconditionally.
- `key` is unique across the whole response. **Use it as the list key**, not
  `id` (see next point).

### An album with no photos uploaded yet

Its cover is served as the single picture, so a card **never opens an empty
grid**:

```json
{ "key": "c14", "id": null, "url": "…the cover…",
  "caption": "", "sortOrder": 0, "isCover": true }
```

- `isCover: true` — the cover standing in, not a real photo
- `id: null` — no photo row behind it, so do not key a list on `id`

`photoCount` counts it, so the card and the grid always agree.

---

## Optional extras

Not needed for the three screens above.

**Full-screen viewer opening on the tapped photo.** Send `photoId`, read
`startIndex`, open your pager at `photos[startIndex]`:

```
apicall=gallery_category&category=events&photoId=8
→ { "startIndex": 1, "photoCount": 6, "photos": [ … ] }
```

`-1` means the photo was not found — treat it as 0. It indexes the **full**
list, so do not send `page`/`limit` with it. Use the top-level `photos` for
this, not the album's — it lets the user swipe past one album into the next.

**Paging** — `page` (default 1), `limit` (default 60, max 300). Applies to the
top-level `photos` only. `albums` is never paged.

**`category=all`** returns every published album across all categories.

---

## Errors

```json
{ "status": 404, "error": "true", "message": "Category not found" }
{ "status": 400, "error": "true", "message": "Check parameter" }
```

| Status | Cause |
|---|---|
| 400 | `category` missing or blank |
| 404 | no such category, or it holds no published albums |

`error` is the **string** `"true"` / `"false"`, matching every other operation
in this API. Check `status`, not the type of `error`.

---

## Rules worth remembering

**Image URLs are absolute.** `url` and `cover` are full `https://…` links.
Drop them straight into an image widget — nothing to prepend, no base URL to
join.

**`key` is stable, `name` is not.** An admin can rename a category or an album
at any time; the `key` never changes. Cache by `key`, display `name`, and never
send `name` back to the server.

**Unpublished albums never appear.** You do not need to filter anything.

**Two calls per visit is enough.** Call `gallery` once when the screen opens,
and `gallery_category` once per category the user taps. Cache both — nothing
changes between taps.

---

## Quick test

```bash
BASE=https://api.nathmandir.sumago.ai

# Screen 1 — the buttons
curl -s "$BASE/api/mobile?apicall=gallery" \
  | jq '[.categoryTree[] | {key, name, albumCount}]'

# Screen 2 — the cards
curl -s "$BASE/api/mobile?apicall=gallery_category&category=events" \
  | jq '[.albums[] | {id, title, cover, photoCount}]'

# Screen 3 — one card's photos
curl -s "$BASE/api/mobile?apicall=gallery_category&category=events" \
  | jq '.albums[0].photos'
```

Every JSON block in this document is a **real response from the live server**,
not a specification. Any question about a field, ask.
