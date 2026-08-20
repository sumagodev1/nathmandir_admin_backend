# Gallery — mobile APK integration (छायाचित्रे)

**For:** the app developer
**Date:** 20 August 2026

Three screens, **two API calls**, two taps.

```
SCREEN 1   छायाचित्रे                    apicall=gallery
  [ महाराजांची छायाचित्रे ]
  [ कार्यक्रमाचे छायाचित्रे ]
        ↓ tap a category
SCREEN 2   कार्यक्रमाचे छायाचित्रे        apicall=gallery_category
  ┌ माधवनाथ महाराज उत्सव २०१५
  │ [ cover image ]
  └ अधिक छायाचित्रे
  ┌ माधवनाथ मंदिर रक्त दान शिबीर
  │ [ cover image ]
  └ अधिक छायाचित्रे
        ↓ tap a card
SCREEN 3   photo grid                    no call — already in hand
```

**Screen 3 needs no request.** Every card on screen 2 already carries its own
photos.

Everything is admin-managed. An admin adds a category or an album and it
appears on the next refresh — **no new APK**.

> The APK already in the store keeps working. Everything here is either a new
> operation or a new key added alongside existing ones. Nothing was renamed or
> removed.

---

## Endpoint

```
POST {baseUrl}/api/mobile?apicall=<operation>
```

- Params as normal form fields (`application/x-www-form-urlencoded`).
  `GET` with query params also works.
- **No Bearer token.** The gallery is public, so it works before login and
  never breaks when a token expires.
- Base URL: `https://api.nathmandir.sumago.ai`

---

## Screen 1 — the category buttons

**Request**

```
POST /api/mobile?apicall=gallery
```

No parameters.

**Response — the part you need**

```json
{
  "status": 200, "error": "false", "message": "Gallery loaded",

  "categoryTree": [
    { "key": "maharaj", "name": "महाराजांची छायाचित्रे", "parent": null,
      "sortOrder": 0, "albumCount": 1, "children": [] },

    { "key": "events",  "name": "कार्यक्रमाचे छायाचित्रे", "parent": null,
      "sortOrder": 1, "albumCount": 2,
      "children": [ { "key": "test", "name": "test", "parent": "events",
                      "sortOrder": 1, "albumCount": 1 } ] }
  ]
}
```

**Draw one button per entry in `categoryTree`, using `name`.**

**Ignore `children`.** Subcategories are only a way for the admin to group
albums in the panel — they never get a screen of their own. Their albums appear
inside the parent on screen 2.

| Field | Use |
|---|---|
| `key` | the id to send to screen 2. Never changes, even if renamed. |
| `name` | the Marathi label to print |
| `sortOrder` | button order. Already sorted for you. |
| `albumCount` | albums in the whole branch — cards you'll see on screen 2 |
| `children` | **ignore** |

The response also has `categories`, `albums` and `photos`. The old APK uses
those; the new flow does not need them.

A category with no albums anywhere is left out, so a button never opens an
empty screen.

---

## Screen 2 — the cards

**Request**

```
POST /api/mobile?apicall=gallery_category
```

| Param | Required | Value |
|---|---|---|
| `category` | **yes** | a `key` from `categoryTree` |

**Response**

```json
{
  "status": 200, "error": "false", "message": "Category loaded",
  "category": "events",
  "albumCount": 2,
  "photoCount": 2,

  "albums": [
    {
      "id": 14,
      "title": "new test",
      "category": "test",
      "date": "2026-08-19",
      "cover": "https://api.nathmandir.sumago.ai/uploads/image/…-500.png",
      "photoCount": 1,
      "photos": [
        { "key": "c14", "id": null, "url": "https://…/…-500.png",
          "caption": "", "sortOrder": 0, "isCover": true }
      ]
    },
    {
      "id": 9,
      "title": "madhav nath 2015",
      "category": "events",
      "date": "2026-08-19",
      "cover": "https://…/…-ashokabshool.jpg",
      "photoCount": 1,
      "photos": [
        { "key": "p9", "id": 9, "url": "https://…/…-educators.jpeg",
          "caption": "demo", "sortOrder": 1, "isCover": false }
      ]
    }
  ],

  "subcategories": [ { "key": "test", "name": "test", "sortOrder": 1 } ],
  "photos": [ … ],
  "startIndex": -1,
  "total": 2, "page": 1, "pages": 1, "limit": 2
}
```

**Draw one card per entry in `albums`:**

| Card part | Field |
|---|---|
| Title | `title` |
| Image | `cover` |
| "अधिक छायाचित्रे" | opens `photos` — see screen 3 |

Albums come **newest first**, the same order as the panel and the website.

### Fields to ignore on this screen

- **`subcategories`** — the website uses it for a second row of chips. The app
  does not. Ignore it.
- **`photos`** (top level) — the same pictures as one flat run across the whole
  category. Only useful if you later want a viewer that swipes past the end of
  one album into the next. Not needed for these three screens.
- **`startIndex`**, `page`, `pages`, `limit` — see *Optional extras*.

### Note on `category` inside an album

An album's `category` may be a **subcategory key** (`"test"` above) while you
asked for `"events"`. That is correct — the subcategory's albums are flattened
into the parent's list. Do not filter on it.

---

## Screen 3 — the photo grid

**No request.** Use the `photos` array of the card that was tapped.

```json
"photos": [
  { "key": "p9", "id": 9, "url": "https://…/…-educators.jpeg",
    "caption": "demo", "sortOrder": 1, "isCover": false }
]
```

Show `url` in the grid. `caption` may be empty.

### An album with no photos uploaded yet

Its cover is served as the single picture, so tapping a card **never opens an
empty grid**:

```json
{ "key": "c14", "id": null, "url": "…the cover…", "isCover": true }
```

- `isCover: true` — this is the cover standing in, not a real photo
- `id: null` — there is no photo row behind it

`photoCount` counts it, so the card and the grid always agree.

`key` is unique across the whole response — safe as a list key.

---

## Optional extras

You do not need these for the three screens above.

**Paging** — `page` (default 1) and `limit` (default 60, max 300) apply to the
top-level `photos` array only. `albums` is never paged.

**Opening a full-screen viewer on one photo** — send `photoId` and read
`startIndex`:

```
apicall=gallery_category&category=events&photoId=9
→ { "startIndex": 1, "photoCount": 2, "photos": [ … ] }
```

Open the pager at `photos[startIndex]`. It is `-1` when no `photoId` was sent
or that photo is not in this category — treat `-1` as 0. It indexes the **full**
list, so do not send `page`/`limit` with it.

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
in this API.

---

## Things worth knowing

**Image URLs are absolute.** `url` and `cover` are full `https://…` links.
Drop them straight into an image widget — nothing to prepend.

**`key` is stable, `name` is not.** An admin can rename a category at any time;
its key never changes. Cache by `key`, display `name`, and never send `name`
back to the server.

**Unpublished albums never appear.**

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

Every JSON block above came from a real response, not from a specification.
Any question about a field, ask.
