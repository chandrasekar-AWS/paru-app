/* Drives the REAL app through its setup wizard and then through a permission flow, via Chrome DevTools Protocol.
 * Fake: Supabase, Gemini, an OpenAI-compatible server, and the microphone (recorded phrases are fed in). Real: Electron, the UI, the agent, the speech model.
 *   node test/setup_e2e.js     env: PARU_PYTHON, PARU_TEST_MODEL_DIR, SHOTS (folder for screenshots) */
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const ROOT = path.resolve(__dirname, '..'), PY = process.env.PARU_PYTHON || 'python3', FIX = path.join(__dirname, 'fixtures'), SHOTS = process.env.SHOTS || '';
const free = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wav = n => { const b = fs.readFileSync(path.join(FIX, n + '.wav')); return b.subarray(44).toString('base64'); };
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.p = {}; this.ready = new Promise(r => this.ws.onopen = r); this.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && this.p[m.id]) { this.p[m.id](m); delete this.p[m.id]; } }; }
  async send(method, params = {}) { await this.ready; const id = ++this.id; return new Promise(res => { this.p[id] = res; this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; }
  async shot(name) { if (!SHOTS) return; const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); }
}
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paru-setup-')), ud = path.join(tmp, 'ud'), ad = path.join(tmp, 'agent'); fs.mkdirSync(ud); if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  fs.cpSync(path.join(ROOT, 'agent'), ad, { recursive: true, filter: p => !/__pycache__|[\\/]models|env\.txt|\.db$|profile\.json|wake_aliases/.test(p) });
  if (process.env.PARU_TEST_MODEL_DIR) { fs.mkdirSync(path.join(ad, 'models')); fs.symlinkSync(process.env.PARU_TEST_MODEL_DIR, path.join(ad, 'models', 'whisper-tiny.en')); }
  fs.writeFileSync(path.join(ad, 'env.txt'), 'OWNER_NAME=Tester\nTIMEZONE=Asia/Kolkata\n');                                // no VOICE_KEY and no Gemini key: the app and the wizard must provide them
  const [port, gport, pport, sbPort, dbg] = [await free(), await free(), await free(), await free(), await free()], log = path.join(tmp, 'ev.jsonl'); fs.writeFileSync(log, '');
  const silent = path.join(tmp, 'silence.wav'), b = Buffer.alloc(44 + 32000 * 120); b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(b.length - 44, 40); fs.writeFileSync(silent, b);
  fs.writeFileSync(path.join(ud, 'cfg.json'), JSON.stringify({ server: 'http://127.0.0.1:' + port, autostart: false }));
  const sb = require('./mock_supabase')(sbPort), kids = [cp.spawn(PY, [path.join(__dirname, 'mock_gemini.py'), String(gport)], { stdio: 'ignore' }), cp.spawn(PY, [path.join(__dirname, 'mock_providers.py'), String(pport)], { stdio: 'ignore' })];
  const env = { ...process.env, PARU_TEST: '1', PARU_NO_SANDBOX: '1', PARU_USER_DATA: ud, PARU_AGENT_DIR: ad, PARU_PYTHON: PY, PARU_TEST_WAV: silent, PARU_TEST_LOG: log, PARU_TEST_BROWSER: '1', PARU_SUPABASE_URL: 'http://127.0.0.1:' + sbPort, PARU_SUPABASE_ANON_KEY: 'anon-key-for-tests-0123456789', GEMINI_BASE: `http://127.0.0.1:${gport}/v1beta` };
  const bin = path.join(ROOT, 'node_modules', '.bin', 'electron');
  const app = cp.spawn(process.platform === 'linux' ? 'xvfb-run' : bin, process.platform === 'linux' ? ['-a', bin, '--no-sandbox', '--remote-debugging-port=' + dbg, ROOT] : ['--remote-debugging-port=' + dbg, ROOT], { env, stdio: 'ignore', detached: true });
  const events = () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  const checks = []; const check = (n, ok, x = '') => { checks.push([n, !!ok, x]); console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : x); };
  const waitFor = async (fn, ms, what) => { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch { } if (Date.now() - t > ms) throw new Error('timeout waiting for ' + what); await sleep(300); } };
  const finish = async code => { try { process.kill(-app.pid, 'SIGKILL'); } catch { app.kill(); } try { cp.execSync('pkill -f "uvicorn agent:app"'); } catch { } kids.forEach(k => k.kill()); (sb.stop ? sb.stop() : sb.close()); const bad = checks.filter(c => !c[1]); console.log(`\n${checks.length - bad.length}/${checks.length} checks passed`); process.exit(code || (bad.length ? 1 : 0)); };
  try {
    let pages; await waitFor(async () => { pages = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); return pages.find(p => /setup\.html/.test(p.url)) && pages.find(p => /overlay\.html/.test(p.url)); }, 60000, 'app windows');
    const main = new CDP(pages.find(p => /setup\.html/.test(p.url)).webSocketDebuggerUrl), ov = new CDP(pages.find(p => /overlay\.html/.test(p.url)).webSocketDebuggerUrl);
    const text = sel => main.eval(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
    const click = t => main.eval(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(t)});if(b){b.click();return true}return false})()`);
    const setv = (sel, v) => main.eval(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    const h1 = () => text('#card h1');
    /* ---- feeder: recorded phrases stand in for the microphone, chosen by what the wizard is asking for ---- */
    const clips = { p0: wav('setup_prompt_0'), p1: wav('setup_prompt_1'), p2: wav('setup_prompt_2'), w: [0, 1, 2, 3].map(i => wav('jarvis_wake_' + i)), o: [0, 1, 2, 3].map(i => wav('jarvis_off_' + i)) };
    await main.eval(`window.__C=${JSON.stringify(clips)};window.__n=0;window.__t=0;const f=b=>{const s=atob(b),a=new Array(s.length/2);for(let i=0;i<a.length;i++){let v=s.charCodeAt(2*i)|(s.charCodeAt(2*i+1)<<8);if(v>32767)v-=65536;a[i]=v/32768}return a};
      window.__PARU_FEEDER=()=>{const p=(document.querySelector('.prompt')||{}).textContent||'';const C=window.__C;
        if(/this is my voice/.test(p))return f(C.p0);if(/weather/.test(p))return f(C.p1);if(/open my notes/.test(p))return f(C.p2);
        if(/goodbye jarvis/.test(p))return f(C.o[(window.__n++)%4]);if(/hey jarvis/.test(p))return f(C.w[(window.__n++)%4]);
        if(/Say your wake word, then/.test(p))return f((window.__t++)%2===0?C.w[0]:C.o[0]);return null}`);

    /* ---- 1. account ---- */
    await waitFor(async () => /Welcome to Paru/.test(await h1()), 30000, 'login page'); check('first launch shows the login page', true); await main.shot('1-login');
    await setv('#em', 'chandru@gmail.com'); await setv('#pw', 'wrong-pass'); await click('Sign in'); await waitFor(async () => /Wrong email or password/.test(await text('#m')), 15000, 'wrong password message');
    check('wrong password is refused with a clear message', true);
    await click('Create an account'); await setv('#em', 'chandru@gmail.com'); await setv('#pw', 'secret123'); await click('Create account');
    await waitFor(async () => /get to know your voice/.test(await h1()), 20000, 'voice step'); check('sign-up works and moves on to the voice step', true);
    check('session is stored in the vault, not as plain text', (() => { const v = fs.readFileSync(path.join(ud, 'vault.json'), 'utf8'); return /"session"/.test(v) && !/access_token/.test(v) && !/secret123/.test(v); })());

    /* ---- 2. voice ---- */
    await waitFor(async () => (await click('Allow microphone and start')), 180000, 'voice start button'); await main.shot('2-voice');
    let sawHeard = false; const tv = Date.now(); for (;;) { const v = await text('#vs'); if (/I heard: .*hello/i.test(v)) sawHeard = true; if (/Your voice is saved/.test(v)) break; if (Date.now() - tv > 120000) throw new Error('timeout waiting for voice saved'); await sleep(120); }
    check('voice step shows what Paru heard ("I heard: Hello, this is my voice")', sawHeard); check('voice step: heard three phrases and saved the voice', true); await main.shot('2b-voice-done');
    await click('Continue'); await waitFor(async () => /Add your AI key/.test(await h1()), 10000, 'key step');

    /* ---- 3. AI key ---- */
    await waitFor(async () => (await main.eval(`!!document.querySelector('.prov')`)), 30000, 'provider list');
    check('many providers are offered', (await main.eval(`document.querySelectorAll('.prov').length`)) >= 8);
    await main.eval(`[...document.querySelectorAll('.prov')].find(b=>/Other/.test(b.textContent)).click()`); await sleep(300);
    const mockBase = `http://127.0.0.1:${pport}/v1`; await setv('#b', mockBase); await setv('#k', 'sk-this-is-a-fake-key-1234567890'); await click('Check key');
    await waitFor(async () => /not valid/.test(await text('#m')), 15000, 'fake key rejected'); check('a fake key is rejected', true); await main.shot('3-key-bad');
    await setv('#k', 'good'); await click('Check key'); await waitFor(async () => /Key is valid/.test(await text('#m')), 15000, 'good key accepted'); check('a real key is accepted and a model is chosen', /gpt-4o-mini/.test(await text('#m')), await text('#m')); await main.shot('3-key-ok');
    await click('Save and continue'); await waitFor(async () => /wake word and off word/.test(await h1()), 20000, 'words step');
    const cfg1 = JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'), 'utf8')); check('provider saved in settings', cfg1.provider && cfg1.provider.id === 'custom');
    check('API key is not stored in plain text anywhere in settings', !/"good"/.test(JSON.stringify(cfg1)) && !/good/.test(fs.readFileSync(path.join(ud, 'vault.json'), 'utf8').replace(/session|providerKey|enc|plain/g, '')));

    /* ---- 4. wake & off words ---- */
    await waitFor(async () => (await main.eval(`!!document.querySelector('#ww')`)), 90000, 'words form'); await setv('#ww', 'hey jarvis'); await setv('#ow', 'goodbye jarvis'); await click('Teach Paru both words');
    await waitFor(async () => /Wake word: understood/.test(await text('#m')), 120000, 'teaching result'); const tm = await text('#m'); check('teaching reports how many tries were understood', /Wake word: understood [23] of 3/.test(tm) && /Off word: understood [23] of 3/.test(tm), tm); await main.shot('4-words');
    await click('Test them'); await waitFor(async () => /Both work/.test(await text('#m')), 90000, 'test result'); check('live test hears the wake word and the off word', true);
    await click('Continue'); await waitFor(async () => /What may Paru do/.test(await h1()), 20000, 'permissions step');

    /* ---- 5. permissions ---- */
    const sels = await main.eval(`[...document.querySelectorAll('select[data-k]')].map(s=>s.dataset.k+'='+s.value).join(',')`); check('permissions default to "ask me first"', /apps=ask/.test(sels) && /browser=ask/.test(sels) && /mic=allow/.test(sels), sels); await main.shot('5-perms');
    await click('Continue'); await waitFor(async () => /all set/.test(await h1()), 20000, 'done step'); await main.shot('6-done');
    check('done page names the chosen wake word', /hey jarvis/i.test(await text('#card')));
    await click('Start using Paru'); await waitFor(async () => JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'), 'utf8')).onboarded === true, 15000, 'onboarded');
    const cfg2 = JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'), 'utf8')); check('setup finished: onboarded, listening on, custom words saved', cfg2.onboarded && cfg2.wake && cfg2.wakeWord === 'hey jarvis' && cfg2.offWord === 'goodbye jarvis' && cfg2.perms.mic === 'allow' && !!cfg2.voiceprint);
    const prof = await (await fetch(`http://127.0.0.1:${port}/voice/config`, { headers: { 'x-key': cfg2.key } })).json(); check('the agent knows the wake/off words and the owner name', prof.wake === 'hey jarvis' && prof.off === 'goodbye jarvis' && prof.owner === 'chandru', JSON.stringify(prof));
    const prov = await (await fetch(`http://127.0.0.1:${port}/voice/providers`, { headers: { 'x-key': cfg2.key } })).json(); check('the agent received the key from the app (in memory)', prov.active.id === 'custom' && prov.active.ready, JSON.stringify(prov.active));
    await waitFor(async () => /app\.html/.test((await (await fetch(`http://127.0.0.1:${dbg}/json`)).json()).find(p => /app|setup/.test(p.url) && !/overlay/.test(p.url)).url), 15000, 'app page'); await sleep(2500); await main.shot('7-app');

    /* ---- 6. the real assistant: custom wake word -> request -> first-time permission -> remembered ---- */
    const feed = async n => ov.eval(`(()=>{const s=atob(${JSON.stringify(wav(n))}),a=new Array(s.length/2);for(let i=0;i<a.length;i++){let v=s.charCodeAt(2*i)|(s.charCodeAt(2*i+1)<<8);if(v>32767)v-=65536;a[i]=v/32768}(window.__PARU_FEED=window.__PARU_FEED||[]).push(a);if(window.__E&&window.__E.cancelListen)window.__E.cancelListen();return 1})()`);   // wake a listener that is already waiting on the (silent) microphone
    const script = o => fetch(`http://127.0.0.1:${pport}/__script`, { method: 'POST', body: JSON.stringify(o) });
    const cnt = (ev, f = () => true) => events().filter(e => e.ev === ev && f(e)).length;
    await waitFor(async () => (await ov.eval(`window.__E&&window.__E.C.wake&&window.__E.status.mic`)), 30000, 'overlay listening'); const shows0 = cnt('ov', e => e.show);
    await feed('jarvis_wake_0'); await waitFor(() => cnt('ov', e => e.show) > shows0, 30000, 'orb after custom wake word'); check('custom wake word "hey jarvis" shows the orb', true);
    await script({ answer: 'Opening it.', action: { type: 'open_url', target: 'example.com' } }); await feed('neg_what_time_is_the_meeting_0');
    await waitFor(() => cnt('ask', e => e.cap === 'browser') === 1, 40000, 'first-time permission question'); check('first time: Paru asks before opening a website', cnt('browse') === 0);
    await feed('answer_always'); await waitFor(() => cnt('browse') === 1, 40000, 'website opened'); check('answering "yes, always" allows it and the task runs', events().some(e => e.ev === 'perm' && e.cap === 'browser' && e.v === 'allow'));
    await feed('neg_what_time_is_the_meeting_0'); await waitFor(() => cnt('browse') === 2, 40000, 'second website'); check('second time: runs without asking again', cnt('ask', e => e.cap === 'browser') === 1);
    await script({ action: { type: 'open_app', target: 'calculator' }, answer: 'Opening calculator.' }); await feed('neg_what_time_is_the_meeting_0'); await waitFor(() => cnt('ask', e => e.cap === 'apps') === 1, 40000, 'apps question');
    await feed('answer_no'); await sleep(6000); check('saying "no" refuses the task', cnt('launch') === 0 && JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'), 'utf8')).perms.apps === 'ask');
    await feed('neg_what_time_is_the_meeting_0'); await waitFor(() => cnt('ask', e => e.cap === 'apps') === 2, 40000, 'apps asked again'); await feed('answer_yes'); await waitFor(() => cnt('launch') === 1, 40000, 'launch once');
    check('"yes" (once) runs it but will ask again next time', JSON.parse(fs.readFileSync(path.join(ud, 'cfg.json'), 'utf8')).perms.apps === 'ask');
    await feed('jarvis_off_1'); await waitFor(() => events().some(e => e.ev === 'setCfg' && e.c && e.c.wake === false), 40000, 'turned off'); check('custom off word "goodbye jarvis" turns Paru off', true);
    await waitFor(async () => (await ov.eval(`window.__E.status.mic===false`)), 15000, 'mic released'); check('and the microphone is released', true);
    const errs = events().filter(e => e.ev === 'console'); check('no renderer errors anywhere', errs.length === 0, JSON.stringify(errs).slice(0, 400));
    await finish();
  } catch (e) { console.log('FAIL', e.message); try { console.log('page says:', await (async () => { const pg = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); const c = new CDP(pg.find(p => !/overlay/.test(p.url)).webSocketDebuggerUrl); return await c.eval(`(document.querySelector('#m')||{}).textContent+' || '+(document.querySelector('#tw')||{}).innerText`); })()); } catch (x) { } console.log('events tail:', events().slice(-8).map(x => JSON.stringify(x)).join('\n')); await finish(1); }
})();
