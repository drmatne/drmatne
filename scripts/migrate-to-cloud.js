'use strict';

// One-time copy of the local site (data/db.json + uploads/) to Upstash Redis and Vercel Blob.
// Usage:  vercel env pull .env.local  &&  node --env-file=.env.local scripts/migrate-to-cloud.js [--force]

const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');
const { put } = require('@vercel/blob');

const ROOT = path.join(__dirname, '..');
const DB_FILE = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'db.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };

async function main() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Missing Upstash Redis or Vercel Blob env vars. Run `vercel env pull .env.local` first.');
  }
  const redis = new Redis({ url, token });

  if ((await redis.exists('md:db')) && !process.argv.includes('--force')) {
    throw new Error('The cloud database already has content. Re-run with --force to overwrite it.');
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const moved = new Map();

  async function migrate(src) {
    if (typeof src !== 'string' || !src.startsWith('/uploads/')) return src;
    if (moved.has(src)) return moved.get(src);
    const file = path.join(UPLOAD_DIR, path.basename(src));
    if (!fs.existsSync(file)) {
      console.warn(`  missing ${src}, skipped`);
      return src;
    }
    const { url: blobUrl } = await put(`uploads/${path.basename(file)}`, fs.readFileSync(file), {
      access: 'public',
      contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      allowOverwrite: true,
    });
    console.log(`  ${src} -> ${blobUrl}`);
    moved.set(src, blobUrl);
    return blobUrl;
  }

  console.log('Uploading images…');
  for (const g of db.gallery || []) g.src = await migrate(g.src);
  for (const o of db.offers || []) o.poster = await migrate(o.poster);
  for (const s of db.services || []) s.image = await migrate(s.image);
  for (const d of db.doctors || []) {
    d.photo = await migrate(d.photo);
    d.photoAlt = await migrate(d.photoAlt);
  }

  const { appointments = [], ...rest } = db;
  await redis.set('md:db', rest);
  await redis.del('md:appointments');
  if (appointments.length) await redis.hset('md:appointments', Object.fromEntries(appointments.map((a) => [a.id, a])));

  console.log(`Done: ${moved.size} images, ${appointments.length} appointments. Your admin login is unchanged.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
