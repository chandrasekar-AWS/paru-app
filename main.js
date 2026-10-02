const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, dialog, shell, nativeImage, session } = require('electron');
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');

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
const PERMS = { mic: false, contacts: false, photos: false, calls: false, apps: false, files: false, search: false, download: false, upload: false, reply: false, update: false, onlineCalls: false, browser: false };
const DEF = () => ({
  server: 'http://127.0.0.1:8000', key: '', lang: 'auto', wake: true, voice: 'en-IN-NeerjaNeural', rate: 0, lan: false, autostart: true,
  theme: 'dark', accent: '#8a6bff', fontSize: 'normal', orbSize: 'small', closeQuits: false, interrupt: true, voiceLock: false, voiceprint: null, vpVer: 0, voiceThr: 0.9,
  askEach: true, autoHide: 0, onboarded: false, perms: { ...PERMS }
});
const cfg = () => { try { const c = { ...DEF(), ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; c.perms = { ...PERMS, ...c.perms }; return c; } catch { return DEF(); } };
const writeCfg = c => fs.writeFileSync(cfgPath, JSON.stringify(c));
const base = () => cfg().server.replace(/\/$/, '');
const push = () => { const n = cfg(); [mainWin, ov].forEach(w => w && !w.isDestroyed() && w.webContents.send('cfg', n)); refreshTray(); return n; };

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
    if (await up()) { setAgent('online'); return; }
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
    for (let i = 0; i < 90; i++) { if (await up()) { setAgent('online'); return; } await new Promise(r => setTimeout(r, 1000)); if (!agent) return; }
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
  mainWin.setMenuBarVisibility(false); mainWin.loadFile('ui/app.html');
  mainWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); mainWin.hide(); } });
  mainWin.on('enter-full-screen', () => mainWin.webContents.send('fs', true)); mainWin.on('leave-full-screen', () => mainWin.webContents.send('fs', false));
  mainWin.webContents.on('did-finish-load', () => mainWin.webContents.send('agentStatus', agentState));
  const wa = screen.getPrimaryDisplay().workArea, W = 400, H = 360;
  ov = new BrowserWindow({ width: W, height: H, x: wa.x + wa.width - W - 10, y: wa.y + 8, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false, show: false, hasShadow: false,
    webPreferences: { preload, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  ov.setAlwaysOnTop(true, 'screen-saver'); ov.loadFile('ui/overlay.html');
  tray = new Tray(icon.resize({ width: 22, height: 22 })); tray.on('click', showMain); refreshTray();
  const okKey = globalShortcut.register('Control+Shift+Space', talk); tlog('shortcut', { ok: okKey });
  setAutostart(cfg().autostart);
  if (TEST) {                                                // test hooks: renderer errors + screenshots
    for (const [n, w] of [['main', mainWin], ['overlay', ov]]) w.webContents.on('console-message', (e, lvl, msg, line, src) => { if (lvl >= 2) tlog('console', { win: n, msg, src: String(src).split('/').pop(), line }); });
    if (process.env.PARU_SHOT) setTimeout(async () => { try { fs.writeFileSync(path.join(process.env.PARU_SHOT, 'main.png'), (await mainWin.webContents.capturePage()).toPNG()); } catch { } }, +process.env.PARU_SHOT_MS || 9000);
  }
  if (!cfg().key || !cfg().onboarded || !process.argv.includes('--hidden')) showMain();
  ensureAgent();
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

/* ---------- config ---------- */
ipcMain.handle('cfg', () => cfg());
ipcMain.handle('setCfg', (e, c) => {
  const cur = cfg(); if (c.perms) c.perms = { ...cur.perms, ...c.perms };
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
const ask = async msg => { if (!cfg().askEach) return true; const r = await dialog.showMessageBox({ type: 'question', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1, title: 'Paru', message: msg }); return r.response === 0; };
const need = k => cfg().perms[k] ? null : 'no-permission:' + k;
const which = n => (process.env.PATH || '').split(path.delimiter).some(d => { try { fs.accessSync(path.join(d, n), fs.constants.X_OK); return true; } catch { return false; } });
const launchLinux = name => { const k = name.toLowerCase(), list = ALIAS_LINUX[k] || [name.replace(/\s+/g, '-').toLowerCase()]; const exe = list.find(which);
  if (exe) { const p = cp.spawn(exe, [], { detached: true, stdio: 'ignore' }); p.on('error', () => { }); p.unref(); return true; }
  const p = cp.spawn('gtk-launch', [name.replace(/\s+/g, '-').toLowerCase()], { detached: true, stdio: 'ignore' }); p.on('error', () => { }); p.unref(); return which('gtk-launch'); };
ipcMain.handle('act', async (e, { type, target }) => {
  target = String(target || '').trim(); const browse = u => shell.openExternal(u); tlog('act', { type, target });
  try {
    if (type === 'open_app') { let n = need('apps'); if (n) return n;
      if (!/^[\w .:\/\\-]{1,120}$/.test(target)) return 'blocked';
      if (/^https?:\/\//.test(target) || /^[\w-]+\.[a-z]{2,}$/i.test(target)) { if (n = need('browser')) return n; browse(/^https?/.test(target) ? target : 'https://' + target); return 'ok'; }
      if (!await ask('Paru wants to open: ' + target)) return 'denied';
      if (WIN) cp.exec('start "" "' + (ALIAS_WIN[target.toLowerCase()] || target) + '"', { shell: 'cmd.exe' }); else if (!launchLinux(target)) return 'notfound';
      return 'ok'; }
    if (type === 'close_app') { const n = need('apps'); if (n) return n;
      if (!/^[\w .-]{1,60}$/.test(target) || NEVER.test(target)) return 'blocked';
      if (!await ask('Paru wants to close: ' + target)) return 'denied';
      if (WIN) { const exe = EXE[target.toLowerCase()] || (/\.exe$/i.test(target) ? target : target.replace(/\s+/g, '') + '.exe'); return await new Promise(r => cp.execFile('taskkill', ['/IM', exe, '/F'], err => r(err ? 'notfound' : 'ok'))); }
      const pn = PROC_LINUX[target.toLowerCase()] || target.replace(/\s+/g, '-').toLowerCase(); if (NEVER.test(pn)) return 'blocked';
      return await new Promise(r => cp.execFile('pkill', ['-x', pn], err => r(err ? 'notfound' : 'ok'))); }
    if (type === 'open_url') { const n = need('browser'); if (n) return n; const u = /^https?:\/\//i.test(target) ? target : 'https://' + target; if (!/^https?:\/\/[\w.-]+/i.test(u)) return 'blocked'; browse(u); return 'ok'; }
    if (type === 'web_search') { const n = need('search'); if (n) return n; if (!target) return 'blocked'; browse('https://www.google.com/search?q=' + encodeURIComponent(target)); return 'ok'; }
    if (type === 'open_folder') { const f = FOLDERS[target.toLowerCase()]; if (!f) return 'blocked'; const n = need(f[1]); if (n) return n; await shell.openPath(app.getPath(f[0])); return 'ok'; }
    if (type === 'download') { const n = need('download'); if (n) return n; if (!/^https:\/\/[\w.-]+\/\S*$/i.test(target)) return 'blocked'; if (!await ask('Paru wants to download:\n' + target)) return 'denied';
      const r = await fetch(target, { signal: AbortSignal.timeout(120000) }); if (!r.ok) return 'failed'; const len = +r.headers.get('content-length') || 0; if (len > 500e6) return 'toobig';
      const name = decodeURIComponent(new URL(target).pathname.split('/').pop() || 'download').replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'download';
      const dest = path.join(app.getPath('downloads'), name); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); shell.showItemInFolder(dest); return 'ok'; }
  } catch { return 'failed'; }
  return 'blocked';
});
