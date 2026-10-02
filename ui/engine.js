/* Paru voice engine. Runs in the overlay window (Windows / Linux) and inside the app page (Android).
 *
 *   mic -> AudioWorklet (16 kHz) -> speech detector with pre-roll -> segment (Int16 PCM)
 *   segment -> agent /voice/audio   (idle: "hello Paru" is decided locally by the agent, nothing is sent to the cloud
 *                                    unless it was a real request; open session: "shut up" / "turn off" are local too)
 *
 * States:  OFF (mic released)  ->  IDLE (listening for "hello Paru")  ->  SESSION (orb open, conversation)
 *   "shut up" / "stop"   : SESSION -> IDLE   (orb hides, still listening for "hello Paru")
 *   "turn off Paru"      : any     -> OFF    (stops listening and releases the microphone)
 *
 * The page supplies `P` (bridge to the app / agent) and `ui` (the orb). See overlay.html and mobile.js.
 */
(function (root) {
  const SR = 16000, FRAME = 512;                       // 32 ms frames
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const WORKLET = `class C extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(${FRAME});this.n=0}
    process(i){const x=i[0][0];if(!x)return true;for(let k=0;k<x.length;k++){this.b[this.n++]=x[k];if(this.n===${FRAME}){this.port.postMessage(this.b.slice(0));this.n=0}}return true}}
    registerProcessor('paru-cap',C)`;

  /* ---------- voice print (basic, not a security lock): average log-spectrum on 40 bands ---------- */
  function fft(re, im) {                               // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) {
        const u = i + k, v = i + k + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  const BANDS = (() => { const o = [], lo = 80, hi = 5000, n = FRAME / 2, ny = SR / 2; for (let i = 0; i < 40; i++) { const a = lo * Math.pow(hi / lo, i / 40), b = lo * Math.pow(hi / lo, (i + 1) / 40); o.push([Math.max(1, Math.floor(a / ny * n)), Math.max(2, Math.ceil(b / ny * n))]); } return o; })();
  function voiceVec(pcm) {
    const sum = new Float64Array(40); let cnt = 0, re = new Float32Array(FRAME), im = new Float32Array(FRAME);
    for (let p = 0; p + FRAME <= pcm.length; p += FRAME) {
      let e = 0; for (let i = 0; i < FRAME; i++) e += pcm[p + i] * pcm[p + i];
      if (Math.sqrt(e / FRAME) < 0.02) continue;       // only the voiced frames
      for (let i = 0; i < FRAME; i++) { re[i] = pcm[p + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME)); im[i] = 0; }
      fft(re, im);
      for (let b = 0; b < 40; b++) { let s = 0, c = 0; for (let k = BANDS[b][0]; k < BANDS[b][1]; k++) { s += 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-9); c++; } sum[b] += c ? s / c : -100; }
      cnt++;
    }
    if (cnt < 5) return null;
    const v = Array.from(sum, x => x / cnt), m = v.reduce((a, b) => a + b, 0) / 40, o = v.map(x => x - m), n = Math.sqrt(o.reduce((a, b) => a + b * b, 0)) || 1;
    return o.map(x => x / n);
  }
  const cosv = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const unit = v => { const m = v.reduce((a, b) => a + b, 0) / v.length, o = v.map(x => x - m), n = Math.sqrt(o.reduce((a, b) => a + b * b, 0)) || 1; return o.map(x => x / n); };

  const toPcm16 = f => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 32768 : s * 32767; } return o.buffer; };
  const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  class ParuEngine {
    constructor(P, ui) {
      this.P = P; this.ui = ui; this.C = { perms: {} };
      this.stream = null; this.ac = null; this.out = null;
      this.ring = []; this.floor = 0.004; this.lv = 0; this.hot = [];        // pre-roll ring buffer, noise floor, recent loud frames
      this.collector = null;                                                 // active listen() request
      this.active = false; this.busy = false; this.epoch = 0; this.speaking = false; this.audio = null; this.playRes = null;
      this.lastAct = Date.now(); this.enrolling = false; this.pendingSeg = null; this.running = false; this.cancelListen = null;
      this.status = { mic: false, agent: 'unknown', asr: null };
    }

    /* ======================= microphone ======================= */
    async mic() {
      if (this.stream && this.stream.active && this.ac && this.ac.state !== 'closed') { if (this.ac.state === 'suspended') await this.ac.resume(); return true; }
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
        this.ac = new AudioContext({ sampleRate: SR });
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await this.ac.audioWorklet.addModule(url); URL.revokeObjectURL(url);
        const src = this.ac.createMediaStreamSource(this.stream), node = new AudioWorkletNode(this.ac, 'paru-cap', { numberOfOutputs: 0 });
        node.port.onmessage = e => this.frame(e.data); src.connect(node); this.node = node;
        this.stream.getAudioTracks()[0].onended = () => { this.status.mic = false; this.pub(); };
        await this.ac.resume(); this.status.mic = true; this.pub(); return true;
      } catch (e) { this.status.mic = false; this.status.micError = String(e && e.name || e); this.pub(); return false; }
    }
    releaseMic() {                                                              // "turn off Paru" really turns the microphone off
      try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch { }
      try { this.node && this.node.disconnect(); } catch { }
      try { this.ac && this.ac.close(); } catch { }
      this.stream = this.ac = this.node = null; this.ring = []; this.status.mic = false; this.pub();
    }

    /* ======================= speech detector ======================= */
    frame(f) {
      let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i];
      const r = Math.sqrt(e / f.length); this.lv = this.lv * 0.6 + r * 0.4; this.ui.level && this.ui.level(this.lv);
      const on = Math.max(0.014, this.floor * 3.2), off = Math.max(0.009, this.floor * 2.0);
      const c = this.collector;
      if (!c || !c.started) { this.floor = Math.min(0.05, r < this.floor * 2 + 0.003 ? this.floor * 0.985 + r * 0.015 : this.floor); }   // adapt only to background noise
      this.ring.push(f); if (this.ring.length > 18) this.ring.shift();         // ~0.58 s of pre-roll: the first word is never cut
      this.hot.push(r > on); if (this.hot.length > 4) this.hot.shift();
      if (!c) return;
      c.elapsed += 32;
      if (!c.started) {
        if (c.startNow || this.hot.filter(Boolean).length >= 3) { c.started = true; c.frames = this.ring.slice(); c.voiced = 0; c.quiet = 0; }
        else if (c.wait && c.elapsed > c.wait) return this.finish(c, 'timeout');
        return;
      }
      c.frames.push(f);
      if (r > off) { c.quiet = 0; if (r > on) c.voiced++; } else c.quiet += 32;
      if (c.quiet >= c.hang) return this.finish(c, 'end');
      if (c.frames.length * 32 > c.max) return this.finish(c, 'end');
    }
    finish(c, why) {
      if (this.collector !== c) return; this.collector = null; this.cancelListen = null;
      if (why === 'timeout') return c.res({ timeout: true });
      if (why === 'cancel') return c.res({ cancelled: true });
      if (c.voiced < 4) return c.res({ tooShort: true });
      const n = c.frames.length * FRAME, pcm = new Float32Array(n); c.frames.forEach((fr, i) => pcm.set(fr, i * FRAME));
      c.res({ pcm });
    }
    /* listen({wait, hang, max, startNow}) -> {pcm} | {timeout} | {tooShort} | {cancelled} */
    listen(o = {}) {
      return new Promise(res => {
        if (this.collector) this.finish(this.collector, 'cancel');
        const c = this.collector = { res, wait: o.wait || 0, hang: o.hang || 600, max: o.max || 8000, startNow: !!o.startNow, started: false, elapsed: 0, frames: [], voiced: 0, quiet: 0 };
        this.cancelListen = () => this.finish(c, 'cancel');
      });
    }

    /* ======================= status for the main window ======================= */
    pub() { this.P.engineStatus && this.P.engineStatus({ ...this.status, listening: this.running && !!this.C.wake, session: this.active }); }
    setCfg(c) { this.C = c; }

    /* ======================= sounds ======================= */
    chime(kind) {
      try {
        this.out = this.out || new AudioContext(); const a = this.out; if (a.state === 'suspended') a.resume();
        const seq = { wake: [[660, 0], [990, .09]], off: [[660, 0], [330, .1]], err: [[220, 0]], ok: [[880, 0]] }[kind] || [];
        seq.forEach(([hz, at]) => { const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + at; o.type = 'sine'; o.frequency.value = hz;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.connect(g).connect(a.destination); o.start(t); o.stop(t + 0.18); });
      } catch { }
    }

    /* ======================= main loop ======================= */
    async start() { this.running = true; if (!this.busy) this.loop(); }
    poke() { if (this.cancelListen && !this.active) this.cancelListen(); if (!this.busy) this.loop(); }          // config changed: re-evaluate
    async loop() {
      if (this.busy || this.enrolling) return; this.busy = true;
      const P = this.P;
      try {
        while (true) {
          const C = this.C;
          if (!C.key) { this.status.agent = 'nokey'; this.pub(); break; }
          if (!C.wake && !this.active) { this.releaseMic(); break; }                       // listening is off and no conversation is open
          if (!C.perms.mic) { this.status.mic = false; this.status.micError = 'permission'; this.pub(); if (this.active) { this.ui.show(); this.ui.say('', 'Turn on the microphone: Paru → Settings → Permissions.'); await sleep(5000); this.endSession(); } break; }
          if (!await this.mic()) { if (this.active) { this.ui.show(); this.ui.say('', 'The microphone is blocked. Allow it in your system privacy settings.'); await sleep(5000); this.endSession(); } else await sleep(4000); if (!this.active && !this.C.wake) break; continue; }
          const idle = !this.active;
          let seg;
          if (this.pendingSeg) { seg = this.pendingSeg; this.pendingSeg = null; }
          else {
            if (!idle) { this.ui.show(); if (!this.speaking) this.ui.state('listening'); }
            seg = await this.listen(idle ? { hang: 650, max: 9000 } : { wait: 7000, hang: 850, max: 25000 });
          }
          if (seg.cancelled) continue;
          if (seg.timeout) { if (this.active && C.autoHide > 0 && Date.now() - this.lastAct > C.autoHide * 1000) this.endSession(); continue; }
          if (!seg.pcm) continue;
          if (idle && C.voiceLock && C.voiceprint && C.vpVer === 2) { const v = voiceVec(seg.pcm); if (v && cosv(v, C.voiceprint) < (C.voiceThr || 0.9)) continue; }   // not my voice
          await this.handle(seg.pcm, idle);
        }
      } finally { this.busy = false; }
    }

    async send(pcm, idle) {
      const my = this.epoch;
      const r = await this.P.api('/voice/audio?wake=' + (idle ? 1 : 0), 'POST', toPcm16(pcm), 'audio/L16');
      return { r, stale: my !== this.epoch && !idle };
    }

    async handle(pcm, idle) {
      const P = this.P;
      if (!idle) this.ui.state('thinking');
      const { r, stale } = await this.send(pcm, idle);
      if (stale) return;                                                                 // dismissed / interrupted while the agent was thinking
      if (r.error) {
        this.status.agent = r.error === 'unreachable' ? 'offline' : 'badkey'; this.pub();
        if (!idle) { this.ui.say('', r.error === 'unreachable' ? "I can't reach the agent." : 'Wrong key. Open Paru → Settings.'); this.ui.state('listening'); await sleep(3000); }
        else await sleep(2500);
        return;
      }
      this.status.agent = 'online';
      if (r.kind === 'warming') { this.status.asr = r.asr; this.pub(); await sleep(1500); return; }
      this.status.asr = null;
      const a = r.action || { type: 'none' };
      if (a.type === 'sleep' || r.kind === 'off') return this.turnOff();
      if (a.type === 'stop' || (this.active && typeof isStop === 'function' && String(r.heard || '').trim().split(/\s+/).length <= 3 && isStop(r.heard))) { if (this.active) this.endSession(); return; }
      if (idle) {
        if (r.kind !== 'wake' && !(r.text && r.kind !== 'none')) return;                 // not addressed to Paru: stay silent
        this.active = true; this.lastAct = Date.now(); this.ui.show(); this.chime('wake');
        if (!r.text && !(a && a.type !== 'none')) { this.ui.say('', 'Listening…'); this.ui.state('listening'); return; }
      }
      this.active = true; this.lastAct = Date.now(); this.ui.show();
      const upd = this.ui.say(r.heard, ''); this.ui.state('thinking');
      let out = r.text || '';
      if (a.type === 'change_voice') out = await this.changeVoice(a.target, r.lang, out);
      else if (a.type === 'set_setting') out = await this.setSetting(a.target, out);
      else if (a.type === 'open_settings') { P.openMain(a.target || 'general'); out = out || 'Opening settings.'; }
      else if (!/^(none|check_mail|check_calendar|daily_report|draft_reply|complete_task)$/.test(a.type)) {
        const res = await P.act(a.type, a.target);
        if (/^no-permission/.test(res)) out = "I don't have permission for that yet. Open Paru, then Settings, then Permissions.";
        else if (res === 'denied') out = "Okay, I won't.";
        else if (['blocked', 'failed', 'notfound', 'toobig'].includes(res)) out = "Sorry, I couldn't do that.";
        else if (!out) out = 'Okay.';
      }
      if (out) await this.speak(out, upd, r.lang);
      this.lastAct = Date.now(); if (this.active && !this.pendingSeg) this.ui.state('listening');
    }

    /* ======================= session control ======================= */
    stopSpeech() {
      this.epoch++; try { speechSynthesis.cancel(); } catch { }
      if (this.audio) { this.audio.onended = this.audio.onerror = null; try { this.audio.pause(); } catch { } this.audio = null; }
      if (this.playRes) { this.playRes(); this.playRes = null; }
      this.speaking = false; if (this.bargeStop) { this.bargeStop(); this.bargeStop = null; }
    }
    endSession() {                                                       // "shut up": hide the orb, keep listening for the wake word
      this.stopSpeech(); this.active = false; this.pendingSeg = null; this.ui.hide(); this.ui.state('idle');
      if (this.cancelListen) this.cancelListen(); this.pub();
    }
    async turnOff() {                                                    // "turn off Paru": stop listening altogether
      this.stopSpeech(); this.active = false; this.pendingSeg = null;
      await this.P.setCfg({ wake: false }); this.C = { ...this.C, wake: false };
      this.chime('off'); this.ui.show(); this.ui.state('off'); this.ui.say('', 'Paru is off. Press Ctrl+Shift+Space or use the tray icon to turn it on.');
      if (this.cancelListen) this.cancelListen(); this.releaseMic();
      await sleep(3200); this.ui.hide(); this.pub();
    }
    orbClick() { if (this.speaking) { this.stopSpeech(); this.ui.state('listening'); } else this.endSession(); }
    async talkNow() {                                                    // hotkey / Talk button
      if (this.enrolling) return;
      if (this.active && this.ui.visible && this.ui.visible()) return this.endSession();
      if (!this.C.perms.mic) { this.ui.show(); this.ui.say('', 'Turn on the microphone: Paru → Settings → Permissions.'); await sleep(5000); if (!this.active) this.ui.hide(); return; }
      this.stopSpeech(); this.active = true; this.lastAct = Date.now(); this.ui.show(); this.ui.say('', 'Listening…'); this.ui.state('listening'); this.chime('wake');
      this.running = true; if (this.cancelListen) this.cancelListen(); this.loop();
    }

    /* ======================= app settings by voice ======================= */
    async setSetting(t, out) {
      const [k, v0] = String(t || '').split('='); const key = (k || '').trim().toLowerCase(), v = (v0 || '').trim().toLowerCase(); let c = null;
      const COL = { blue: '#5a8bff', pink: '#ff5fa8', green: '#36d399', purple: '#9b6bff', orange: '#ff9f43', red: '#ff5f57', teal: '#1ce6d1', yellow: '#f7c948' };
      if (key === 'theme' && /^(dark|light|system)$/.test(v)) c = { theme: v };
      else if (key === 'speed') c = { rate: v === 'slower' ? -20 : v === 'faster' ? 15 : 0 };
      else if (key === 'language') c = { lang: v || 'auto' };
      else if (key === 'wake') c = { wake: /^(on|true|yes)$/.test(v) };
      else if (key === 'autohide') c = { autoHide: v === 'never' ? 0 : parseInt(v) || 0 };
      else if (key === 'orbsize' && ['small', 'medium', 'large'].includes(v)) c = { orbSize: v };
      else if (key === 'accent') c = { accent: COL[v] || (/^#[0-9a-f]{6}$/.test(v) ? v : null) };
      else if (key === 'closing') c = { closeQuits: v === 'quit' };
      else if (key === 'voicelock') c = { voiceLock: /^(on|true|yes)$/.test(v) };
      if (!c || Object.values(c).includes(null)) return out || "Sorry, I can't change that.";
      await this.P.setCfg(c); this.C = { ...this.C, ...c }; this.ui.applyCfg && this.ui.applyCfg(this.C); return out || 'Done.';
    }
    async changeVoice(t, lang, out) {
      lang = (lang || 'en').slice(0, 2); const pool = PARU_VOICES.all.filter(v => v.lang === lang); if (!pool.length) return out;
      let i = Math.max(0, pool.findIndex(v => v.id === this.C.voice)); const n = parseInt(t), g = /^(male|man)$/i.test(t) ? 'M' : /^(female|woman)$/i.test(t) ? 'F' : null;
      if (n > 0 && pool[n - 1]) i = n - 1; else if (g) { const m = pool.filter(v => v.g === g); i = pool.indexOf(m[(m.indexOf(pool[i]) + 1) % m.length] || m[0]); } else i = (i + 1) % pool.length;
      await this.P.setCfg({ voice: pool[i].id }); this.C.voice = pool[i].id; return out || ('Voice ' + (i + 1) + ': ' + pool[i].name);
    }

    /* ======================= speaking: sentences are fetched in parallel, the first plays as soon as it is ready ======================= */
    getTts(t, lang) {
      const v = PARU_VOICES.pick(lang, this.C.voice);
      return this.P.api('/voice/tts?text=' + encodeURIComponent(t) + '&voice=' + v.id + '&rate=' + (this.C.rate || 0), 'GET', null, null, true)
        .then(r => r && r.audio ? URL.createObjectURL(new Blob([r.audio], { type: r.mime || 'audio/mpeg' })) : null).catch(() => null);
    }
    async speak(t, upd, lang) {
      const my = ++this.epoch; this.speaking = true; this.ui.state('speaking');
      const parts = (t.match(/[^.!?।。！？]+[.!?।。！？]*/g) || [t]).map(x => x.trim()).filter(Boolean);
      const jobs = parts.map(p => this.getTts(p, lang));
      // barge-in: speaking over Paru stops it and starts recording what you say (threshold adapts to the speaker's own bleed)
      let watch = null;
      if (this.C.interrupt && this.C.perms.mic && this.stream && this.stream.active && this.active) {
        let base = 0, hot = 0; const t0 = Date.now();
        watch = setInterval(() => {
          const l = this.lv; if (Date.now() - t0 < 600) { base = Math.max(base, l); return; }
          if (l > Math.max(0.07, base * 2.6 + 0.03)) { if (++hot >= 5) { clearInterval(watch); watch = null; this.barge(); } } else hot = 0;
        }, 40);
        this.bargeStop = () => { if (watch) clearInterval(watch); watch = null; };
      }
      let shown = '';
      for (let i = 0; i < parts.length && my === this.epoch; i++) {
        shown += (i ? ' ' : '') + parts[i]; upd(shown);
        const url = await jobs[i]; if (my !== this.epoch) break;
        if (url) await new Promise(res => { this.playRes = res; const a = this.audio = new Audio(url); a.onended = a.onerror = () => { this.playRes = null; URL.revokeObjectURL(url); res(); }; a.play().catch(() => { this.playRes = null; res(); }); });
        else await new Promise(res => { try { const u = new SpeechSynthesisUtterance(parts[i]); u.lang = lang || 'en'; const vv = speechSynthesis.getVoices().find(x => x.lang.toLowerCase().startsWith((lang || 'en').slice(0, 2))); if (vv) u.voice = vv; u.onend = u.onerror = res; speechSynthesis.speak(u); } catch { res(); } setTimeout(res, 2500 + parts[i].length * 110); });
      }
      if (watch) clearInterval(watch); this.bargeStop = null;
      if (my === this.epoch) { upd(t); this.speaking = false; this.audio = null; }
    }
    barge() {                                                            // the person started talking over Paru
      const my = this.epoch; this.stopSpeech(); this.speaking = false;
      this.ui.state('listening');
      this.listen({ startNow: true, hang: 850, max: 25000 }).then(s => { if (s.pcm) this.pendingSeg = { pcm: s.pcm }; if (!this.busy) this.loop(); });
    }

    /* ======================= teach Paru my voice ======================= */
    async enroll() {
      if (this.enrolling) return; this.enrolling = true; this.stopSpeech(); if (this.cancelListen) this.cancelListen();
      const P = this.P; const done = m => { this.enrolling = false; P.enrollDone(m); this.endSession(); this.poke(); };
      try {
        if (!this.C.perms.mic || !await this.mic()) return done({ ok: false, msg: 'Allow the microphone first (Settings → Permissions).' });
        this.active = true; this.ui.show(); const vs = [], samples = [];
        const lines = ['Hello Paru', 'Hey Paru', 'Hello Paru, how are you?', 'Okay Paru'];
        for (let i = 0; i < lines.length; i++) {
          this.ui.say('Step ' + (i + 1) + ' of ' + lines.length, 'Say: “' + lines[i] + '”'); this.ui.state('listening');
          const seg = await this.listen({ wait: 10000, hang: 700, max: 6000 });
          if (!seg.pcm) { i--; this.ui.say('', 'I did not hear you. Try again.'); await sleep(1200); continue; }
          const v = voiceVec(seg.pcm); if (!v) { i--; this.ui.say('', 'A little louder, please.'); await sleep(1200); continue; }
          vs.push(v); samples.push(b64(toPcm16(seg.pcm))); this.chime('ok'); this.ui.say('', 'Got it.'); await sleep(450);
        }
        const tpl = unit(vs[0].map((_, k) => vs.reduce((a, v) => a + v[k], 0) / vs.length)), sims = vs.map(v => cosv(v, tpl)), thr = Math.max(0.6, Math.min(0.97, Math.min(...sims) - 0.04));
        await P.setCfg({ voiceprint: tpl, voiceThr: +thr.toFixed(3), vpVer: 2 }); this.C = { ...this.C, voiceprint: tpl, voiceThr: thr, vpVer: 2 };
        const L = await P.api('/voice/wake/learn', 'POST', JSON.stringify({ samples }));
        const msg = L && L.total ? 'Saved. Paru recognised “hello Paru” in ' + L.recognized + ' of ' + L.total + ' tries' + (L.added && L.added.length ? ' and learned how your voice sounds.' : '.') : 'Voice saved.';
        this.ui.say('', 'Thank you. Your voice is saved.'); await sleep(1500); done({ ok: true, msg });
      } catch (e) { done({ ok: false, msg: 'Training failed: ' + e.message }); }
    }
  }
  root.ParuEngine = ParuEngine;
})(typeof window !== 'undefined' ? window : globalThis);
