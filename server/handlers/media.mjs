import crypto from 'node:crypto';
import { json, store, isAdmin } from '../lib/util.mjs';

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ID = /^[0-9a-f-]{36}$/;

export default async (req) => {
  const s = store();
  const id = new URL(req.url).pathname.split('/').pop();

  if (req.method === 'GET') {
    if (!ID.test(id)) return new Response('Not found', { status: 404 });
    const r = await s.getWithMetadata(`media/${id}`, { type: 'arrayBuffer' });
    if (!r) return new Response('Not found', { status: 404 });
    return new Response(r.data, {
      headers: {
        'content-type': r.metadata?.type || 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    });
  }

  if (!isAdmin(req)) return json({ error: 'Not signed in.' }, 401);

  if (req.method === 'POST') {
    const type = (req.headers.get('content-type') || '').split(';')[0];
    if (!TYPES.includes(type)) return json({ error: 'Only JPG, PNG, WEBP or GIF images.' }, 400);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 4.2 * 1024 * 1024) return json({ error: 'Image too large (max ~4 MB).' }, 400);
    const newId = crypto.randomUUID();
    await s.set(`media/${newId}`, buf, { metadata: { type } });
    return json({ url: `/api/media/${newId}` });
  }

  if (req.method === 'DELETE') {
    if (ID.test(id)) await s.delete(`media/${id}`);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
};
