import { json, sign, verify, checkId, checkPassword, usingDefaults, SESSION_MS, lockedFor, noteFail, clearFails, clientIp } from '../lib/util.mjs';
import { readKeyFile } from '../lib/keyfile.mjs';

const STEP_MS = 5 * 60 * 1000; // each step's ticket is valid for 5 minutes

const fail = async (ip, msg) => {
  await noteFail(ip);
  await new Promise((r) => setTimeout(r, 700)); // slows down guessing
  return json({ error: msg }, 401);
};

export default async (req) => {
  // Is my admin session still valid?
  if (req.method === 'GET') {
    const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const d = verify(t, 'admin');
    return d ? json({ ok: true, exp: d.exp, usingDefaults: usingDefaults() }) : json({ ok: false }, 401);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const ip = clientIp(req);
  const wait = await lockedFor(ip);
  if (wait) return json({ error: `Too many wrong attempts. Try again in ${wait} minute(s).` }, 429);

  let b = {};
  try { b = await req.json(); } catch { /* ignore */ }

  // Step 1 — Admin ID
  if (b.action === 'checkId') {
    if (!checkId(b.id ?? '')) return fail(ip, 'Wrong Admin ID.');
    return json({ ok: true, ticket: sign({ t: 'idok', exp: Date.now() + STEP_MS }) });
  }

  // Step 2 — Password (only after a valid ID ticket)
  if (b.action === 'checkPassword') {
    if (!verify(b.ticket, 'idok')) return json({ error: 'Session expired. Start again from the Admin ID.', restart: true }, 401);
    if (!checkPassword(b.password ?? '')) return fail(ip, 'Wrong password.');
    return json({ ok: true, ticket: sign({ t: 'pwok', exp: Date.now() + STEP_MS }) });
  }

  // Step 3 — Key file (only after a valid password ticket)
  if (b.action === 'key') {
    if (!verify(b.ticket, 'pwok')) return json({ error: 'Session expired. Start again from the Admin ID.', restart: true }, 401);
    const k = readKeyFile(b.keyFile);
    if (!k) return fail(ip, 'Invalid key file.');
    return json({ ok: true, ticket: sign({ t: 'keyok', kid: k.kid, exp: Date.now() + STEP_MS }) });
  }

  // Step 4 — everything already verified in order; issue the session.
  if (b.action === 'login') {
    if (!verify(b.ticket, 'keyok')) return json({ error: 'Session expired. Start again from the Admin ID.', restart: true }, 401);
    await clearFails(ip);
    const exp = Date.now() + SESSION_MS; // fixed length — logs out automatically
    return json({ token: sign({ t: 'admin', exp }), exp, usingDefaults: usingDefaults() });
  }

  return json({ error: 'Bad request' }, 400);
};
