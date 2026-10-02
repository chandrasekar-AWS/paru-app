/* Phone / browser bridge: defines window.P (the same API Electron's preload gives the desktop app)
 * using fetch() to the Paru agent running on your computer, and localStorage for settings. */
(function () {
  if (window.P) return;                                       // Electron already provided it
  const bus = {}, on = k => f => (bus[k] = bus[k] || []).push(f), emit = (k, v) => (bus[k] || []).forEach(f => f(v));
  const KEY = 'paru.cfg.v3';
  const PERMS = { mic: true, contacts: false, photos: false, calls: false, apps: false, files: false, search: true, download: false, upload: false, reply: false, update: false, onlineCalls: false, browser: true };
  const DEF = () => ({ server: '', key: '', lang: 'auto', wake: true, voice: 'en-IN-NeerjaNeural', rate: 0, theme: 'dark', accent: '#8a6bff', fontSize: 'normal', orbSize: 'medium', interrupt: true,
    voiceLock: false, voiceprint: null, vpVer: 0, voiceThr: 0.9, askEach: true, autoHide: 0, onboarded: false, perms: { ...PERMS } });
  const read = () => { try { const c = { ...DEF(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; c.perms = { ...PERMS, ...c.perms }; return c; } catch { return DEF(); } };
  const write = c => localStorage.setItem(KEY, JSON.stringify(c));
  const base = () => (read().server || '').replace(/\/$/, '');
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
    async setCfg(c) { const cur = read(); if (c.perms) c.perms = { ...cur.perms, ...c.perms }; const n = { ...cur, ...c }; write(n); setTimeout(() => emit('cfg', n), 0); return n; },
    async act() { return 'blocked'; },                         // opening PC programs makes no sense on a phone
    ov() { }, talk: () => emit('talk'), win() { },
    envRead: async () => '', envWrite: async () => true, restart: async () => true,
    enroll: () => emit('enroll'), enrollDone: x => emit('enrollDone', x), openMain: s => emit('goto', s),
    engineStatus: s => emit('engineStatus', s), agentStatus: async () => ({ state: 'online' }),
    onCfg: on('cfg'), onTalk: on('talk'), onEnroll: on('enroll'), onEnrollDone: on('enrollDone'), onGoto: on('goto'), onFs() { }, onEngineStatus: on('engineStatus'), onAgentStatus() { }
  };
})();
