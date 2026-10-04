const test = require('node:test'), assert = require('node:assert'), start = require('./mock_supabase'), { Auth } = require('../ui/auth-core.js');
const mk = (port, store = {}, now = () => Date.now()) => new Auth({ fetch, config: () => ({ url: 'http://127.0.0.1:' + port, anonKey: 'anon-key-for-tests-0123456789' }), load: () => store.s || null, save: s => { store.s = s; }, clear: () => { store.s = null; }, now });
test('not configured -> clear message, no network', async () => {
  const a = new Auth({ fetch, config: () => ({ url: '', anonKey: '' }), load: () => null, save() { }, clear() { }, now: Date.now });
  assert.equal(a.state().configured, false); assert.match((await a.signIn('a@b.co', 'x')).error, /not set up/);
});
test('email sign up -> session, then sign out clears and tells the server', async () => {
  const srv = start(18101), store = {}, a = mk(18101, store);
  assert.deepEqual(await a.signUp('Chandru@Gmail.com', 'secret1'), { ok: true });
  const st = a.state(); assert.ok(st.signedIn && st.user.email === 'chandru@gmail.com' && st.user.name === 'chandru');
  await a.signOut(); assert.equal(a.state().signedIn, false); assert.equal(store.s, null); assert.equal(srv.opts.loggedOut, 1); srv.stop();
});
test('friendly errors: wrong password, duplicate, weak password, bad email', async () => {
  const srv = start(18102), a = mk(18102); await a.signUp('a@gmail.com', 'secret1'); await a.signOut();
  assert.match((await a.signIn('a@gmail.com', 'nope')).error, /Wrong email or password/);
  assert.match((await a.signIn('nobody@gmail.com', 'x')).error, /Wrong email or password/);
  assert.match((await a.signUp('a@gmail.com', 'secret1')).error, /already has an account/);
  assert.match((await a.signUp('b@gmail.com', '123')).error, /at least 6/);
  assert.match((await a.signUp('not-an-email', 'secret1')).error, /valid email/); srv.stop();
});
test('email confirmation required -> not signed in, told to confirm', async () => {
  const srv = start(18103, { confirm: true }), a = mk(18103); const r = await a.signUp('c@gmail.com', 'secret1');
  assert.ok(r.ok && r.confirm); assert.equal(a.state().signedIn, false); srv.stop();
});
test('Google (PKCE): challenge/verifier really match, session has the Google profile', async () => {
  const srv = start(18104), a = mk(18104), { url, verifier } = await a.googleStart('http://127.0.0.1:53682/callback');
  assert.match(url, /provider=google/); assert.match(url, /code_challenge_method=s256/);
  const r = await fetch(url, { redirect: 'manual' }); const code = new URL(r.headers.get('location')).searchParams.get('code');
  assert.equal((await a.googleFinish(code, 'WRONG-verifier')).ok, false);                       // a stolen code is useless without the verifier
  const a2 = mk(18104), s2 = await a2.googleStart('http://127.0.0.1:53682/callback'), r2 = await fetch(s2.url, { redirect: 'manual' });
  const ok = await a2.googleFinish(new URL(r2.headers.get('location')).searchParams.get('code'), s2.verifier);
  assert.ok(ok.ok); const u = a2.state().user; assert.equal(u.name, 'Chandru S'); assert.equal(u.provider, 'google'); srv.stop();
});
test('Google not enabled in Supabase -> says exactly what to switch on', async () => {
  const srv = start(18105, { noGoogle: true }), a = mk(18105), { url } = await a.googleStart('http://127.0.0.1:53682/callback');
  const r = await fetch(url, { redirect: 'manual' }); assert.equal(r.status, 400); srv.stop();
});
test('token refresh: renews near expiry; offline keeps you signed in; revoked token signs out', async () => {
  const srv = start(18106, { expiresIn: 60 }), store = {}; let t = Date.now(), a = mk(18106, store, () => t);
  await a.signUp('d@gmail.com', 'secret1'); const first = store.s.access_token;
  assert.ok((await a.refresh()).ok); assert.notEqual(store.s.access_token, first);                 // 60 s lifetime is < 120 s margin -> refreshed
  const rt = store.s.refresh_token; srv.stop();                                                   // server gone = offline
  const off = await a.refresh(true); assert.ok(off.ok && off.offline); assert.equal(store.s.refresh_token, rt); assert.ok(a.state().signedIn);
  const srv2 = start(18106); const rev = await mk(18106, store, () => t).refresh(true);            // new server does not know this token
  assert.equal(rev.signedOut, true); assert.equal(store.s, null); srv2.stop();
});
test('wrong anon key is reported, not swallowed', async () => {
  const srv = start(18107), a = new Auth({ fetch, config: () => ({ url: 'http://127.0.0.1:18107', anonKey: 'x'.repeat(30) }), load: () => null, save() { }, clear() { }, now: Date.now });
  const r = await a.signIn('a@b.co', 'x'); assert.equal(r.ok, false); assert.match(r.error, /Invalid API key|failed/); srv.stop();
});
