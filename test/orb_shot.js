const { app, BrowserWindow } = require('electron'); const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('no-sandbox');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 560, height: 560, show: true, webPreferences: { backgroundThrottling: false } });
  await w.loadFile(path.join(__dirname, 'orb-demo.html')); const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = process.env.OUT;
  const shot = async n => fs.writeFileSync(path.join(out, n + '.png'), (await w.webContents.capturePage()).toPNG());
  const js = c => w.webContents.executeJavaScript(c);
  await js("orb.state('listening')"); await sleep(1200); await shot('a_idle1'); await sleep(900); await shot('a_idle2');
  await js("orb.state('listening');talk(true)"); await sleep(900); await shot('b_voice1'); await sleep(700); await shot('b_voice2');
  await js("orb.state('speaking')"); await sleep(1000); await shot('c_speak');
  await js("talk(false);orb.state('thinking')"); await sleep(800); await shot('d_think');
  await js("orb.state('off')"); await sleep(1500); await shot('e_off'); app.quit();
});
