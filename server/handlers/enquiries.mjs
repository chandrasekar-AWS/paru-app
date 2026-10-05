import { json, store, isAdmin } from '../lib/util.mjs';

export default async (req) => {
  if (!isAdmin(req)) return json({ error: 'Not signed in.' }, 401);
  const s = store();
  if (req.method === 'GET') {
    const { blobs } = await s.list({ prefix: 'enquiries/' });
    const items = (await Promise.all(blobs.map(async (b) => {
      const v = await s.get(b.key, { type: 'json' });
      return v ? { ...v, key: b.key } : null;
    }))).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1));
    return json({ items });
  }
  if (req.method === 'DELETE') {
    const key = new URL(req.url).searchParams.get('key') || '';
    if (key.startsWith('enquiries/')) await s.delete(key);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
};
