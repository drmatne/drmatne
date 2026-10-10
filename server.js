'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const seed = require('./seed.json');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ---------------------------------------------------------------- storage backends */

// On Vercel the filesystem is temporary, so content lives in Upstash Redis and
// images in Vercel Blob. Without those env vars, everything stays on local disk.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = REDIS_URL && REDIS_TOKEN ? new (require('@upstash/redis').Redis)({ url: REDIS_URL, token: REDIS_TOKEN }) : null;
const blob = process.env.BLOB_READ_WRITE_TOKEN ? require('@vercel/blob') : null;
const DB_KEY = 'md:db';
const APPT_KEY = 'md:appointments';

if (process.env.VERCEL && (!redis || !blob)) {
  console.error('Missing storage: connect an Upstash Redis database and a Vercel Blob store to this project.');
}
if (!redis) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!blob) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------------------------------------------------------- passwords */

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

/* ---------------------------------------------------------------- database */

let db = null;

function freshDb() {
  const fresh = structuredClone(seed);
  fresh.admin = {
    username: process.env.ADMIN_USER || 'admin',
    passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
  };
  fresh.sessionSecret = crypto.randomBytes(32).toString('hex');
  return fresh;
}

// Local mode keeps the db in memory; cloud mode re-reads it on every API request
// because each serverless instance has its own memory.
async function loadDb() {
  if (redis) {
    db = await redis.get(DB_KEY);
    if (!db) {
      const { appointments: _ignored, ...fresh } = freshDb();
      await redis.set(DB_KEY, fresh, { nx: true });
      db = await redis.get(DB_KEY);
      console.log('Created database from seed. Default login: admin / admin123 unless ADMIN_PASSWORD is set.');
    }
  } else if (!db) {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } else {
      db = freshDb();
      await saveDb();
      console.log('Created data/db.json from seed. Default login: admin / admin123 — change it in the admin panel.');
    }
  }
  if (!db.sessionSecret) {
    db.sessionSecret = crypto.randomBytes(32).toString('hex');
    await saveDb();
  }
}

async function saveDb() {
  if (redis) {
    const { appointments: _ignored, ...rest } = db;
    await redis.set(DB_KEY, rest);
    return;
  }
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// Appointments get their own Redis hash so simultaneous bookings can't overwrite each other.
const appointments = {
  async list() {
    if (!redis) return db.appointments;
    const all = Object.values((await redis.hgetall(APPT_KEY)) || {});
    return all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },
  async get(id) {
    if (!redis) return db.appointments.find((a) => a.id === id) || null;
    return redis.hget(APPT_KEY, id);
  },
  async add(appt) {
    if (!redis) {
      db.appointments.unshift(appt);
      return saveDb();
    }
    await redis.hset(APPT_KEY, { [appt.id]: appt });
  },
  async update(appt) {
    if (!redis) return saveDb();
    await redis.hset(APPT_KEY, { [appt.id]: appt });
  },
  async remove(id) {
    if (redis) return (await redis.hdel(APPT_KEY, id)) > 0;
    const i = db.appointments.findIndex((a) => a.id === id);
    if (i < 0) return false;
    db.appointments.splice(i, 1);
    await saveDb();
    return true;
  },
};

/* ---------------------------------------------------------------- helpers */

const newId = () => crypto.randomBytes(8).toString('hex');
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);

function normalizeWhatsapp(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) digits = `91${digits.slice(1)}`;
  return digits;
}

async function removeUpload(src) {
  if (typeof src !== 'string') return;
  if (blob && /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//.test(src)) {
    await blob.del(src).catch(() => {});
  } else if (src.startsWith('/uploads/')) {
    await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(src))).catch(() => {});
  }
}

function isOfferLive(offer) {
  if (!offer.active) return false;
  if (!offer.validTill) return true;
  return new Date(`${offer.validTill}T23:59:59`) >= new Date();
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

/* ---------------------------------------------------------------- uploads */

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const EXT_FOR_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
const uploadName = (file) => `${Date.now()}-${newId()}${EXT_FOR_MIME[file.mimetype] || '.jpg'}`;

const multerUpload = multer({
  storage: blob
    ? multer.memoryStorage()
    : multer.diskStorage({ destination: UPLOAD_DIR, filename: (_req, file, cb) => cb(null, uploadName(file)) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 30 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed.'), { status: 400 }));
  },
});

const uploadedFiles = (req) => (req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat());

// In cloud mode, push the parsed files to Vercel Blob before the route runs.
async function storeInBlob(req, _res, next) {
  if (blob) {
    await Promise.all(uploadedFiles(req).map(async (f) => {
      const { url } = await blob.put(`uploads/${uploadName(f)}`, f.buffer, { access: 'public', contentType: f.mimetype });
      f.url = url;
    }));
  }
  next();
}

const upload = {
  single: (name) => [multerUpload.single(name), storeInBlob],
  array: (name, max) => [multerUpload.array(name, max), storeInBlob],
  fields: (fields) => [multerUpload.fields(fields), storeInBlob],
};

const fileUrl = (file) => (file ? file.url || `/uploads/${file.filename}` : null);

/* ---------------------------------------------------------------- sessions */

// Stateless signed tokens, so logins survive restarts and work across serverless instances.
// The signature covers the password hash, so changing the password logs out every device.
const signSession = (exp) => crypto.createHmac('sha256', db.sessionSecret).update(`${exp}:${db.admin.passwordHash}`).digest('hex');

function issueSession(req, res) {
  const exp = Date.now() + SESSION_TTL_MS;
  res.cookie('md_session', `${exp}.${signSession(exp)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function validSession(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const expected = Buffer.from(signSession(exp));
  const got = Buffer.from(sig);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

function requireAuth(req, res, next) {
  if (!validSession(parseCookies(req.headers.cookie).md_session)) return res.status(401).json({ error: 'Please log in.' });
  next();
}

const loginAttempts = new Map(); // ip -> { count, resetAt }

function rateLimit(map, key, max, windowMs) {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

/* ---------------------------------------------------------------- app */

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// On Vercel, public/ is served by the CDN; these only matter when running locally.
if (!blob) app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use('/api', async (_req, _res, next) => {
  await loadDb();
  next();
});

/* ----- public API */

app.get('/api/public', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    settings: db.settings,
    doctors: db.doctors,
    services: db.services,
    facilities: db.facilities || [],
    offers: db.offers.filter(isOfferLive),
    gallery: db.gallery,
  });
});

const appointmentLimits = new Map();

app.post('/api/appointments', async (req, res) => {
  if (!rateLimit(appointmentLimits, req.ip, 8, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many requests. Please call or WhatsApp us instead.' });
  }
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot

  const name = str(b.name, 80);
  const phone = str(b.phone, 20);
  const date = str(b.date, 10);
  const time = str(b.time, 40);
  const service = str(b.service, 120);
  const doctor = str(b.doctor, 80);
  const message = str(b.message, 600);

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Please choose a preferred date.' });
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return res.status(400).json({ error: 'Please choose today or a future date.' });

  const appt = { id: newId(), name, phone, date, time, service, doctor, message, status: 'new', createdAt: new Date().toISOString() };
  await appointments.add(appt);
  res.json({ ok: true, appointment: { id: appt.id } });
});

/* ----- auth */

app.post('/api/admin/login', (req, res) => {
  if (!rateLimit(loginAttempts, req.ip, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  }
  const { username, password } = req.body || {};
  if (str(username) !== db.admin.username || !verifyPassword(String(password || ''), db.admin.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  loginAttempts.delete(req.ip);
  issueSession(req, res);
  res.json({ ok: true, usingDefaultPassword: verifyPassword('admin123', db.admin.passwordHash) });
});

app.post('/api/admin/logout', (_req, res) => {
  res.clearCookie('md_session', { path: '/' });
  res.json({ ok: true });
});

const admin = express.Router();
admin.use(requireAuth);

admin.get('/data', async (_req, res) => {
  const { admin: adminInfo, sessionSecret: _secret, ...rest } = db;
  res.json({
    ...rest,
    appointments: await appointments.list(),
    username: adminInfo.username,
    usingDefaultPassword: verifyPassword('admin123', adminInfo.passwordHash),
  });
});

admin.post('/password', async (req, res) => {
  const { current, next: nextPw, username } = req.body || {};
  if (!verifyPassword(String(current || ''), db.admin.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(nextPw || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.admin.passwordHash = hashPassword(String(nextPw));
  if (str(username, 40)) db.admin.username = str(username, 40);
  await saveDb();
  issueSession(req, res); // old sessions are now invalid; keep this one logged in
  res.json({ ok: true });
});

/* ----- settings */

const SETTINGS_FIELDS = [
  'clinicName', 'clinicSubName', 'heroEyebrow', 'heroTitle', 'heroSubtitle', 'announcement',
  'whatsapp', 'whatsappMessage', 'phone', 'phone2', 'email', 'address', 'addressLocal', 'mapQuery',
  'hoursWeekdays', 'hoursSunday', 'googleReviewsUrl', 'instagram', 'facebook',
];

admin.put('/settings', async (req, res) => {
  const b = req.body || {};
  for (const key of SETTINGS_FIELDS) {
    if (key in b) db.settings[key] = str(b[key], 600);
  }
  if ('whatsapp' in b) {
    const wa = normalizeWhatsapp(b.whatsapp);
    if (wa.length < 11) return res.status(400).json({ error: 'Enter a valid WhatsApp number (10 digits, or with country code).' });
    db.settings.whatsapp = wa;
  }
  await saveDb();
  res.json({ ok: true, settings: db.settings });
});

/* ----- offers */

function readOffer(b) {
  return {
    title: str(b.title, 120),
    description: str(b.description, 800),
    price: str(b.price, 60),
    originalPrice: str(b.originalPrice, 60),
    validTill: /^\d{4}-\d{2}-\d{2}$/.test(str(b.validTill)) ? str(b.validTill) : '',
    active: b.active === undefined ? true : String(b.active) === 'true',
  };
}

admin.post('/offers', upload.single('poster'), async (req, res) => {
  const data = readOffer(req.body);
  if (!data.title && !req.file) return res.status(400).json({ error: 'Add a title or a poster image.' });
  const offer = { id: newId(), ...data, poster: fileUrl(req.file), createdAt: new Date().toISOString() };
  db.offers.unshift(offer);
  await saveDb();
  res.json({ ok: true, offer });
});

admin.put('/offers/:id', upload.single('poster'), async (req, res) => {
  const offer = db.offers.find((o) => o.id === req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found.' });
  Object.assign(offer, readOffer(req.body));
  if (req.file) {
    await removeUpload(offer.poster);
    offer.poster = fileUrl(req.file);
  }
  await saveDb();
  res.json({ ok: true, offer });
});

admin.delete('/offers/:id', async (req, res) => {
  const i = db.offers.findIndex((o) => o.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Offer not found.' });
  await removeUpload(db.offers[i].poster);
  db.offers.splice(i, 1);
  await saveDb();
  res.json({ ok: true });
});

/* ----- gallery */

admin.post('/gallery', upload.array('images', 30), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'Choose at least one image.' });
  const caption = str(req.body.caption, 160);
  const items = req.files.map((f) => ({ id: newId(), src: fileUrl(f), caption, createdAt: new Date().toISOString() }));
  db.gallery.unshift(...items);
  await saveDb();
  res.json({ ok: true, items });
});

admin.put('/gallery/:id', async (req, res) => {
  const item = db.gallery.find((g) => g.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Image not found.' });
  item.caption = str(req.body?.caption, 160);
  await saveDb();
  res.json({ ok: true, item });
});

admin.post('/gallery/:id/move', async (req, res) => {
  const i = db.gallery.findIndex((g) => g.id === req.params.id);
  const j = i + (req.body?.direction === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= db.gallery.length) return res.json({ ok: true });
  [db.gallery[i], db.gallery[j]] = [db.gallery[j], db.gallery[i]];
  await saveDb();
  res.json({ ok: true });
});

admin.delete('/gallery/:id', async (req, res) => {
  const i = db.gallery.findIndex((g) => g.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Image not found.' });
  await removeUpload(db.gallery[i].src);
  db.gallery.splice(i, 1);
  await saveDb();
  res.json({ ok: true });
});

/* ----- doctors */

const doctorUpload = upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'photoAlt', maxCount: 1 }]);

async function applyDoctor(doc, b, files) {
  for (const key of ['name', 'nameLocal', 'degree', 'title', 'extra', 'bio', 'photoPosition']) {
    if (key in b) doc[key] = str(b[key], key === 'bio' ? 1200 : 160);
  }
  for (const key of ['photo', 'photoAlt']) {
    const f = files?.[key]?.[0];
    if (f) {
      await removeUpload(doc[key]);
      doc[key] = fileUrl(f);
    } else if (b[`remove_${key}`] === 'true') {
      await removeUpload(doc[key]);
      doc[key] = '';
    }
  }
}

admin.post('/doctors', doctorUpload, async (req, res) => {
  const doc = { id: newId(), name: '', nameLocal: '', degree: '', title: '', extra: '', bio: '', photo: '', photoAlt: '', photoPosition: '50% 20%' };
  await applyDoctor(doc, req.body, req.files);
  if (!doc.name) return res.status(400).json({ error: 'Doctor name is required.' });
  db.doctors.push(doc);
  await saveDb();
  res.json({ ok: true, doctor: doc });
});

admin.put('/doctors/:id', doctorUpload, async (req, res) => {
  const doc = db.doctors.find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
  await applyDoctor(doc, req.body, req.files);
  await saveDb();
  res.json({ ok: true, doctor: doc });
});

admin.delete('/doctors/:id', async (req, res) => {
  const i = db.doctors.findIndex((d) => d.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Doctor not found.' });
  await removeUpload(db.doctors[i].photo);
  await removeUpload(db.doctors[i].photoAlt);
  db.doctors.splice(i, 1);
  await saveDb();
  res.json({ ok: true });
});

/* ----- services */

admin.post('/services', upload.single('image'), async (req, res) => {
  const title = str(req.body.title, 80);
  if (!title) return res.status(400).json({ error: 'Service title is required.' });
  const svc = { id: newId(), title, desc: str(req.body.desc, 400), image: fileUrl(req.file) || '' };
  db.services.push(svc);
  await saveDb();
  res.json({ ok: true, service: svc });
});

admin.put('/services/:id', upload.single('image'), async (req, res) => {
  const svc = db.services.find((s) => s.id === req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found.' });
  if ('title' in req.body) svc.title = str(req.body.title, 80);
  if ('desc' in req.body) svc.desc = str(req.body.desc, 400);
  if (req.file) {
    await removeUpload(svc.image);
    svc.image = fileUrl(req.file);
  }
  await saveDb();
  res.json({ ok: true, service: svc });
});

admin.delete('/services/:id', async (req, res) => {
  const i = db.services.findIndex((s) => s.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Service not found.' });
  await removeUpload(db.services[i].image);
  db.services.splice(i, 1);
  await saveDb();
  res.json({ ok: true });
});

/* ----- appointments */

const APPT_STATUSES = new Set(['new', 'confirmed', 'completed', 'cancelled']);

admin.patch('/appointments/:id', async (req, res) => {
  const appt = await appointments.get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
  if (APPT_STATUSES.has(req.body?.status)) appt.status = req.body.status;
  if (typeof req.body?.note === 'string') appt.note = str(req.body.note, 400);
  await appointments.update(appt);
  res.json({ ok: true, appointment: appt });
});

admin.delete('/appointments/:id', async (req, res) => {
  if (!(await appointments.remove(req.params.id))) return res.status(404).json({ error: 'Appointment not found.' });
  res.json({ ok: true });
});

admin.get('/appointments.csv', async (_req, res) => {
  const cols = ['createdAt', 'name', 'phone', 'date', 'time', 'service', 'doctor', 'message', 'status', 'note'];
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // avoid spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [cols.join(','), ...(await appointments.list()).map((a) => cols.map((c) => esc(a[c])).join(','))];
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="appointments-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`﻿${rows.join('\n')}`);
});

app.use('/api/admin', admin);

/* ----- errors */

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(async (err, req, res, _next) => {
  await Promise.all(uploadedFiles(req).map((f) => removeUpload(fileUrl(f))));
  const status = err instanceof multer.MulterError ? 400 : err.status || 500;
  const message = err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 10 MB).' : status >= 500 ? 'Something went wrong. Please try again.' : err.message;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Matne Dental running at http://localhost:${PORT}  (admin: http://localhost:${PORT}/admin)`);
  });
}
