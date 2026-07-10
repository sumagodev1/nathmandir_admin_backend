# Shreenath Gitanjali — Admin Console

Standalone admin panel for **Shreenath Gitanjali** (devotional library): users,
access control, content, sales and notifications. This is a **frontend-only**
project — there are **no APIs / backend** anywhere. All data is mock data in
`src/data/adminData.js`, and the login screen is a client-side mock.

Split out from the public temple website ([nathmandirnashik](../nathmandirnashik))
so the two can be developed and deployed independently (e.g. on a separate
subdomain such as `admin.nathmandirnashik.com`).

## Tech Stack

- **React 18** + **Vite 5**
- **Tailwind CSS 3** (shared saffron / maroon / gold design tokens)
- **React Router DOM 6** (code-split, route-guarded)
- **React Icons**
- **jsPDF** (PDF receipts & table exports, dynamically imported)

## Getting Started

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # production build → dist/
npm run preview
```

## Login (mock — no backend)

The console is gated behind a login screen. Authentication is **entirely
client-side**: it checks the entered email/password against a demo credential
and stores a session flag in `localStorage`.

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `admin@gitanjali.app`  |
| Password | `admin123`             |

Change these in `src/constants/site.js` (`DEMO_CREDENTIALS`). To wire a real
backend later, replace the body of `login()` in `src/auth/AuthContext.jsx` with
an API call — the route guard (`RequireAuth`) and the rest of the UI need no
changes.

## Routes

- `/login` — sign-in screen (public)
- `/admin` — dashboard (protected) and all sub-pages: `users`, `users/:id`,
  `access`, `content`, `sales`, `notifications`, `settings`
- `/` and any unknown path → redirect to `/admin` (which bounces to `/login`
  when there's no session)

## Project Structure

```
src/
├── auth/            # AuthContext (mock) + RequireAuth route guard
├── pages/
│   ├── Login.jsx    # login screen
│   └── admin/       # admin layout + all admin screens
├── data/            # adminData.js (mock data)
├── utils/           # cn, tableExport (CSV/PDF), receiptPdf
├── constants/       # site config + demo credentials
├── routes/          # AppRoutes (lazy + guarded)
├── styles/          # global CSS + Tailwind layers
├── App.jsx
└── main.jsx
```

## Deployment

Static SPA. `public/_redirects` (Netlify) and `vercel.json` provide SPA history
fallback. Deploy the `dist/` folder to any static host.
"# nathmandir_admin_backend" 
