/* End-to-end test: real Electron app + real Python agent + fake Gemini + a recorded "microphone".
 *   node test/e2e.js           (needs: npm i, a python with the agent's requirements, xvfb on Linux, the whisper model)
 * Env: PARU_PYTHON=/path/to/python  PARU_TEST_MODEL_DIR=/path/to/sherpa-onnx-whisper-tiny.en  */
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const ROOT = path.resolve(__dirname, '..'), PY = process.env.PARU_PYTHON || 'python3';
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paru-e2e-')), ud = path.join(tmp, 'ud'), ad = path.join(tmp, 'agent'), shots = path.join(tmp, 'shots');
  fs.mkdirSync(ud); fs.mkdirSync(shots); fs.cpSync(path.join(ROOT, 'agent'), ad, { recursive: true, filter: p => !/__pycache__|[\\/]models|env\.txt|\.db$/.test(p) });
  if (process.env.PARU_TEST_MODEL_DIR) { fs.mkdirSync(path.join(ad, 'models')); fs.symlinkSync(process.env.PARU_TEST_MODEL_DIR, path.join(ad, 'models', 'whisper-tiny.en')); }
  const wav = path.join(tmp, 'mic.wav'), meta = JSON.parse(cp.execFileSync(PY, [path.join(__dirname, 'make_e2e_wav.py'), wav]).toString());
  const port = await free(), gport = await free(), log = path.join(tmp, 'events.jsonl');
  fs.writeFileSync(path.join(ad, 'env.txt'), 'GEMINI_API_KEY=test\nOWNER_NAME=Tester\nTIMEZONE=Asia/Kolkata\n');           // no VOICE_KEY on purpose: the app must create it
  fs.writeFileSync(path.join(ud, 'cfg.json'), JSON.stringify({ server: 'http://127.0.0.1:' + port, onboarded: true, wake: true, autostart: false, perms: { mic: true }, voice: 'en-US-AriaNeural' }));
  const mock = cp.spawn(PY, [path.join(__dirname, 'mock_gemini.py'), String(gport)], { stdio: 'ignore' });
  const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron', electron = path.join(ROOT, 'node_modules', '.bin', bin);
  const env = { ...process.env, PARU_TEST: '1', PARU_NO_SANDBOX: '1', PARU_USER_DATA: ud, PARU_AGENT_DIR: ad, PARU_PYTHON: PY, PARU_TEST_WAV: wav, PARU_TEST_LOG: log, PARU_SHOT: shots, PARU_SHOT_MS: '12000', GEMINI_BASE: `http://127.0.0.1:${gport}/v1beta` };
  const args = ['--no-sandbox', ROOT]; const cmd = process.platform === 'linux' ? 'xvfb-run' : electron, full = process.platform === 'linux' ? ['-a', electron, ...args] : args;
  const app = cp.spawn(cmd, full, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }); let out = ''; app.stdout.on('data', d => out += d); app.stderr.on('data', d => out += d);
  const T0 = Date.now(); await sleep((meta.seconds + 40) * 1000);
  try { process.kill(-app.pid, 'SIGKILL'); } catch { app.kill(); } try { cp.execSync('pkill -f "uvicorn agent:app"'); } catch { } mock.kill();
  const ev = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  const t0 = (ev.find(e => e.ev === 'engine') || ev[0] || { t: 0 }).t;
  console.log('--- events (seconds since the engine started) ---');
  ev.filter(e => !['engine', 'shortcut'].includes(e.ev) || e.ev === 'shortcut').forEach(e => console.log(((e.t - t0) / 1000).toFixed(1).padStart(6), e.ev, JSON.stringify({ ...e, t: undefined, ev: undefined })));
  const eng = ev.filter(e => e.ev === 'engine'), last = eng[eng.length - 1];
  const idx = (f, from = 0) => { for (let i = from; i < ev.length; i++) if (f(ev[i])) return i; return -1; };
  const checks = [];
  const add = (name, ok, extra = '') => checks.push([name, !!ok, extra]);
  const key = (() => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'))).key; } catch { return ''; } })();
  add('agent started by the app and online', ev.some(e => e.ev === 'agent' && e.state === 'online'));
  add('VOICE_KEY created automatically', key && fs.readFileSync(path.join(ad, 'env.txt'), 'utf8').includes('VOICE_KEY=' + key));
  const errs = ev.filter(e => e.ev === 'console'); add('no renderer errors', !errs.length, JSON.stringify(errs).slice(0, 400));
  const s1 = idx(e => e.ev === 'ov' && e.show), h1 = idx(e => e.ev === 'ov' && !e.show, s1 + 1), s2 = idx(e => e.ev === 'ov' && e.show, h1 + 1), off = idx(e => e.ev === 'setCfg' && e.c && e.c.wake === false, s2 + 1);
  add('"hello Paru" -> orb appears', s1 >= 0);
  add('"shut up" -> orb hides', h1 > s1 && s1 >= 0);
  add('"hello Paru" again -> orb appears again (still listening after shut up)', s2 > h1 && h1 >= 0);
  add('"turn off Paru" -> listening switched off', off > s2 && s2 >= 0);
  add('after turn off the microphone is released', last && last.mic === false && last.listening === false, JSON.stringify(last));
  const tts = ev.filter(e => e.ev === 'tts' && e.ok); add('the question is answered out loud (Gemini -> TTS audio -> playback)', tts.length > 0 && idx(e => e.ev === 'tts' && e.ok) > s1 && idx(e => e.ev === 'tts' && e.ok) < h1, JSON.stringify(ev.filter(e => e.ev === 'tts')));
  const acts = ev.filter(e => e.ev === 'act'); add('no stray actions', acts.length === 0);
  console.log('\n--- checks ---'); checks.forEach(([n, ok, x]) => console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x));
  console.log('\nscreenshots:', fs.readdirSync(shots).map(f => path.join(shots, f)).join(' '), '\nlog:', log);
  if (process.env.PARU_E2E_KEEP) fs.cpSync(shots, process.env.PARU_E2E_KEEP, { recursive: true });
  if (checks.some(c => !c[1])) { console.log('\napp output tail:\n' + out.slice(-1500)); process.exit(1); }
})();
