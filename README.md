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

## Data & backups

All content and appointments live in `data/db.json`, and uploaded images live in `uploads/`. Back up **both folders**. To reset to the original content, stop the server and delete `data/db.json`. Remember that this also resets the login.

## Deploying

Any host that runs a long-lived Node process with a persistent disk works (a VPS, Render or Railway with a volume, etc.). Point `DATA_DIR` and `UPLOAD_DIR` at the persistent disk. Serverless platforms with ephemeral filesystems (e.g. Vercel, Netlify Functions) are **not** suitable.

Put it behind HTTPS (e.g. nginx or Caddy as a reverse proxy). The login cookie is marked `secure` automatically when the request arrives over HTTPS. Admin sessions are held in memory, so restarting the server logs the admin out.
