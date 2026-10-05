import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cfg from './admin-config.mjs';

// ── Storage ─────────────────────────────────────────────────────
// On Vercel, data lives in Supabase (see the Supabase adapter below).
// With plain `npm run dev` the same API is backed by the .local-data folder.
function localStore() {
  const dir = path.join(process.cwd(), '.local-data');
  const file = (k) => path.join(dir, Buffer.from(k).toString('base64url'));
  const readMeta = async (k) => { try { return JSON.parse(await fs.readFile(file(k) + '.meta', 'utf8')); } catch { return null; } };
  return {
    async get(k, opts = {}) {
      try {
        const buf = await fs.readFile(file(k));
        return opts.type === 'json' ? JSON.parse(buf.toString('utf8'))
          : opts.type === 'arrayBuffer' ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
          : buf.toString('utf8');
      } catch { return null; }
    },
    async getWithMetadata(k, opts = {}) {
      const data = await this.get(k, opts);
      return data === null ? null : { data, metadata: (await readMeta(k)) || {} };
    },
    async set(k, data, opts = {}) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file(k), typeof data === 'string' ? data : Buffer.from(data));
      if (opts.metadata) await fs.writeFile(file(k) + '.meta', JSON.stringify(opts.metadata));
    },
    async setJSON(k, v) { return this.set(k, JSON.stringify(v)); },
    async delete(k) { await fs.rm(file(k), { force: true }); await fs.rm(file(k) + '.meta', { force: true }); },
    async list({ prefix = '' } = {}) {
      await fs.mkdir(dir, { recursive: true });
      const names = (await fs.readdir(dir)).filter((n) => !n.endsWith('.meta'));
      const keys = names.map((n) => Buffer.from(n, 'base64url').toString()).filter((k) => k.startsWith(prefix));
      return { blobs: keys.map((key) => ({ key })) };
    },
  };
}
// ── Supabase adapter (same tiny API as localStore) ──────────────
// Text/JSON data -> table  public.kv_store (key text primary key, value jsonb)
// Photos         -> private Storage bucket "media"
// The server uses the SERVICE ROLE key (env only, never in the browser).
const BUCKET = 'media';
const isMedia = (k) => k.startsWith('media/');
const missing = (e) => /not.?found|does not exist|404|400/i.test(`${e?.statusCode} ${e?.status} ${e?.message}`);
let client;
async function sb() {
  if (client) return client;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Storage is not set up: add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel → Settings → Environment Variables, then redeploy.');
  }
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
const fail = (e) => { throw new Error(`Supabase: ${e.message || e}`); };

function supabaseStore() {
  return {
    async get(k) {
      const db = await sb();
      const { data, error } = await db.from('kv_store').select('value').eq('key', k).limit(1);
      if (error) fail(error);
      return data?.length ? data[0].value : null;
    },
    async getWithMetadata(k) {
      const db = await sb();
      const { data, error } = await db.storage.from(BUCKET).download(k.replace(/^media\//, ''));
      if (error) { if (missing(error)) return null; fail(error); }
      return { data: await data.arrayBuffer(), metadata: { type: data.type || 'image/jpeg' } };
    },
    async set(k, data, opts = {}) {
      const db = await sb();
      if (isMedia(k)) {
        const { error } = await db.storage.from(BUCKET).upload(k.replace(/^media\//, ''), Buffer.from(data), {
          contentType: opts.metadata?.type || 'image/jpeg', upsert: true,
        });
        if (error) fail(error);
      } else {
        return this.setJSON(k, typeof data === 'string' ? JSON.parse(data) : data);
      }
    },
    async setJSON(k, v) {
      const db = await sb();
      const { error } = await db.from('kv_store').upsert({ key: k, value: v, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) fail(error);
    },
    async delete(k) {
      const db = await sb();
      const { error } = isMedia(k)
        ? await db.storage.from(BUCKET).remove([k.replace(/^media\//, '')])
        : await db.from('kv_store').delete().eq('key', k);
      if (error && !missing(error)) fail(error);
    },
    async list({ prefix = '' } = {}) {
      const db = await sb();
      const blobs = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('kv_store').select('key').like('key', `${prefix}%`).order('key').range(from, from + 999);
        if (error) fail(error);
        blobs.push(...data.map((r) => ({ key: r.key })));
        if (data.length < 1000) break;
      }
      return { blobs };
    },
  };
}
export const store = () => (process.env.ADZONE_LOCAL === '1' ? localStore() : supabaseStore());

// ── Admin credentials (see admin-config.mjs) ────────────────────
const ID = () => process.env.ADMIN_USERNAME || cfg.ADMIN_ID;
const PASS = () => process.env.ADMIN_PASSWORD || cfg.ADMIN_PASSWORD;
export const SESSION_MS = (Number(cfg.SESSION_MINUTES) || 60) * 60 * 1000;
const SECRET = () =>
  `${process.env.ADMIN_SECRET || cfg.SESSION_SECRET}|${PASS()}|${process.env.ADMIN_KEY_SECRET || cfg.KEY_SECRET}`;
// Warn while the shipped example credentials are still in use.
export const usingDefaults = () =>
  !process.env.ADMIN_PASSWORD && cfg.ADMIN_PASSWORD === 'AdZone@2026#Secure';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest();
const same = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));
export const checkId = (id) => same(id, ID());
export const checkPassword = (pass) => same(pass, PASS());

// Brute-force guard: 5 wrong tries -> locked for 10 minutes (per IP).
// Stored in the database so it survives serverless restarts.
const lockKey = (ip) => `lock/${crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 32)}`;
const readLock = async (ip) => { try { return (await store().get(lockKey(ip), { type: 'json' })) || { n: 0, until: 0 }; } catch { return { n: 0, until: 0 }; } };
export const lockedFor = async (ip) => {
  const t = await readLock(ip);
  return t.until > Date.now() ? Math.ceil((t.until - Date.now()) / 60000) : 0;
};
export const noteFail = async (ip) => {
  const t = await readLock(ip);
  t.n = t.until && t.until <= Date.now() ? 1 : t.n + 1;
  if (t.n >= 5) { t.until = Date.now() + 10 * 60000; t.n = 0; }
  try { await store().setJSON(lockKey(ip), t); } catch { /* storage down: don't block login */ }
};
export const clearFails = async (ip) => { try { await store().delete(lockKey(ip)); } catch { /* ignore */ } };
export const clientIp = (req) =>
  req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';

export function sign(payload) {
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET()).update(p).digest('base64url');
  return `${p}.${s}`;
}

export function verify(token, type = 'admin') {
  if (!token) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const expected = crypto.createHmac('sha256', SECRET()).update(p).digest('base64url');
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(p, 'base64url').toString());
    return data.exp > Date.now() && data.t === type ? data : null;
  } catch {
    return null;
  }
}

export const isAdmin = (req) =>
  !!verify((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), 'admin');

export const clip = (v, n = 2000) => String(v ?? '').slice(0, n);
