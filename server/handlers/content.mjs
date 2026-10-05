import { json, store, isAdmin, clip } from '../lib/util.mjs';

const str = (v, n) => clip(v, n);
const cleanGallery = (a) =>
  a.slice(0, 500).map((g) => ({
    id: str(g.id, 60), image: str(g.image, 300), title: str(g.title, 120), category: str(g.category, 30),
  })).filter((g) => g.image);
const cleanReviews = (a) =>
  a.slice(0, 100).map((r) => ({
    id: str(r.id, 60), quote: str(r.quote, 1200), name: str(r.name, 80), role: str(r.role, 80),
  })).filter((r) => r.quote);
const cleanServices = (o) => {
  const out = {};
  for (const cat of ['design', 'print', 'signage', 'digital']) {
    if (!Array.isArray(o[cat])) continue;
    out[cat] = o[cat].slice(0, 60).map((s) => ({
      name: str(s.name, 120),
      description: str(s.description, 3000),
      images: Array.isArray(s.images) ? s.images.slice(0, 12).map((i) => str(i, 300)).filter(Boolean) : [],
    })).filter((s) => s.name);
  }
  return out;
};

export default async (req) => {
  const s = store();
  if (req.method === 'GET') {
    const c = (await s.get('content', { type: 'json' })) || {};
    return json({ gallery: c.gallery ?? null, reviews: c.reviews ?? null, services: c.services ?? null });
  }
  if (req.method === 'PUT') {
    if (!isAdmin(req)) return json({ error: 'Not signed in.' }, 401);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
    const c = (await s.get('content', { type: 'json' })) || {};
    if (Array.isArray(b.gallery)) c.gallery = cleanGallery(b.gallery);
    if (Array.isArray(b.reviews)) c.reviews = cleanReviews(b.reviews);
    if (b.services && typeof b.services === 'object') c.services = { ...(c.services || {}), ...cleanServices(b.services) };
    await s.setJSON('content', c);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed' }, 405);
};
