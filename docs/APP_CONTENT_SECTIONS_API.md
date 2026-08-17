# Shreenath Gitanjali — Content & Sections API (for the App Developer)

**Version 1.0 · 17 August 2026**

This document explains the two API calls the app needs to build the menu
screens: **Module → Session → Sub Part → Day → Songs**.

Everything here is **additive**. The calls the current APK already makes still
return exactly what they returned before. The new fields are extra keys in the
same JSON, so an old build simply ignores them.

---

## 1. The idea in one picture

Content is organised as a **tree**. Each level is just a *section* with a name:

```
Gitanjali Part 2                (module / "Part")
 ├── सकाळ (Morning)              section
 │    └── varachi pade sakal    section
 │         └── (songs)
 └── संध्याकाळ (Evening)          section
      ├── varachi pade          section
      │    └── सोमवार (Monday)   section
      │         └── (songs)
      └── varachi pade 2        section
           └── सोमवार (Monday)   section
                └── (songs)
```

**Important:** do not hard-code the level names. The admin can rename them, add
levels, or use a different shape for another module. The app should draw
whatever the API returns.

A song can also sit **directly in the module**, with no section at all. All the
older songs are like this — that is normal, not an error.

---

## 2. Basics

| Item | Value |
|---|---|
| Base URL (local) | `http://localhost:5000/api/mobile/` |
| Base URL (live) | `https://<your-domain>/api/mobile/` |
| Method | `GET` or `POST` (both work) |
| Which call to run | the `apicall` parameter |
| Login required | Yes — send the app token |
| Header | `Authorization: Bearer <token>` |

The token is the one you already get from `verifyOTP`. Nothing about login changes.

**Every response has the same wrapper:**

```json
{ "status": 200, "error": "false", "message": "Sections loaded", "...": "data" }
```

- `error` is the **string** `"false"` when it worked, `"true"` when it did not.
- `status` repeats the HTTP code.

---

## 3. `get_sections` — the menu of one module

Use this to draw the menu screens.

```
GET /api/mobile/?apicall=get_sections&code=gita2
Authorization: Bearer <token>
```

| Parameter | Required | Meaning |
|---|---|---|
| `code` | Yes | module code — `gita1`, `gita2`, `upasana`, `nithya`, … |

### Response

```json
{
  "status": 200,
  "error": "false",
  "message": "Sections loaded",
  "sections": [
    { "id": 66,  "parentId": null, "name": "सकाळ (Morning)",     "kind": "session",  "sortOrder": 1, "childCount": 1, "itemCount": 0 },
    { "id": 67,  "parentId": null, "name": "संध्याकाळ (Evening)", "kind": "session",  "sortOrder": 2, "childCount": 2, "itemCount": 0 },
    { "id": 312, "parentId": 66,   "name": "varachi pade sakal", "kind": "sub part", "sortOrder": 1, "childCount": 0, "itemCount": 1 },
    { "id": 218, "parentId": 67,   "name": "varachi pade",       "kind": "sub part", "sortOrder": 1, "childCount": 1, "itemCount": 0 },
    { "id": 219, "parentId": 218,  "name": "सोमवार (Monday)",    "kind": "day",      "sortOrder": 1, "childCount": 0, "itemCount": 1 }
  ]
}
```

### What each field means

| Field | Meaning |
|---|---|
| `id` | The section's own number. Use it to match songs (see part 4). |
| `parentId` | The section this one sits inside. **`null` = top level.** |
| `name` | Show this text on the button. Already in the right language. |
| `kind` | A free label the admin typed — `session`, `sub part`, `day`. **Display only. Never write `if (kind == "day")` logic.** |
| `sortOrder` | Show them in this order (small number first). |
| `childCount` | How many sections are inside this one. `0` = nothing deeper. |
| `itemCount` | How many songs sit directly in this section. |

### How to use it

The list is **flat**. Build the tree yourself:

1. **First screen** — show every section where `parentId == null`.
2. **On tap** — show every section where `parentId == <the tapped id>`.
3. **When `childCount == 0`** — there is nothing deeper. Show the songs instead
   (part 4).
4. `itemCount == 0` **and** `childCount == 0` means the section is empty. Grey
   it out or hide it.

This works for any depth. A module with two levels and a module with five both
work with the same code.

### Errors

| When | Response |
|---|---|
| No `code` sent | `{ "status": 400, "error": "true", "message": "code is required" }` |
| Unknown module | `{ "status": 404, "error": "true", "message": "Module not found" }` |
| No / bad token | `{ "status": 401, "error": "true", "message": "Not authenticated. Please log in." }` |

---

## 4. `get_content` — the songs of one module

This is the **existing** call. It works exactly as before; two fields are new.

```
GET /api/mobile/?apicall=get_content&product=gita2
Authorization: Bearer <token>
```

> Note the parameter is `product` here, not `code`. That is how the old API was
> built and it has not been changed.

### Response

```json
{
  "status": 200,
  "error": "false",
  "message": "Content loaded",
  "owned": true,
  "product": { "code": "gita2", "name": "Gitanjali Part 2", "price": 251 },
  "content": [
    {
      "id": 286,
      "title": "som1",
      "type": "audio",
      "duration": 0,
      "sortOrder": 37,
      "plays": 0,
      "locked": false,
      "audioUrl": "http://localhost:5000/uploads/audio/song.mp3",
      "lyrics": "…",
      "schedule": { "morning": [], "afternoon": [] },
      "sectionId": 219,
      "sectionPath": [
        { "name": "संध्याकाळ (Evening)", "kind": "session" },
        { "name": "varachi pade",       "kind": "sub part" },
        { "name": "सोमवार (Monday)",     "kind": "day" }
      ]
    },
    {
      "id": 3,
      "title": "जयजयकार (Intro)",
      "type": "audio",
      "sectionId": null,
      "sectionPath": []
    }
  ]
}
```

### The two new fields

| Field | Meaning |
|---|---|
| `sectionId` | The section this song belongs to. **`null` = it sits directly in the module** (all the older songs). |
| `sectionPath` | The full trail from the top, for showing a heading like `संध्याकाळ (Evening) › varachi pade › सोमवार (Monday)`. Empty list when `sectionId` is `null`. |

### The fields that were already there

| Field | Meaning |
|---|---|
| `id` | Song id |
| `title` | Song name |
| `type` | `audio` or `text` |
| `duration` | Seconds (`0` if not measured) |
| `sortOrder` | Play order inside the module |
| `plays` | Play count |
| `locked` | `true` when the user has not bought this module |
| `audioUrl` | Full URL to the MP3 — **`null` when `locked` is `true`** |
| `lyrics` | Lyrics text (may be empty) |
| `schedule` | Old Mon–Sun feature, unrelated to sections. Safe to ignore. |

### How to show a day's songs

1. Call `get_content` **once** for the module and keep the list.
2. When the user taps a section, show every song whose
   `sectionId == <that section id>`.
3. Sort by `sortOrder`.

You do **not** need a separate call per day.

---

## 5. Putting it together — the screens

| Screen | What to call | What to show |
|---|---|---|
| Module list | `home` (existing) | Gitanjali Part 1, Part 2, … |
| Session list | `get_sections` | sections with `parentId == null` |
| Sub part list | already loaded | sections with `parentId == <session id>` |
| Day list | already loaded | sections with `parentId == <sub part id>` |
| Songs | `get_content` | songs with `sectionId == <day id>` |

Two network calls per module in total: one for the menu, one for the songs.

---

## 6. Rules the backend enforces

Worth knowing so the app can show sensible messages:

- **A day holds one song.** Once a day has a song, the admin panel will not add
  a second one to it.
- **A section can be renamed or deleted** by the admin at any time. Do not cache
  section ids for days. Re-fetch `get_sections` when the user opens a module.
- **A song with no section is normal.** Show those in the module's main list.
- **Names are free text** and may be in Marathi, English, or both.

---

## 7. Quick test

Before writing app code, check the API by hand:

```bash
# 1. Log in (test number, fixed OTP 1947)
curl "http://localhost:5000/api/mobile/?apicall=loginuser&mobile=1234567890"
curl "http://localhost:5000/api/mobile/?apicall=verifyOTP&mobile=1234567890&otp=1947"
# → copy the "token"

# 2. The menu
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/mobile/?apicall=get_sections&code=gita2"

# 3. The songs
curl -H "Authorization: Bearer <token>" \
  "http://localhost:5000/api/mobile/?apicall=get_content&product=gita2"
```

If the test number is not registered yet, create it once:

```bash
curl "http://localhost:5000/api/mobile/?apicall=register&name=Test&email=test@example.com&mobile=1234567890"
```

---

## 8. Appendix — where the content comes from

The admin panel manages this tree. These endpoints need an **admin** token and
are **not** for the app; they are listed only so you know the source of truth.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/content-nodes?product=&parent=` | sections one level at a time |
| GET | `/api/content-nodes?product=&all=1` | the whole tree of a module |
| POST | `/api/content-nodes` | add a section |
| PATCH | `/api/content-nodes/:id` | rename / reorder a section |
| DELETE | `/api/content-nodes/:id` | remove an empty section |
| GET | `/api/content?product=&node=` | songs, filtered |
| POST | `/api/content` | add a song |
| PATCH | `/api/content/:id` | edit a song |
| DELETE | `/api/content/:id` | remove a song |
