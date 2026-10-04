// Paru desktop shell: starts the Python engine, shows the app window, the floating orb, a tray icon and a global hotkey.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, session, shell, globalShortcut, nativeImage, Notification } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');

const PACKAGED = app.isPackaged || process.env.PARU_TEST_PACKAGED === '1';
function resolveRoot() {
  const cands = [path.resolve(__dirname, '..'), path.join(process.resourcesPath || '', 'paru'), path.resolve(app.getAppPath(), '..')];
  return cands.find(c => fs.existsSync(path.join(c, 'agent', 'server.py'))) || null;
}
const ROOT = resolveRoot();
const HOME = process.env.PARU_HOME || path.join(os.homedir(), '.paru');
const TOKEN = crypto.randomBytes(24).toString('base64url');
const START_HIDDEN = process.argv.includes('--hidden');
let port, engine, win, orbWin, tray, quitting = false, orbWanted = false, orbSize = 150, orbEnabled = true;

process.on('uncaughtException', e => { log('uncaught', e && e.stack || e); try { showError('Paru hit an unexpected error', String(e && e.stack || e)); } catch {} });
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showMain());

/* ------------------------------------------------------------ python engine */
function findPython() {
  const venv = process.platform === 'win32' ? path.join(HOME, 'venv', 'Scripts', 'python.exe') : path.join(HOME, 'venv', 'bin', 'python');
  const cands = [process.env.PARU_PYTHON, fs.existsSync(venv) && venv, 'python3', 'python', process.platform === 'win32' && 'py'].filter(Boolean);
  for (const c of cands) {
    const r = spawnSync(c, process.platform === 'win32' && c === 'py' ? ['-3', '-c', 'import sys;print(sys.version_info[:2])'] : ['-c', 'import sys;assert sys.version_info>=(3,9)'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}
function hasCore(py) { return spawnSync(py, ['-c', 'import fastapi,uvicorn,websockets,httpx,numpy'], { stdio: 'ignore' }).status === 0; }
function log(...a) { try { fs.mkdirSync(HOME, { recursive: true }); fs.appendFileSync(path.join(HOME, 'paru.log'), `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch {} }

function ensureEnv(splash) {
  let py = findPython();
  if (!py) return null;
  if (hasCore(py)) return py;
  splash('Setting up Paru for the first time (about a minute)...');
  const venvDir = path.join(HOME, 'venv');
  const r1 = spawnSync(py, py === 'py' ? ['-3', '-m', 'venv', venvDir] : ['-m', 'venv', venvDir], { encoding: 'utf8' });
  log('venv', r1.status, r1.stderr);
  const vpy = process.platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python');
  const use = fs.existsSync(vpy) ? vpy : py;
  const r2 = spawnSync(use, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(ROOT || '.', 'requirements.txt')], { encoding: 'utf8' });
  log('pip core', r2.status, (r2.stderr || '').slice(-500));
  if (r2.status !== 0 || !hasCore(use)) return null;
  // optional voice packages install in the background; the engine detects them without a restart
  const opt = spawn(use, ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', path.join(ROOT || '.', 'requirements-optional.txt')], { stdio: 'ignore', detached: true });
  opt.unref();
  return use;
}

let lastHealthErr = '';
function freePort() { return new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }
async function waitHealthy(ms = 30000, failed = () => null) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return true; } catch (e) { lastHealthErr = e.cause ? String(e.cause.message || e.cause) : String(e.message); }
    if (failed()) return false;
    if (engine && engine.exitCode !== null) return false;
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}
async function startEngine(py) {
  if (!ROOT) throw new Error('Could not find the Paru engine files (agent/server.py). Run Paru from the cloned repo: cd ~/paru-app/electron && electron .');
  port = await freePort();
  const args = [...(py === 'py' ? ['-3'] : []), '-m', 'agent.server', '--port', String(port)];
  log('starting engine:', py, args.join(' '), 'cwd=' + ROOT);
  let tail = '', spawnErr = null;
  engine = spawn(py === 'py' ? 'py' : py, args, { cwd: ROOT, env: { ...process.env, PARU_TOKEN: TOKEN, PARU_HOME: HOME, PYTHONUNBUFFERED: '1' }, windowsHide: true });
  engine.on('error', e => { spawnErr = e; log('engine spawn error', e.message); });
  engine.stdout.on('data', d => log('engine:', d.toString().trim()));
  engine.stderr.on('data', d => { tail = (tail + d.toString()).slice(-1500); log('engine!', d.toString().trim()); });
  engine.on('exit', code => { log('engine exit', code); if (!quitting && code) { engine = null; showError(`Paru's engine stopped (code ${code}).`, tail); } });
  const ok = await waitHealthy(30000, () => spawnErr);
  if (!ok) throw new Error(spawnErr ? `Could not start Python (${py}): ${spawnErr.message}` : (tail || `The engine did not respond on port ${port} (${lastHealthErr || 'no error'}). See ${path.join(HOME, 'paru.log')}`));
}

/* ------------------------------------------------------------ windows */
const bg = '#08061a';
function showError(title, detail) {
  const w = win || new BrowserWindow({ width: 760, height: 480, backgroundColor: bg, title: 'Paru' });
  win = w; const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="background:${bg};color:#fff;font:15px system-ui;padding:32px"><h2>${esc(title)}</h2>
    <p>Last lines from the engine (also saved to ${esc(path.join(HOME, 'paru.log'))}):</p><pre style="white-space:pre-wrap;background:#14102b;padding:14px;border-radius:10px;max-height:260px;overflow:auto">${esc(detail || 'No output.')}</pre>
    <p>Fix: install Python 3.9+ and run <code>python -m pip install -r requirements.txt</code> in the Paru folder, then reopen Paru.</p>`));
  w.show();
}
function splash(msg) {
  if (!win) return;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="background:${bg};color:#fff;font:18px system-ui;display:grid;place-items:center;height:100vh;margin:0"><div>${msg}</div>`));
}
function createMain() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 760, minHeight: 560, frame: false, backgroundColor: bg, show: false, title: 'Paru',
    icon: ROOT ? path.join(ROOT, 'ui', 'assets', 'icon.png') : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`) && !url.startsWith('data:')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.once('ready-to-show', () => { if (!START_HIDDEN) win.show(); });
}
function showMain() { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }

function placeOrb() {
  if (!orbWin) return;
  const wa = screen.getPrimaryDisplay().workArea, s = Math.round(orbSize * 1.25);
  orbWin.setBounds({ x: wa.x + wa.width - s - 12, y: wa.y + 12, width: s, height: s });
}
function createOrb() {
  orbWin = new BrowserWindow({ width: 200, height: 200, transparent: true, frame: false, show: false, resizable: false, movable: false, focusable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload-orb.js'), contextIsolation: true, backgroundThrottling: false } });
  orbWin.setAlwaysOnTop(true, 'screen-saver'); orbWin.setIgnoreMouseEvents(true); orbWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  orbWin.loadURL(`http://127.0.0.1:${port}/orb.html`); placeOrb();
}
function applyOrb() { if (!orbWin) return; if (orbWanted && orbEnabled) { placeOrb(); orbWin.showInactive(); } else orbWin.hide(); }
ipcMain.on('orb-visible', (_e, v) => { orbWanted = v; applyOrb(); });
ipcMain.on('orb-size', (_e, px, enabled) => { orbSize = px || 150; orbEnabled = enabled; placeOrb(); applyOrb(); });

ipcMain.on('win', (_e, a) => { if (!win) return; if (a === 'close') win.hide(); else if (a === 'min') win.minimize(); else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('autostart', (_e, on) => {
  if (process.platform === 'linux') {
    const f = path.join(os.homedir(), '.config', 'autostart', 'paru.desktop');
    if (on) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=Paru\nExec="${process.execPath}" "${app.getAppPath()}" --hidden\nX-GNOME-Autostart-enabled=true\n`); }
    else try { fs.unlinkSync(f); } catch {}
  } else app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
});

/* ------------------------------------------------------------ tray + hotkey */
async function engineCall(p) { try { await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'x-paru-token': TOKEN } }); } catch {} }
let talking = false;
function toggleTalk() { talking = !talking; engineCall(`/api/listen/${talking ? 'activate' : 'deactivate'}`); }
function createTray() {
  const img = nativeImage.createFromPath(path.join(ROOT || '', 'ui', 'assets', 'icon.png')).resize({ width: 22, height: 22 });
  tray = new Tray(img); tray.setToolTip('Paru');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Paru', click: showMain }, { label: 'Talk to Paru', click: toggleTalk }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
  tray.on('click', showMain);
}

/* ------------------------------------------------------------ boot */
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'audioCapture', 'notifications', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'audioCapture', 'notifications'].includes(perm));
  createMain(); win.show(); splash('Starting Paru...');
  const py = ensureEnv(splash);
  if (!py) return showError('Python 3.9 or newer is needed', 'Install Python from python.org (tick "Add to PATH"), then reopen Paru.');
  try { await startEngine(py); } catch (e) { return showError("Paru's engine could not start", String(e.message || e)); }
  createOrb(); createTray(); screen.on('display-metrics-changed', placeOrb);
  win.loadURL(`http://127.0.0.1:${port}/`);
  if (START_HIDDEN) win.hide();
  try { globalShortcut.register('CommandOrControl+Shift+Space', toggleTalk); } catch {}
  if (process.env.PARU_SHOTS) runShots(JSON.parse(fs.readFileSync(process.env.PARU_SHOTS, 'utf8')));
});
app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (engine) try { engine.kill(); } catch {} });
app.on('will-quit', () => { if (engine) try { engine.kill(); } catch {} });

/* test hook: PARU_SHOTS=/path/steps.json -> [{js, wait, file, target:"main|orb"}] then quit */
async function runShots(steps) {
  for (const s of steps) {
    const w = s.target === 'orb' ? orbWin : win;
    if (s.js) { try { await w.webContents.executeJavaScript(s.js); } catch (e) { fs.appendFileSync(process.env.PARU_SHOT_LOG || '/tmp/shots.log', 'JS ERR ' + e.message + '\n'); } }
    await new Promise(r => setTimeout(r, s.wait || 600));
    if (s.file) { const img = await w.webContents.capturePage(); fs.writeFileSync(s.file, img.toPNG()); }
    if (s.eval) { const v = await w.webContents.executeJavaScript(s.eval); fs.appendFileSync(process.env.PARU_SHOT_LOG || '/tmp/shots.log', s.eval.slice(0, 50) + ' => ' + JSON.stringify(v) + '\n'); }
  }
  app.quit();
}
