# Campus ReFind

A self-contained, full-stack campus lost-and-found portal. It supports student and administrator roles, lost/found reports, image uploads, weighted match suggestions, ownership claims, verification decisions, notifications, and an administrative dashboard.

## Run locally

Campus ReFind now uses **Supabase Postgres** for app data and **Supabase Storage** for report images. **Node.js 22 through 25** is supported.

```powershell
cd "C:\Users\shrey\OneDrive\Documents\ChatGPT\New project\campus-refind"
npm install
npm start
```

Open [http://localhost:3333](http://localhost:3333).

Before you start the server, create a Supabase project and copy the values from `.env.example` into your own `.env` file or shell environment:

- `DATABASE_URL`: use the **Supabase session pooler** connection string
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_STORAGE_BUCKET` (optional; defaults to `campus-refind-images`)
- `CAMPUS_REFIND_ADMIN_EMAILS` (comma-separated emails that should automatically become admins)

On first boot, the app automatically creates its database tables and the Supabase storage bucket if they do not already exist.

## Deploy on Render

This repository already includes a root-level `render.yaml` configured for **Render Free + Supabase**:

- `plan: free`
- `buildCommand: npm install`
- `startCommand: npm start`
- `healthCheckPath: /api/health`
- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `CAMPUS_REFIND_ADMIN_EMAILS` as dashboard-provided environment variables

To deploy:

1. Create a Supabase project.
2. Copy the **session pooler** Postgres connection string into `DATABASE_URL`.
3. Copy `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the same project.
4. Set `CAMPUS_REFIND_ADMIN_EMAILS` to the email address you want to use as administrator.
5. Push this repository to GitHub.
6. In Render, create a new **Blueprint** from that repository so it reads the included `render.yaml`.
7. Fill in the missing environment variables when Render asks and deploy.
8. Register with the email from `CAMPUS_REFIND_ADMIN_EMAILS`; that account will be promoted automatically.

As of **August 26, 2026**, Render free web services can still spin down after inactivity, but your reports, users, claims, notifications, and images stay safe because they are stored in Supabase instead of Render's local filesystem.

## First administrator

For Render Free, the easiest admin bootstrap is to set `CAMPUS_REFIND_ADMIN_EMAILS` before users register. Any matching email address is promoted automatically when that user signs in.

You can still grant admin access manually from any machine that has the same environment variables:

```powershell
npm run make-admin -- your-email@example.com
```

The account can then review claims in the **Admin** workspace. If this project still contains legacy starter records, remove only those exact records with:

```powershell
npm run remove-demo-data
```

## Included workflows

- Students can register, sign in, publish lost/found reports, add photos, browse/filter reports, view automatic match scores, submit ownership claims, and follow notifications/claim status.
- Matching weighs category (30), location (25), color (15), brand (15), and report-date proximity (15) for a transparent 100-point score.
- Administrators have a protected workspace for reviewing claims, approving/rejecting verification requests, arranging Student Affairs pickup, marking completed handovers as returned, and monitoring users/report hotspots.
- Passwords are stored with salted `scrypt` hashes; sessions are persisted in Postgres; session cookies are `HttpOnly` and `SameSite=Lax`.

## Project structure

```text
campus-refind/
├── public/       # Responsive single-page interface
├── db.mjs        # Postgres helpers, schema creation, and auth utilities
├── matching.mjs  # Transparent weighted matching algorithm
├── storage.mjs   # Supabase Storage uploads and public URLs
└── server.mjs    # API, auth, uploads, matching, and static server
```
