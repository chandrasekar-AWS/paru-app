const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, dialog, shell, nativeImage, session, safeStorage, desktopCapturer } = require('electron');
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os'), http = require('http'), crypto = require('crypto');
const { Auth } = require('./ui/auth-core.js');

const WIN = process.platform === 'win32', LINUX = process.platform === 'linux';
const TEST = !!process.env.PARU_TEST;                       // set by test/e2e.js
if (process.env.PARU_USER_DATA) app.setPath('userData', process.env.PARU_USER_DATA);
if (LINUX) app.commandLine.appendSwitch('ozone-platform-hint', 'auto');                 // Wayland or X11, whichever the session uses
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.PARU_TEST_WAV) {                                                         // tests: feed a wav file in as the microphone
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.PARU_TEST_WAV + '%noloop');
}
if (process.env.PARU_NO_SANDBOX) app.commandLine.appendSwitch('no-sandbox');

let mainWin, ov, tray, cfgPath, agent, agentLog = [], agentState = { state: 'starting', msg: '' };
const tlog = (ev, data) => { if (process.env.PARU_TEST_LOG) try { fs.appendFileSync(process.env.PARU_TEST_LOG, JSON.stringify({ t: Date.now(), ev, ...data }) + '\n'); } catch { } };

/* ---------- settings ---------- */
const PERMS = { mic: 'ask', apps: 'ask', browser: 'ask', search: 'ask', files: 'ask', photos: 'ask', download: 'ask', screenshot: 'ask', system: 'ask', contacts: 'ask', calls: 'ask', upload: 'ask', reply: 'ask', update: 'ask', onlineCalls: 'ask' };
const normPerms = p => { const o = {}; for (const k of Object.keys(PERMS)) { const v = (p || {})[k]; o[k] = v === true || v === 'allow' ? 'allow' : v === 'deny' ? 'deny' : 'ask'; } return o; };   // old true/false settings carry over
const DEF = () => ({
  server: 'http://127.0.0.1:8000', key: '', lang: 'auto', wake: false, voice: 'en-IN-NeerjaNeural', rate: 0, lan: false, autostart: true,
  theme: 'dark', accent: '#8a6bff', fontSize: 'normal', orbSize: 'small', closeQuits: false, interrupt: true, voiceLock: false, voiceprint: null, vpVer: 0, voiceThr: 0.9,
  autoHide: 0, onboarded: false, perms: { ...PERMS }, provider: { id: '', base: '', model: '' }, wakeWord: 'Hey Paru', offWord: 'Turn off Paru', assistant: 'Paru', owner: ''
});
const cfg = () => { try { const c = { ...DEF(), ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; c.perms = normPerms(c.perms); c.provider = { ...DEF().provider, ...(c.provider || {}) }; return c; } catch { return DEF(); } };
const writeCfg = c => fs.writeFileSync(cfgPath, JSON.stringify(c));
const base = () => cfg().server.replace(/\/$/, '');
const push = () => { const n = cfg(); [mainWin, ov].forEach(w => w && !w.isDestroyed() && w.webContents.send('cfg', n)); refreshTray(); return n; };

/* ---------- vault: secrets (API key, sign-in session) are encrypted by your operating system and never leave this computer ---------- */
const vaultFile = () => path.join(app.getPath('userData'), 'vault.json');
const vaultRead = () => { try { return JSON.parse(fs.readFileSync(vaultFile(), 'utf8')); } catch { return {}; } };
const vaultOK = () => { try { return safeStorage.isEncryptionAvailable() && !(LINUX && safeStorage.getSelectedStorageBackend && safeStorage.getSelectedStorageBackend() === 'basic_text'); } catch { return false; } };
function vaultSet(name, val) {
  const v = vaultRead();
  if (val == null) delete v[name];
  else { let enc = false; try { enc = safeStorage.isEncryptionAvailable(); } catch { } v[name] = enc ? 'enc:' + safeStorage.encryptString(String(val)).toString('base64') : 'plain:' + Buffer.from(String(val)).toString('base64'); }
  fs.writeFileSync(vaultFile(), JSON.stringify(v), { mode: 0o600 });
}
function vaultGet(name) {
  const v = vaultRead()[name]; if (!v) return null;
  try { return v.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) : Buffer.from(v.slice(6), 'base64').toString(); } catch { return null; }
}

/* ---------- sign-in (Supabase): only the sign-in uses the internet service. Chats, keys, settings and voice stay here. ---------- */
function sbConfig() {
  const e = { url: process.env.PARU_SUPABASE_URL, anonKey: process.env.PARU_SUPABASE_ANON_KEY }; if (e.url && e.anonKey) return e;
  for (const f of [path.join(app.getPath('userData'), 'supabase.json'), path.join(__dirname, 'config', 'supabase.json')]) { try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (c.url && c.anonKey) return c; } catch { } }
  return {};
}
const auth = new Auth({ fetch: (...a) => fetch(...a), config: sbConfig, now: Date.now,
  load: () => { try { return JSON.parse(vaultGet('session') || 'null'); } catch { return null; } }, save: x => vaultSet('session', JSON.stringify(x)), clear: () => vaultSet('session', null) });
const authInfo = () => ({ ...auth.state(), secure: vaultOK(), redirect: 'http://127.0.0.1:53682/callback' });
const CB_PAGE = (ok, msg) => `<!doctype html><meta charset=utf-8><title>Paru</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#0a0912;color:#f4f2ff;font:18px system-ui,sans-serif;text-align:center"><div><div style="font-size:44px">${ok ? '✓' : '✕'}</div><h2 style="margin:8px 0">${ok ? 'You are signed in' : 'Sign-in did not finish'}</h2><p style="opacity:.7">${ok ? 'You can close this tab and go back to Paru.' : String(msg || '').replace(/[<>&]/g, '')}</p></div>`;
function waitCallback(port) {
  return new Promise(resolve => {
    let done = false; const fin = r => { if (done) return; done = true; resolve(r); setTimeout(() => srv.close(), 600); };
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x'); if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      const code = u.searchParams.get('code'), err = u.searchParams.get('error_description') || u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(CB_PAGE(!!code, err)); fin(code ? { code } : { error: err || 'Sign-in was cancelled.' });
    });
    srv.on('error', e => fin({ error: e.code === 'EADDRINUSE' ? 'Another sign-in is already open. Close it and try again.' : String(e) }));
    srv.listen(port, '127.0.0.1');
    setTimeout(() => fin({ error: 'Sign-in timed out. In Supabase, add http://127.0.0.1:53682/callback under Authentication → URL Configuration → Redirect URLs, then try again.' }), 300000);
  });
}
async function openBrowser(url) {
  if (process.env.PARU_TEST_BROWSER) { try { const r = await fetch(url, { redirect: 'manual' }); const loc = r.headers.get('location'); if (loc) fetch(loc).catch(() => { }); } catch { } return; }   // tests: a "browser" that follows the redirect
  shell.openExternal(url);
}
async function googleSignIn() {
  if (!auth.configured()) return { ok: false, error: 'Sign-in is not set up yet.' };
  const redirect = 'http://127.0.0.1:53682/callback', { url, verifier } = await auth.googleStart(redirect), wait = waitCallback(53682);
  await openBrowser(url); const r = await wait;
  if (r.error) return { ok: false, error: r.error };
  return auth.googleFinish(r.code, verifier);
}
function authChanged() { const i = authInfo(); [mainWin, ov].forEach(w => w && !w.isDestroyed() && w.webContents.send('authChanged', i)); }
async function afterSignIn() {                                       // first sign-in on a set-up computer: listening comes back, names are shared with the agent
  const u = auth.state().user; if (u && !cfg().owner) writeCfg({ ...cfg(), owner: u.name });
  if (cfg().onboarded) writeCfg({ ...cfg(), wake: true });
  push(); authChanged(); syncAgentConfig();
}
async function signedOut() { writeCfg({ ...cfg(), wake: false }); push(); authChanged(); if (mainWin) mainWin.loadFile(path.join(__dirname, 'ui', 'setup.html')); }

/* ---------- the AI provider: the key lives in the vault; the agent gets it in memory only ---------- */
async function syncAgentConfig() {
  const c = cfg(); if (!(await up())) return;
  const h = { 'x-key': c.key, 'Content-Type': 'application/json' }, post = (p, b) => fetch(base() + p, { method: 'POST', headers: h, body: JSON.stringify(b), signal: AbortSignal.timeout(8000) }).catch(() => { });
  if (c.provider.id) await post('/voice/provider', { id: c.provider.id, key: vaultGet('providerKey') || '', base: c.provider.base, model: c.provider.model });
  await post('/voice/config', { wake: c.wakeWord, off: c.offWord, assistant: c.assistant, owner: c.owner || (auth.state().user || {}).name || '' });
}

/* ---------- the Python agent ---------- */
const agentHome = () => process.env.PARU_AGENT_DIR || path.join(app.getPath('userData'), 'agent');
const srcAgent = () => fs.existsSync(path.join(__dirname, 'agent', 'agent.py')) ? path.join(__dirname, 'agent') : path.join(process.resourcesPath, 'agent');
const setAgent = (state, msg) => { agentState = { state, msg: msg || '' }; tlog('agent', agentState); mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('agentStatus', agentState); };
const up = async () => { try { return (await fetch(base() + '/health', { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } };

function syncAgentCode() {                                   // the agent lives in a writable folder (the app folder can be read-only, e.g. AppImage)
  const from = srcAgent(), to = agentHome();
  fs.mkdirSync(to, { recursive: true });
  if (path.resolve(from) === path.resolve(to)) return to;
  for (const f of ['agent.py', 'asr.py', 'wake.py', 'requirements.txt', 'env.example.txt']) { try { fs.copyFileSync(path.join(from, f), path.join(to, f)); } catch { } }
  return to;
}
const venvPy = d => path.join(d, '.venv', WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const run = (cmd, args, opts = {}) => new Promise(res => { let out = ''; const p = cp.spawn(cmd, args, { windowsHide: true, ...opts }); p.stdout && p.stdout.on('data', d => out += d); p.stderr && p.stderr.on('data', d => out += d); p.on('error', e => res({ code: -1, out: String(e) })); p.on('close', c => res({ code: c, out })); });
async function findPython() {
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'python', WIN ? 'python.exe' : 'bin/python3');
  if (bundled && fs.existsSync(bundled)) return [bundled, []];
  const cands = WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [c, a] of cands) { const r = await run(c, [...a, '-c', 'import sys;print(sys.version_info[:2]>=(3,9))']); if (r.code === 0 && /True/.test(r.out)) return [c, a]; }
  return null;
}
async function preparePython(dir) {
  if (process.env.PARU_PYTHON) return process.env.PARU_PYTHON;
  const emb = process.resourcesPath && path.join(process.resourcesPath, 'python', 'python.exe');
  if (WIN && emb && fs.existsSync(emb)) return emb;                        // the installer ships its own Python: nothing to install
  const vp = venvPy(dir), stamp = path.join(dir, '.venv', '.req');
  const req = fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8');
  if (fs.existsSync(vp) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === req) return vp;
  const py = await findPython();
  if (!py) { setAgent('nopython', WIN ? 'Python 3.9+ is needed. Install it from python.org (tick "Add to PATH"), then restart Paru.' : 'Python 3.9+ is needed. On Arch: sudo pacman -S python'); return null; }
  setAgent('setup', 'Setting up Paru’s engine (first run only, a few minutes)…');
  if (!fs.existsSync(vp)) { const r = await run(py[0], [...py[1], '-m', 'venv', path.join(dir, '.venv')]); if (r.code !== 0) { setAgent('error', 'Could not create the Python environment: ' + r.out.slice(-300)); return null; } }
  const r = await run(vp, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(dir, 'requirements.txt')]);
  if (r.code !== 0) { setAgent('error', 'Could not install the Python packages (is the internet on?): ' + r.out.slice(-300)); return null; }
  fs.writeFileSync(stamp, req); return vp;
}
function ensureKey(dir) {                                      // first run: make the VOICE_KEY for the person, in both the agent and the app
  const f = path.join(dir, 'env.txt'); let t = '';
  try { t = fs.readFileSync(f, 'utf8'); } catch { try { t = fs.readFileSync(path.join(dir, 'env.example.txt'), 'utf8'); } catch { } }
  const m = t.match(/^VOICE_KEY=(.*)$/m); let k = m && m[1].trim(); const c = cfg();
  if (!k) { k = c.key || require('crypto').randomBytes(9).toString('base64url'); t = m ? t.replace(/^VOICE_KEY=.*$/m, () => 'VOICE_KEY=' + k) : t.replace(/\s*$/, '\n') + 'VOICE_KEY=' + k + '\n'; fs.writeFileSync(f, t); }
  if (c.key !== k) { writeCfg({ ...c, key: k }); push(); }
}
let starting = false;
async function ensureAgent() {
  if (starting) return; starting = true;
  try {
    if (await up()) { setAgent('online'); syncAgentConfig(); return; }
    const c = cfg();
    if (!/localhost|127\.0\.0\.1/.test(c.server)) { setAgent('remote', 'Using the agent at ' + c.server); return; }
    const dir = syncAgentCode(); ensureKey(dir); const py = await preparePython(dir); if (!py) return;
    setAgent('starting', 'Starting…');
    const port = (new URL(c.server).port) || '8000';
    agent = cp.spawn(py, ['-m', 'uvicorn', 'agent:app', '--host', c.lan ? '0.0.0.0' : '127.0.0.1', '--port', port, '--log-level', 'warning'],
      { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    agent.on('error', e => setAgent('error', String(e)));
    const keep = d => { agentLog.push(String(d)); agentLog = agentLog.slice(-60); };
    agent.stdout.on('data', keep); agent.stderr.on('data', keep);
    agent.on('exit', code => { agent = null; if (code) setAgent('error', 'The agent stopped (code ' + code + '). ' + agentLog.slice(-4).join('').slice(-300)); });
    for (let i = 0; i < 90; i++) { if (await up()) { setAgent('online'); syncAgentConfig(); return; } await new Promise(r => setTimeout(r, 1000)); if (!agent) return; }
    setAgent('error', 'The agent did not start in time.');
  } finally { starting = false; }
}
async function killAgent() {
  try { await fetch(base() + '/voice/shutdown', { method: 'POST', headers: { 'x-key': cfg().key }, signal: AbortSignal.timeout(1500) }); } catch { }
  if (agent) { const p = agent; try { WIN ? cp.exec('taskkill /PID ' + p.pid + ' /T /F') : p.kill('SIGTERM'); } catch { } agent = null; }
  for (let i = 0; i < 20 && await up(); i++) await new Promise(r => setTimeout(r, 250));
}
const restartAgent = async () => { await killAgent(); await ensureAgent(); };

/* ---------- autostart (Windows/macOS login item, Linux .desktop file) ---------- */
function setAutostart(on) {
  if (TEST) return;
  try {
    if (LINUX) {
      const f = path.join(os.homedir(), '.config', 'autostart', 'paru.desktop');
      if (!on) { fs.rmSync(f, { force: true }); return; }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const exe = process.env.APPIMAGE || process.execPath;
      fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Paru\nExec="${exe}" --hidden\nX-GNOME-Autostart-enabled=true\nTerminal=false\n`);
    } else app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  } catch { }
}

/* ---------- windows ---------- */
const ready = () => cfg().onboarded && auth.state().signedIn;
const showMain = () => { if (mainWin.isMinimized()) mainWin.restore(); mainWin.show(); mainWin.focus(); };
const talk = () => ov && ov.webContents.send('talk');
const goto_ = sec => { showMain(); mainWin.webContents.send('goto', sec); };
const bg = t => t === 'light' ? '#f6f4fb' : '#0b0a12';
const lanIP = () => { for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) return a.address; return ''; };
const setListening = on => { writeCfg({ ...cfg(), wake: on }); push(); };
function refreshTray() {
  if (!tray) return; const c = cfg();
  tray.setToolTip(c.wake ? 'Paru: listening for “Hello Paru”' : 'Paru is off');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Paru', click: showMain }, { label: 'Talk now', click: talk },
    { label: c.wake ? 'Turn Paru off (stop listening)' : 'Turn Paru on', click: () => setListening(!cfg().wake) },
    { label: 'Restart agent', click: restartAgent }, { type: 'separator' }, { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }]));
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => mainWin && showMain());
app.whenReady().then(async () => {
  cfgPath = path.join(app.getPath('userData'), 'cfg.json');
  session.defaultSession.setPermissionRequestHandler((w, p, cb) => cb(p === 'media'));
  session.defaultSession.setPermissionCheckHandler((w, p) => p === 'media');
  const preload = path.join(__dirname, 'preload.js'), icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png'));
  mainWin = new BrowserWindow({ width: 1100, height: 720, minWidth: 860, minHeight: 580, show: false, title: 'Paru', frame: false, backgroundColor: bg(cfg().theme), icon, webPreferences: { preload } });
  const lock = w => { w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url) && !TEST) shell.openExternal(url); return { action: 'deny' }; }); w.webContents.on('will-navigate', (e, u) => { if (!u.startsWith('file://')) e.preventDefault(); }); };
  lock(mainWin);
  mainWin.setMenuBarVisibility(false); mainWin.loadFile(path.join(__dirname, 'ui', ready() ? 'app.html' : 'setup.html'));
  mainWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); mainWin.hide(); } });
  mainWin.on('enter-full-screen', () => mainWin.webContents.send('fs', true)); mainWin.on('leave-full-screen', () => mainWin.webContents.send('fs', false));
  mainWin.webContents.on('did-finish-load', () => mainWin.webContents.send('agentStatus', agentState));
  const wa = screen.getPrimaryDisplay().workArea, W = 470, H = 440;
  ov = new BrowserWindow({ width: W, height: H, x: wa.x + wa.width - W - 10, y: wa.y + 8, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false, show: false, hasShadow: false,
    webPreferences: { preload, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  ov.setAlwaysOnTop(true, 'screen-saver'); ov.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  tray = new Tray(icon.resize({ width: 22, height: 22 })); tray.on('click', showMain); refreshTray();
  const okKey = globalShortcut.register('Control+Shift+Space', talk); tlog('shortcut', { ok: okKey });
  setAutostart(cfg().autostart);
  if (TEST) {                                                // test hooks: renderer errors + screenshots
    for (const [n, w] of [['main', mainWin], ['overlay', ov]]) w.webContents.on('console-message', (e, lvl, msg, line, src) => { if (lvl >= 2) tlog('console', { win: n, msg, src: String(src).split('/').pop(), line }); });
    if (process.env.PARU_SHOT) setTimeout(async () => { try { fs.writeFileSync(path.join(process.env.PARU_SHOT, 'main.png'), (await mainWin.webContents.capturePage()).toPNG()); } catch { } }, +process.env.PARU_SHOT_MS || 9000);
  }
  if (!ready() || !process.argv.includes('--hidden')) showMain();
  ensureAgent();
  auth.refresh().then(r => { if (r && r.signedOut) signedOut(); }); setInterval(() => auth.refresh().then(r => { if (r && r.signedOut) signedOut(); }), 10 * 60 * 1000);
});
app.on('window-all-closed', () => { });
app.on('will-quit', () => { globalShortcut.unregisterAll(); try { agent && agent.kill(); } catch { } });

/* ---------- window buttons ---------- */
ipcMain.on('win', (e, a) => { const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (a === 'close') { if (w === mainWin && cfg().closeQuits) { app.isQuitting = true; app.quit(); } else w.hide(); } else if (a === 'min') w.minimize(); else if (a === 'full') w.setFullScreen(!w.isFullScreen()); else if (a === 'full-exit' && w.isFullScreen()) w.setFullScreen(false); });

/* ---------- overlay / talk / voice training / engine status ---------- */
ipcMain.on('enroll', () => ov.webContents.send('enroll'));
ipcMain.on('enrollDone', (e, r) => mainWin.webContents.send('enrollDone', r));
ipcMain.on('openMain', (e, sec) => goto_(sec || 'general'));
ipcMain.on('engineStatus', (e, s) => { tlog('engine', s); mainWin && !mainWin.isDestroyed() && mainWin.webContents.send('engineStatus', s); });
ipcMain.handle('winState', () => mainWin.isFullScreen());
ipcMain.handle('agentStatus', () => agentState);
ipcMain.handle('lanInfo', () => ({ ip: lanIP(), port: (new URL(cfg().server).port) || '8000' }));
ipcMain.on('ov', (e, s) => { tlog('ov', { show: !!s }); s ? ov.showInactive() : ov.hide();
  if (s && TEST && process.env.PARU_SHOT) setTimeout(async () => { try { fs.writeFileSync(path.join(process.env.PARU_SHOT, 'orb.png'), (await ov.webContents.capturePage()).toPNG()); } catch { } }, 900); });
ipcMain.on('talk', talk);

/* ---------- sign-in, AI key, setup ---------- */
ipcMain.handle('auth:state', () => authInfo());
ipcMain.handle('auth:google', async () => { const r = await googleSignIn(); if (r.ok) await afterSignIn(); return { ...r, ...authInfo() }; });
ipcMain.handle('auth:signIn', async (e, a) => { const r = await auth.signIn(a.email, a.password); if (r.ok) await afterSignIn(); return { ...r, ...authInfo() }; });
ipcMain.handle('auth:signUp', async (e, a) => { const r = await auth.signUp(a.email, a.password); if (r.ok && !r.confirm) await afterSignIn(); return { ...r, ...authInfo() }; });
ipcMain.handle('auth:signOut', async () => { await auth.signOut(); await signedOut(); return authInfo(); });
ipcMain.handle('auth:setConfig', (e, c) => {
  const url = String(c.url || '').trim().replace(/\/$/, ''), key = String(c.anonKey || '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) return { ok: false, error: 'The project URL looks like https://abcdxyz.supabase.co' };
  if (key.length < 30) return { ok: false, error: 'Paste the "anon public" key from Supabase, Project Settings, API.' };
  fs.writeFileSync(path.join(app.getPath('userData'), 'supabase.json'), JSON.stringify({ url, anonKey: key })); return { ok: true, ...authInfo() };
});
ipcMain.handle('provider:save', async (e, p) => {
  if (p.key) vaultSet('providerKey', p.key); else if (p.id && p.keyless) vaultSet('providerKey', null);
  writeCfg({ ...cfg(), provider: { id: p.id, base: p.base || '', model: p.model || '' } }); push(); await syncAgentConfig(); return { ok: true };
});
ipcMain.handle('provider:status', () => { const c = cfg(); return { ...c.provider, hasKey: !!vaultGet('providerKey'), secure: vaultOK() }; });
ipcMain.handle('profile:save', async (e, p) => { writeCfg({ ...cfg(), ...p }); push(); await syncAgentConfig(); return true; });
ipcMain.on('setup:done', () => { writeCfg({ ...cfg(), onboarded: true, wake: true }); push(); mainWin.loadFile(path.join(__dirname, 'ui', 'app.html')); syncAgentConfig(); });
ipcMain.on('setup:open', (e, step) => { mainWin.loadFile(path.join(__dirname, 'ui', 'setup.html'), { query: { step: step || 'voice', back: '1' } }); });
ipcMain.on('setup:back', () => mainWin.loadFile(path.join(__dirname, 'ui', 'app.html')));

/* ---------- config ---------- */
ipcMain.handle('cfg', () => cfg());
ipcMain.handle('setCfg', (e, c) => {
  const cur = cfg(); if (c.perms) c.perms = normPerms({ ...cur.perms, ...c.perms });
  writeCfg({ ...cur, ...c }); tlog('setCfg', { c: Object.keys(c).reduce((o, k) => (k === 'voiceprint' ? o : { ...o, [k]: c[k] }), {}) });
  if ('autostart' in c) setAutostart(c.autostart);
  if ('lan' in c && c.lan !== cur.lan) setTimeout(restartAgent, 200);
  return push();
});
ipcMain.handle('envRead', () => { const d = agentHome(); for (const f of ['env.txt', 'env.example.txt']) { try { return fs.readFileSync(path.join(d, f), 'utf8'); } catch { } } try { return fs.readFileSync(path.join(srcAgent(), 'env.example.txt'), 'utf8'); } catch { return ''; } });
ipcMain.handle('envWrite', async (e, t) => { const d = syncAgentCode(); fs.writeFileSync(path.join(d, 'env.txt'), t, 'utf8'); await restartAgent(); return true; });
ipcMain.handle('restart', async () => { await restartAgent(); return true; });
ipcMain.handle('api', async (e, { p, method, body, type, raw }) => {
  try {
    const r = await fetch(base() + p, { method: method || 'GET', headers: { 'x-key': cfg().key, 'Content-Type': type || 'application/json' }, body: body == null ? undefined : (typeof body === 'string' ? body : Buffer.from(body)), signal: AbortSignal.timeout(40000) });
    if (raw) { tlog('tts', { ok: r.ok, bytes: +r.headers.get('content-length') || 0, via: r.headers.get('x-fallback') || 'edge/cache' }); if (!r.ok) return { error: 'tts' }; return { audio: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || 'audio/mpeg').split(';')[0] }; }
    return await r.json();
  } catch { return { error: 'unreachable' }; }
});

/* ---------- actions the assistant may do (each one checks your permission) ---------- */
const FOLDERS = { pictures: ['pictures', 'photos'], photos: ['pictures', 'photos'], videos: ['videos', 'photos'], downloads: ['downloads', 'files'], documents: ['documents', 'files'], desktop: ['desktop', 'files'] };
const NEVER = /^(explorer|winlogon|csrss|svchost|lsass|services|system|wininit|smss|dwm|paru|systemd|init|sshd|Xorg|Xwayland|gnome-shell|plasmashell|kwin\w*|pipewire|pulseaudio|dbus-daemon|NetworkManager|electron)(\.exe)?$/i;
const ALIAS_WIN = { whatsapp: 'whatsapp:', settings: 'ms-settings:', calendar: 'outlookcal:', mail: 'outlookmail:', calculator: 'calc', camera: 'microsoft.windows.camera:', store: 'ms-windows-store:', teams: 'msteams:', spotify: 'spotify:', telegram: 'tg:', 'file explorer': 'explorer', explorer: 'explorer', 'task manager': 'taskmgr', paint: 'mspaint', word: 'winword', excel: 'excel', powerpoint: 'powerpnt', chrome: 'chrome', edge: 'msedge', firefox: 'firefox', 'vs code': 'code', vscode: 'code', terminal: 'wt', cmd: 'cmd', notepad: 'notepad' };
const ALIAS_LINUX = { chrome: ['google-chrome-stable', 'google-chrome', 'chromium'], firefox: ['firefox'], 'vs code': ['code', 'code-oss'], vscode: ['code', 'code-oss'], calculator: ['gnome-calculator', 'kcalc', 'qalculate-gtk'], terminal: ['kitty', 'alacritty', 'gnome-terminal', 'konsole', 'xterm'], 'file manager': ['nautilus', 'dolphin', 'thunar', 'nemo'], files: ['nautilus', 'dolphin', 'thunar', 'nemo'], spotify: ['spotify'], telegram: ['telegram-desktop'], settings: ['gnome-control-center', 'systemsettings'], notepad: ['gedit', 'kate', 'mousepad'], 'text editor': ['gedit', 'kate', 'mousepad'], whatsapp: ['whatsapp-for-linux', 'whatsdesk'] };
const EXE = { whatsapp: 'WhatsApp.exe', chrome: 'chrome.exe', edge: 'msedge.exe', firefox: 'firefox.exe', spotify: 'Spotify.exe', telegram: 'Telegram.exe', teams: 'ms-teams.exe', word: 'WINWORD.EXE', excel: 'EXCEL.EXE', powerpoint: 'POWERPNT.EXE', notepad: 'notepad.exe', calculator: 'CalculatorApp.exe', 'vs code': 'Code.exe', vscode: 'Code.exe', paint: 'mspaint.exe' };
const PROC_LINUX = { chrome: 'chrome', firefox: 'firefox', 'vs code': 'code', vscode: 'code', calculator: 'gnome-calculator', spotify: 'spotify', telegram: 'telegram-desktop' };
const LABEL = { apps: 'open and close programs', browser: 'open websites', search: 'search the web', files: 'open folders and save notes', photos: 'open Pictures and Videos', download: 'download files', screenshot: 'take screenshots', system: 'lock the screen' };
const pending = {};
function askPermission(cap, what) {                                   // shown on the orb AND asked out loud; answered by voice or by clicking
  return new Promise(resolve => {
    const id = crypto.randomUUID(); pending[id] = resolve; tlog('ask', { cap, what });
    ov.webContents.send('askPerm', { id, cap, what }); if (!ov.isVisible()) ov.showInactive();
    setTimeout(() => { if (pending[id]) { delete pending[id]; resolve('no'); } }, 60000);
  });
}
ipcMain.on('permReply', (e, { id, choice }) => { const r = pending[id]; if (r) { delete pending[id]; r(choice); } });
const setPerm = (cap, v) => { const c = cfg(); writeCfg({ ...c, perms: { ...c.perms, [cap]: v } }); tlog('perm', { cap, v }); push(); };
/* The first time each KIND of task is used, Paru asks. "Always allow" remembers; "Allow once" asks again next time; "Don't allow" is respected. */
async function gate(cap, what) {
  const st = cfg().perms[cap];
  if (st === 'allow') return null;
  if (st === 'deny') return 'denied';
  const a = await askPermission(cap, what);
  if (a === 'always') { setPerm(cap, 'allow'); return null; }
  if (a === 'once') return null;
  if (a === 'never') { setPerm(cap, 'deny'); return 'denied'; }
  return 'denied';
}
const which = n => (process.env.PATH || '').split(path.delimiter).some(d => { try { fs.accessSync(path.join(d, n), fs.constants.X_OK); return true; } catch { return false; } });
const launchLinux = name => { const k = name.toLowerCase(), list = ALIAS_LINUX[k] || [name.replace(/\s+/g, '-').toLowerCase()]; const exe = list.find(which);
  if (exe) { const p = cp.spawn(exe, [], { detached: true, stdio: 'ignore' }); p.on('error', () => { }); p.unref(); return true; }
  const p = cp.spawn('gtk-launch', [name.replace(/\s+/g, '-').toLowerCase()], { detached: true, stdio: 'ignore' }); p.on('error', () => { }); p.unref(); return which('gtk-launch'); };
const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const browse = u => TEST ? tlog('browse', { u }) : shell.openExternal(u);
ipcMain.handle('act', async (e, { type, target }) => {
  target = String(target || '').trim(); tlog('act', { type, target });
  try {
    if (type === 'open_app') {
      if (!/^[\w .:\/\\-]{1,120}$/.test(target)) return 'blocked';
      if (/^https?:\/\//.test(target) || /^[\w-]+\.[a-z]{2,}$/i.test(target)) { const n = await gate('browser', 'open the website ' + target); if (n) return n; browse(/^https?/.test(target) ? target : 'https://' + target); return 'ok'; }
      const n = await gate('apps', 'open ' + target); if (n) return n;
      if (TEST) { tlog('launch', { target }); return 'ok'; }
      if (WIN) cp.exec('start "" "' + (ALIAS_WIN[target.toLowerCase()] || target) + '"', { shell: 'cmd.exe' }); else if (!launchLinux(target)) return 'notfound';
      return 'ok'; }
    if (type === 'close_app') {
      if (!/^[\w .-]{1,60}$/.test(target) || NEVER.test(target)) return 'blocked';
      const n = await gate('apps', 'close ' + target); if (n) return n;
      if (TEST) { tlog('close', { target }); return 'ok'; }
      if (WIN) { const exe = EXE[target.toLowerCase()] || (/\.exe$/i.test(target) ? target : target.replace(/\s+/g, '') + '.exe'); return await new Promise(r => cp.execFile('taskkill', ['/IM', exe, '/F'], err => r(err ? 'notfound' : 'ok'))); }
      const pn = PROC_LINUX[target.toLowerCase()] || target.replace(/\s+/g, '-').toLowerCase(); if (NEVER.test(pn)) return 'blocked';
      return await new Promise(r => cp.execFile('pkill', ['-x', pn], err => r(err ? 'notfound' : 'ok'))); }
    if (type === 'open_url') { const u = /^https?:\/\//i.test(target) ? target : 'https://' + target; if (!/^https?:\/\/[\w.-]+/i.test(u)) return 'blocked';
      const n = await gate('browser', 'open the website ' + target); if (n) return n; browse(u); return 'ok'; }
    if (type === 'web_search') { if (!target) return 'blocked'; const n = await gate('search', 'search the web for "' + target + '"'); if (n) return n; browse('https://www.google.com/search?q=' + encodeURIComponent(target)); return 'ok'; }
    if (type === 'open_folder') { const f = FOLDERS[target.toLowerCase()]; if (!f) return 'blocked'; const n = await gate(f[1], 'open your ' + target + ' folder'); if (n) return n;
      if (TEST) { tlog('folder', { target }); return 'ok'; } await shell.openPath(app.getPath(f[0])); return 'ok'; }
    if (type === 'download') { if (!/^https:\/\/[\w.-]+\/\S*$/i.test(target)) return 'blocked'; const n = await gate('download', 'download ' + target); if (n) return n;
      const r = await fetch(target, { signal: AbortSignal.timeout(120000) }); if (!r.ok) return 'failed'; const len = +r.headers.get('content-length') || 0; if (len > 500e6) return 'toobig';
      const name = decodeURIComponent(new URL(target).pathname.split('/').pop() || 'download').replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'download';
      const dest = path.join(app.getPath('downloads'), name); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); if (!TEST) shell.showItemInFolder(dest); return 'ok'; }
    if (type === 'new_note') { if (!target) return 'blocked'; const n = await gate('files', 'save a note on this computer'); if (n) return n;
      const dir = path.join(app.getPath('documents'), 'Paru Notes'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'Note ' + stamp() + '.txt'); fs.writeFileSync(f, target.slice(0, 20000) + '\n'); tlog('note', { f }); return 'ok'; }
    if (type === 'screenshot') { const n = await gate('screenshot', 'take a screenshot'); if (n) return n;
      const d = screen.getPrimaryDisplay(), src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: d.size }); if (!src[0]) return 'failed';
      const dir = path.join(app.getPath('pictures'), 'Paru Screenshots'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'Screenshot ' + stamp() + '.png'); fs.writeFileSync(f, src[0].thumbnail.toPNG()); tlog('screenshot', { f }); return 'ok'; }
    if (type === 'lock_screen') { const n = await gate('system', 'lock the screen'); if (n) return n; if (TEST) { tlog('lock', {}); return 'ok'; }
      if (WIN) { cp.exec('rundll32.exe user32.dll,LockWorkStation'); return 'ok'; }
      for (const c of [['loginctl', ['lock-session']], ['xdg-screensaver', ['lock']], ['gnome-screensaver-command', ['-l']], ['qdbus', ['org.freedesktop.ScreenSaver', '/ScreenSaver', 'Lock']]]) if (which(c[0])) { cp.spawn(c[0], c[1], { detached: true, stdio: 'ignore' }).unref(); return 'ok'; }
      return 'failed'; }
  } catch { return 'failed'; }
  return 'blocked';
});
