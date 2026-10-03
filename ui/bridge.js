/* Phone / browser bridge: defines window.P (the same API Electron's preload gives the desktop app)
 * using fetch() to the Paru agent running on your computer, and localStorage for settings. */
(function () {
  if (window.P) return;                                       // Electron already provided it
  const bus = {}, on = k => f => (bus[k] = bus[k] || []).push(f), emit = (k, v) => (bus[k] || []).forEach(f => f(v));
  const KEY = 'paru.cfg.v3';
  const PERMS = { mic: 'ask', apps: 'ask', browser: 'ask', search: 'ask', files: 'ask', photos: 'ask', download: 'ask', screenshot: 'ask', system: 'ask', contacts: 'ask', calls: 'ask', upload: 'ask', reply: 'ask', update: 'ask', onlineCalls: 'ask' };
  const normP = p => { const o = {}; for (const k in PERMS) { const v = (p || {})[k]; o[k] = v === true || v === 'allow' ? 'allow' : v === 'deny' ? 'deny' : 'ask'; } return o; };
  const DEF = () => ({ server: '', key: '', lang: 'auto', wake: false, wakeWord: 'Hey Paru', offWord: 'Turn off Paru', assistant: 'Paru', owner: '', provider: { id: '', base: '', model: '' }, voice: 'en-IN-NeerjaNeural', rate: 0, theme: 'dark', accent: '#8a6bff', fontSize: 'normal', orbSize: 'medium', interrupt: true,
    voiceLock: false, voiceprint: null, vpVer: 0, voiceThr: 0.9, askEach: true, autoHide: 0, onboarded: false, perms: { ...PERMS } });
  const read = () => { try { const c = { ...DEF(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; c.perms = normP(c.perms); return c; } catch { return DEF(); } };
  const write = c => localStorage.setItem(KEY, JSON.stringify(c));
  const base = () => (read().server || '').replace(/\/$/, '');
  /* ---- sign-in on the phone: the same Supabase client (email + password; Google needs the desktop app for now) ---- */
  const sbCfg = () => { try { if (window.PARU_SUPABASE && window.PARU_SUPABASE.url) return window.PARU_SUPABASE; return JSON.parse(localStorage.getItem('paru.supabase') || '{}'); } catch { return {}; } };
  const auth = window.ParuAuth ? new ParuAuth.Auth({ fetch: (...a) => fetch(...a), config: sbCfg, now: Date.now,
    load: () => { try { return JSON.parse(localStorage.getItem('paru.session') || 'null'); } catch { return null; } }, save: x => localStorage.setItem('paru.session', JSON.stringify(x)), clear: () => localStorage.removeItem('paru.session') }) : null;
  const info = () => ({ ...(auth ? auth.state() : { configured: false, signedIn: false, user: null }), secure: false, redirect: '' });
  async function syncAgent() {                                          // the agent keeps the key in memory only, so hand it over each time the app starts
    const c = read(), key = localStorage.getItem('paru.pkey') || ''; if (!c.server || !c.provider || !c.provider.id) return;
    const h = { 'x-key': c.key, 'Content-Type': 'application/json' }, post = (p, b) => fetch(base() + p, { method: 'POST', headers: h, body: JSON.stringify(b) }).catch(() => { });
    await post('/voice/provider', { id: c.provider.id, key, base: c.provider.base || '', model: c.provider.model || '' });
    await post('/voice/config', { wake: c.wakeWord, off: c.offWord, assistant: c.assistant, owner: c.owner || ((auth && auth.state().user) || {}).name || '' });
  }
  const after = async () => { const u = auth.state().user, c = read(); if (u && !c.owner) write({ ...c, owner: u.name }); if (read().onboarded) write({ ...read(), wake: true }); };
  window.P = {
    platform: 'web', isElectron: false,
    async api(p, method, body, type, raw) {
      if (!base()) return { error: 'unreachable' };
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 40000);
      try {
        const r = await fetch(base() + p, { method: method || 'GET', headers: { 'x-key': read().key, 'Content-Type': type || 'application/json' }, body: body == null ? undefined : body, signal: ac.signal });
        if (raw) return r.ok ? { audio: await r.arrayBuffer(), mime: (r.headers.get('content-type') || 'audio/mpeg').split(';')[0] } : { error: 'tts' };
        return await r.json();
      } catch { return { error: 'unreachable' }; } finally { clearTimeout(t); }
    },
    async cfg() { return read() },
    async authState() { if (auth) { const r = await auth.refresh(); if (r && r.signedOut) emit('cfg', read()); } return info(); },
    async authSignIn(email, password) { const r = await auth.signIn(email, password); if (r.ok) await after(); return { ...r, ...info() }; },
    async authSignUp(email, password) { const r = await auth.signUp(email, password); if (r.ok && !r.confirm) await after(); return { ...r, ...info() }; },
    async authSignOut() { await auth.signOut(); write({ ...read(), wake: false }); location.replace('setup.html'); return info(); },
    async authSetConfig(url, anonKey) { url = String(url || '').trim().replace(/\/$/, ''); if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) return { ok: false, error: 'The project URL looks like https://abcdxyz.supabase.co' }; if (String(anonKey || '').length < 30) return { ok: false, error: 'Paste the anon public key.' }; localStorage.setItem('paru.supabase', JSON.stringify({ url, anonKey: anonKey.trim() })); return { ok: true, ...info() }; },
    async providerSave(p) { if (p.key) localStorage.setItem('paru.pkey', p.key); const c = read(); write({ ...c, provider: { id: p.id, base: p.base || '', model: p.model || '' } }); await syncAgent(); return { ok: true }; },
    async providerStatus() { const c = read(); return { ...(c.provider || { id: '', base: '', model: '' }), hasKey: !!localStorage.getItem('paru.pkey'), secure: false }; },
    async profileSave(p) { write({ ...read(), ...p }); await syncAgent(); return true; },
    setupDone() { write({ ...read(), onboarded: true, wake: true }); location.replace('index.html'); },
    openSetup(step) { location.href = 'setup.html?step=' + (step || 'voice') + '&back=1'; },
    setupBack() { location.replace('index.html'); }, permReply() { }, onAskPerm() { }, onAuthChanged() { },
    async setCfg(c) { const cur = read(); if (c.perms) c.perms = normP({ ...cur.perms, ...c.perms }); const n = { ...cur, ...c }; write(n); setTimeout(() => emit('cfg', n), 0); return n; },
    async act() { return 'blocked'; },                         // opening PC programs makes no sense on a phone
    ov() { }, talk: () => emit('talk'), win() { },
    envRead: async () => '', envWrite: async () => true, restart: async () => true,
    enroll: () => emit('enroll'), enrollDone: x => emit('enrollDone', x), openMain: s => emit('goto', s),
    engineStatus: s => emit('engineStatus', s), agentStatus: async () => ({ state: 'online' }),
    onCfg: on('cfg'), onTalk: on('talk'), onEnroll: on('enroll'), onEnrollDone: on('enrollDone'), onGoto: on('goto'), onFs() { }, onEngineStatus: on('engineStatus'), onAgentStatus() { }
  };
  setTimeout(syncAgent, 800);
})();
