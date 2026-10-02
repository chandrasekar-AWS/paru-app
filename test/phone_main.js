/* Phone-mode test harness: loads the UI WITHOUT Electron's preload (so ui/bridge.js is used, exactly as in the Android WebView). */
const { app, BrowserWindow } = require('electron'); const fs = require('fs'), path = require('path');
const A = JSON.parse(process.env.PHONE_TEST);
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('use-fake-device-for-media-stream'); app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', A.wav + '%noloop'); app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const log = (ev, d) => fs.appendFileSync(A.log, JSON.stringify({ t: Date.now(), ev, ...d }) + '\n');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 390, height: 800, show: true, webPreferences: { backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  w.webContents.on('console-message', (e, l, m) => { if (l >= 2) log('console', { msg: m.slice(0, 200) }); });
  await w.loadFile(path.join(A.root, 'ui', 'app.html'));
  await w.webContents.executeJavaScript(`localStorage.setItem('paru.cfg.v3', JSON.stringify(${JSON.stringify(A.cfg)}));`);
  await w.loadFile(path.join(A.root, 'ui', 'app.html'));
  const q = async code => w.webContents.executeJavaScript(code);
  let last = '';
  const poll = setInterval(async () => {
    try { const s = await q(`JSON.stringify({orb:(document.getElementById('orbLayer')||{style:{}}).style.display, active:window.__E&&window.__E.active, wake:window.__E&&window.__E.C.wake, mic:window.__E&&window.__E.status.mic, strip:document.getElementById('pt').textContent})`);
      if (s !== last) { last = s; log('state', JSON.parse(s)); } } catch { }
  }, 250);
  setTimeout(async () => { fs.writeFileSync(path.join(A.shots, 'phone-home.png'), (await w.webContents.capturePage()).toPNG()); }, A.homeShot);
  setTimeout(async () => { fs.writeFileSync(path.join(A.shots, 'phone-orb.png'), (await w.webContents.capturePage()).toPNG()); }, A.orbShot);
  setTimeout(() => { clearInterval(poll); app.quit(); }, A.total);
});
