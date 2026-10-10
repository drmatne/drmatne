# Matne Advance Dental Clinic — website & admin panel

Public website plus a password-protected admin panel for Matne Advance Dental Clinic & Implant Centre, Jalna.

- **Website** (`/`): hero, offers carousel, treatments, facilities, doctors, gallery, appointment form, map and WhatsApp links.
- **Admin** (`/admin`): edit clinic details, offers (with poster images), gallery, doctors, treatments, and manage appointment requests (status, notes, CSV export).

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start          # or: npm run dev  (auto-restarts on changes)
```

Open http://localhost:3000 and http://localhost:3000/admin.

On first start, `data/db.json` is created from `seed.json` with the login **admin / admin123**. Change it right away on the *Account* tab of the admin panel.

## Configuration

| Variable         | Default     | Purpose                                                   |
| ---------------- | ----------- | --------------------------------------------------------- |
| `PORT`           | `3000`      | HTTP port                                                 |
| `DATA_DIR`       | `./data`    | Where `db.json` is stored                                 |
| `UPLOAD_DIR`     | `./uploads` | Where uploaded images are stored                          |
| `ADMIN_USER`     | `admin`     | Initial username (only used when `db.json` is first made) |
| `ADMIN_PASSWORD` | `admin123`  | Initial password (only used when `db.json` is first made) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | (unset) | Upstash Redis; set automatically when connected on Vercel |
| `BLOB_READ_WRITE_TOKEN` | (unset) | Vercel Blob; set automatically when connected on Vercel |

## Data & backups

Locally, all content and appointments live in `data/db.json`, and uploaded images live in `uploads/`. Back up **both folders**. To reset to the original content, stop the server and delete `data/db.json`. Remember that this also resets the login. On Vercel, the same data lives in Upstash Redis and Vercel Blob instead (see below); the admin panel's CSV export is the easy way to back up appointments.

## Deploying to Vercel

Vercel's disk is temporary, so in production the app stores content and appointments in **Upstash Redis** and images in **Vercel Blob**. It switches to them automatically when their environment variables are present.

1. In Vercel, **Add New → Project** and import this GitHub repo. Keep the defaults (`vercel.json` already sets everything).
2. In the project's **Storage** tab, create and connect:
   - an **Upstash for Redis** database (Free plan is plenty), and
   - a **Blob** store with **public** access.
3. Under **Settings → Environment Variables**, add `ADMIN_PASSWORD` with a strong password. It sets the first login, so the site is never live with `admin123`.
4. **Redeploy** so the new variables take effect.

Optional: copy your existing local content and photos to the live site, which also keeps your current login:

```bash
npx vercel link
npx vercel env pull .env.local
node --env-file=.env.local scripts/migrate-to-cloud.js
```

Every push to `main` then redeploys automatically.

### Other hosts

Any host that runs a long-lived Node process with a persistent disk also works (a VPS, Render or Railway with a volume). Run `npm start`, point `DATA_DIR` and `UPLOAD_DIR` at the persistent disk, and put it behind HTTPS.
