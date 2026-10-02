/* node test/phone.js : the phone UI (bridge.js + engine) against the real agent, fake microphone, fake Gemini. */
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const ROOT = path.resolve(__dirname, '..'), PY = process.env.PARU_PYTHON || 'python3';
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paru-phone-')), ad = path.join(tmp, 'agent'), shots = path.join(tmp, 'shots'); fs.mkdirSync(shots);
  fs.cpSync(path.join(ROOT, 'agent'), ad, { recursive: true, filter: p => !/__pycache__|[\\/]models|env\.txt|\.db$/.test(p) });
  if (process.env.PARU_TEST_MODEL_DIR) { fs.mkdirSync(path.join(ad, 'models')); fs.symlinkSync(process.env.PARU_TEST_MODEL_DIR, path.join(ad, 'models', 'whisper-tiny.en')); }
  const wav = path.join(tmp, 'mic.wav'), meta = JSON.parse(cp.execFileSync(PY, [path.join(__dirname, 'make_e2e_wav.py'), wav]).toString());
  const port = await free(), gport = await free(), log = path.join(tmp, 'ev.jsonl'); fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(ad, 'env.txt'), 'VOICE_KEY=phonekey\nGEMINI_API_KEY=test\nOWNER_NAME=Tester\nTIMEZONE=Asia/Kolkata\n');
  const mock = cp.spawn(PY, [path.join(__dirname, 'mock_gemini.py'), String(gport)], { stdio: 'ignore' });
  const agent = cp.spawn(PY, ['-m', 'uvicorn', 'agent:app', '--host', '0.0.0.0', '--port', String(port), '--log-level', 'warning'], { cwd: ad, env: { ...process.env, GEMINI_BASE: `http://127.0.0.1:${gport}/v1beta` }, stdio: 'ignore' });
  for (let i = 0; i < 90; i++) { try { const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); if (h.asr.state === 'ready') break; } catch { } await sleep(1000); }
  const cfg = { server: `http://127.0.0.1:${port}`, key: 'phonekey', onboarded: true, wake: true, perms: { mic: true }, theme: 'dark', orbSize: 'medium' };
  const A = { root: ROOT, wav, log, shots, cfg, homeShot: 6000, orbShot: Math.round((meta.timeline.wake1 + 4.5) * 1000), total: Math.round((meta.seconds + 6) * 1000) };
  const bin = path.join(ROOT, 'node_modules', '.bin', 'electron'), args = ['--no-sandbox', path.join(__dirname, 'phone_main.js')];
  const app = cp.spawn(process.platform === 'linux' ? 'xvfb-run' : bin, process.platform === 'linux' ? ['-a', bin, ...args] : args, { env: { ...process.env, PHONE_TEST: JSON.stringify(A) }, stdio: 'ignore' });
  await new Promise(r => app.on('exit', r)); agent.kill(); mock.kill();
  const ev = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse), st = ev.filter(e => e.ev === 'state');
  console.log('--- state changes ---'); st.forEach(e => console.log(e.orb || '-', 'active=' + e.active, 'wake=' + e.wake, 'mic=' + e.mic, '|', e.strip));
  const i1 = st.findIndex(e => e.orb === 'flex'), i2 = st.findIndex((e, i) => i > i1 && e.orb === 'none'), i3 = st.findIndex((e, i) => i > i2 && e.orb === 'flex'), i4 = st.findIndex((e, i) => i > i3 && e.wake === false);
  const c = [['phone UI starts and shows status', st.some(e => /Listening|Getting|Starting/.test(e.strip || ''))], ['no console errors', !ev.some(e => e.ev === 'console'), JSON.stringify(ev.filter(e => e.ev === 'console'))],
    ['"hello Paru" opens the full-screen orb', i1 >= 0], ['"shut up" closes it', i2 > i1 && i1 >= 0], ['"hello Paru" opens it again', i3 > i2 && i2 >= 0], ['"turn off Paru" switches listening off', i4 > i3 && i3 >= 0], ['microphone released after turn off', st.length && st[st.length - 1].mic === false]];
  console.log('\n--- checks ---'); c.forEach(([n, ok, x]) => console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : (x || '')));
  fs.cpSync(shots, process.env.PARU_E2E_KEEP || shots, { recursive: true }); console.log('shots:', fs.readdirSync(shots).join(' '));
  process.exit(c.every(x => x[1]) ? 0 : 1);
})();
