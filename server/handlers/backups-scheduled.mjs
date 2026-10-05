import { store } from '../lib/util.mjs';
import { snapshot } from '../lib/backup.mjs';

// Called once a day by Vercel Cron (see vercel.json). If CRON_SECRET is set in
// Vercel, Vercel sends it as a Bearer token and anyone else is rejected.
export default async (req) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  const key = await snapshot(store(), 'auto');
  return new Response(JSON.stringify({ ok: true, key }), { headers: { 'content-type': 'application/json' } });
};
