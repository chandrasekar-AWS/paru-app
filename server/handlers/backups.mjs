import { json, store, isAdmin } from '../lib/util.mjs';
import { snapshot, PREFIX } from '../lib/backup.mjs';

export default async (req) => {
  if (!isAdmin(req)) return json({ error: 'Not signed in.' }, 401);
  const s = store();

  if (req.method === 'GET') {
    const { blobs } = await s.list({ prefix: PREFIX });
    const items = (await Promise.all(blobs.map(async (b) => {
      const v = await s.get(b.key, { type: 'json' });
      return v ? { key: b.key, at: v.at, reason: v.reason } : null;
    }))).filter(Boolean).sort((a, b) => (a.at < b.at ? 1 : -1));
    return json({ items });
  }

  if (req.method === 'POST') {
    const key = await snapshot(s, 'manual');
    return json({ ok: true, key });
  }

  if (req.method === 'PUT') {
    // Restore: copy a snapshot's content back to the live "content" key.
    const key = new URL(req.url).searchParams.get('key') || '';
    if (!key.startsWith(PREFIX)) return json({ error: 'Bad request' }, 400);
    const snap = await s.get(key, { type: 'json' });
    if (!snap) return json({ error: 'Backup not found.' }, 404);
    await s.setJSON('content', snap.content || {});
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
};
