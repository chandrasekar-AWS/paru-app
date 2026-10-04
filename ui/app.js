/* Paru UI - plain JS, no build step. Runs in Electron, any browser, and an Android WebView. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const token = $('meta[name=paru-token]').content;
const native = window.paru || null;                         // set by Electron preload
const state = { settings: null, status: null, ws: null, connected: false, view: 'chat', thread: [], thinking: false,
  orbActive: false, speaking: false, mic: null, recording: false, engineError: '', activeDay: null, onLevel: null, step: null };

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'x-paru-token': token, 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
function toast(msg, ms = 3200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
function setPath(obj, path, val) { const k = path.split('.'); let o = obj; k.slice(0, -1).forEach(p => o = o[p] = o[p] || {}); o[k.at(-1)] = val; return obj; }
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

/* ---------------------------------------------------------------- theme + window */
function applyTheme(t) { document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark'; }
$('#toggle-theme').onclick = () => { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; applyTheme(t); saveSettings({ theme: t }); };
$('#toggle-side').onclick = () => $('#shell').classList.toggle('collapsed');
if (native) {
  $('#win-close').onclick = () => native.win('close'); $('#win-min').onclick = () => native.win('min'); $('#win-max').onclick = () => native.win('max');
} else { $('#lights').style.visibility = 'hidden'; }

/* ---------------------------------------------------------------- settings */
async function saveSettings(patch) {
  try { state.settings = await api('/api/settings', { method: 'POST', body: patch }); } catch (e) { toast(e.message); }
  if ('autostart' in patch && native) native.setAutostart(!!patch.autostart);
  return state.settings;
}
const debounced = (fn, ms = 450) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------------------------------------------------------------- speech out */
const cleanSpeech = t => t.replace(/[*_`#>~]/g, '').replace(/https?:\/\/\S+/g, 'link').replace(/\s+/g, ' ').trim();
function setSpeaking(on) { state.speaking = on; wsSend({ type: 'speaking', on }); }
function stopSpeaking() { try { state.audio && state.audio.pause(); } catch {} speechSynthesis && speechSynthesis.cancel(); if (state.speaking) setSpeaking(false); }
async function speak(text, { force = false } = {}) {
  const s = state.settings; if (!s || (!force && !s.speak_replies)) return;
  text = cleanSpeech(text); if (!text) return;
  stopSpeaking(); setSpeaking(true);
  try {
    if (state.status && state.status.neural_tts) {
      const r = await fetch(`/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(s.voice)}`, { headers: { 'x-paru-token': token } });
      if (r.ok) {
        const url = URL.createObjectURL(await r.blob()); state.audio = new Audio(url);
        await new Promise(res => { state.audio.onended = res; state.audio.onerror = res; state.audio.play().catch(res); });
        URL.revokeObjectURL(url); setSpeaking(false); return;
      }
    }
  } catch {}
  if (!('speechSynthesis' in window)) { setSpeaking(false); return; }
  const lang = /[\u0B80-\u0BFF]/.test(text) ? 'ta-IN' : /[\u0900-\u097F]/.test(text) ? 'hi-IN' : /[\u0C00-\u0C7F]/.test(text) ? 'te-IN' : (s.voice || 'en-US').slice(0, 5);
  const u = new SpeechSynthesisUtterance(text); u.lang = lang;
  const v = speechSynthesis.getVoices().find(v => v.lang === lang) || speechSynthesis.getVoices().find(v => v.lang.startsWith(lang.slice(0, 2)));
  if (v) u.voice = v;
  await new Promise(res => { u.onend = res; u.onerror = res; speechSynthesis.speak(u); });
  setSpeaking(false);
}

/* ---------------------------------------------------------------- microphone -> engine */
async function startMic() {
  if (state.mic) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.audioWorklet.addModule('/mic-worklet.js');
    const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, 'mic-processor'), mute = ctx.createGain();
    mute.gain.value = 0;
    node.port.onmessage = e => {
      if (state.ws && state.ws.readyState === 1) state.ws.send(e.data);
      if (state.onLevel) { const a = new Int16Array(e.data); let sum = 0; for (let i = 0; i < a.length; i += 8) sum += a[i] * a[i]; state.onLevel(Math.sqrt(sum / (a.length / 8)) / 32768); }
    };
    src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    state.mic = { stream, ctx };
    return true;
  } catch (e) {
    toast(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your system settings.' : 'No microphone found.');
    return false;
  }
}
function stopMic() { if (state.mic) { state.mic.stream.getTracks().forEach(t => t.stop()); state.mic.ctx.close(); state.mic = null; } }

/* ---------------------------------------------------------------- websocket */
function wsSend(o) { if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(o)); }
function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws?token=${token}`); state.ws = ws; let tries = connect.tries || 0;
  ws.onopen = () => { connect.tries = 0; state.connected = true; updateBanner(); };
  ws.onclose = () => { state.connected = false; updateBanner(); setTimeout(connect, Math.min(4000, 400 * ++connect.tries || 400)); };
  ws.onmessage = e => onEvent(JSON.parse(e.data));
}
function onEvent(ev) {
  switch (ev.type) {
    case 'hello': state.status = ev.status; ev.status.pending.forEach(p => addConfirm(p.id, p.text)); refreshAgent(); updateBanner(); break;
    case 'status': if (ev.error) { state.engineError = ev.error; updateBanner(); } break;
    case 'settings': state.settings = ev.settings; break;
    case 'message':
      state.thread.push({ role: ev.role, content: ev.content, channel: ev.channel, ts: Date.now() }); state.thinking = false; renderChat();
      if (ev.role === 'assistant' && ev.channel === 'voice') speak(ev.content);
      break;
    case 'thinking': state.thinking = !!ev.on; renderThinking(); break;
    case 'confirm': addConfirm(ev.id, ev.text); break;
    case 'confirm_done': state.thread = state.thread.filter(m => m.id !== ev.id); renderChat(); break;
    case 'orb': state.orbActive = !!ev.visible; refreshAgent(); if (!native) { webOrb(ev.visible); } break;
    case 'wake': stopSpeaking(); break;
    case 'stopped': stopSpeaking(); break;
    case 'notify': toast(ev.text, 6000); if (ev.speak) speak(ev.text, { force: true }); try { new Notification(ev.title, { body: ev.text }); } catch {} break;
    case 'notice': toast(ev.text, 5000); stopRecUI(); break;
    case 'enrolled': if (state.onEnrolled) state.onEnrolled(ev); break;
  }
}
function webOrb(on) {
  let o = $('.web-orb'); if (!o) { o = document.createElement('div'); o.className = 'web-orb'; o.innerHTML = '<img src="/assets/orb.webp" alt="">'; document.body.append(o); }
  o.style.width = o.style.height = (state.settings.orb_size || 150) + 'px'; o.classList.toggle('on', on && state.settings.orb_enabled);
}
function addConfirm(id, text) { if (!state.thread.some(m => m.id === id)) { state.thread.push({ type: 'confirm', id, content: text }); renderChat(); } }

/* ---------------------------------------------------------------- banner + sidebar state */
function updateBanner() {
  const b = $('#banner'), s = state.status; let t = '', m = '', warn = false;
  if (!state.connected) { t = "Paru's engine isn't running"; m = 'Trying to reconnect...'; }
  else if (state.engineError) { t = 'Voice engine error'; m = state.engineError; }
  else if (s && !s.asr.ok && state.settings && state.settings.permissions.microphone) { t = 'Voice recognition isn\'t installed'; m = s.asr.reason + '  (typing still works)'; warn = true; }
  b.hidden = !t; b.classList.toggle('warn', warn); $('#banner-title').textContent = t; $('#banner-msg').textContent = m;
  const on = state.settings && state.settings.listen_in_background; $('#listen-toggle').checked = !!on; $('#banner-state').textContent = on ? 'On' : 'Off';
  refreshAgent();
}
$('#listen-toggle').onchange = e => { saveSettings({ listen_in_background: e.target.checked }); updateBanner(); };
function refreshAgent() {
  const el = $('.agent-state'), lab = $('#agent-label'); el.classList.remove('on', 'listening');
  if (!state.connected) lab.textContent = 'Agent offline';
  else if (state.orbActive) { el.classList.add('listening'); lab.textContent = 'Listening'; }
  else { el.classList.add('on'); lab.textContent = state.settings && state.settings.listen_in_background ? 'Say "Alexi"' : 'Agent ready'; }
  $('#talk').classList.toggle('live', state.orbActive); $('#talk').textContent = state.orbActive ? 'Stop' : 'Talk';
}
$('#talk').onclick = async () => {
  if (state.orbActive) return wsSend({ type: 'deactivate' });
  if (state.settings.permissions.microphone) await startMic();
  wsSend({ type: 'activate' });
};

/* ---------------------------------------------------------------- navigation */
function show(view) {
  state.view = view;
  ['chat', 'history', 'settings'].forEach(v => $('#view-' + v).hidden = v !== view);
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.view === view && !(n.id !== 'nav-new' && view === 'chat')));
  if (view === 'history') renderHistory(); if (view === 'settings') renderSettings(); if (view === 'chat') renderChat();
  if (innerWidth <= 820) $('#shell').classList.add('collapsed');
}
document.querySelectorAll('.nav').forEach(n => n.onclick = () => { if (n.id === 'nav-new') { state.thread = state.thread.filter(m => m.type === 'confirm'); } show(n.dataset.view); });

/* ---------------------------------------------------------------- chat */
const CHIPS = ['Check my mail', 'My calendar', 'Set a timer for 5 minutes', 'Search the web', 'What can you do?'];
function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function buildChat() {
  const v = $('#view-chat');
  v.innerHTML = `<div class="hero" id="hero"><div class="orb-avatar"><img src="/assets/orb.webp" alt=""></div><h1></h1>
    <p>Ask in any language, or say "Alexi". Say "shut up" and I will go quiet.</p><div class="chips" id="chips"></div></div>
    <div class="thread" id="thread" hidden></div>
    <div class="composer"><form id="composer"><input id="msg" type="text" autocomplete="off" placeholder="Ask Paru anything, in any language..." aria-label="Message">
    <button type="button" class="round" id="mic" aria-label="Record a voice note"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button>
    <button type="submit" class="round send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></form></div>`;
  $('#chips').innerHTML = CHIPS.map(c => `<button class="chip">${esc(c)}</button>`).join('');
  $('#chips').onclick = e => { if (e.target.classList.contains('chip')) send(e.target.textContent); };
  $('#composer').onsubmit = e => { e.preventDefault(); const i = $('#msg'); const t = i.value.trim(); if (t) { i.value = ''; send(t); } };
  $('#mic').onclick = toggleRecording;
}
async function send(text) {
  stopSpeaking();
  try {
    const r = await api('/api/chat', { method: 'POST', body: { text, channel: 'text' } });
    if (!state.connected) { state.thread.push({ role: 'user', content: text }, { role: 'assistant', content: r.reply }); renderChat(); }
  } catch (e) { toast(e.message); }
}
function renderChat() {
  if (state.view !== 'chat' || !$('#hero')) return;
  const empty = state.thread.length === 0 && !state.thinking;
  $('#hero').hidden = !empty; $('#thread').hidden = empty;
  $('#hero h1').textContent = `${greet()}${state.settings.name ? ', ' + state.settings.name : ''}`;
  const th = $('#thread'); th.innerHTML = '';
  const ordered = [...state.thread.filter(m => m.type !== 'confirm'), ...state.thread.filter(m => m.type === 'confirm')];
  for (const m of ordered) {
    const d = document.createElement('div');
    if (m.type === 'confirm') {
      d.className = 'confirm'; d.innerHTML = '<div></div><div class="row"><button class="btn primary">Allow</button><button class="btn danger">Deny</button></div>';
      d.firstChild.textContent = m.content;
      const [ok, no] = d.querySelectorAll('button');
      ok.onclick = no.onclick = async ev => { ev.target.parentNode.querySelectorAll('button').forEach(b => b.disabled = true); try { await api('/api/confirm', { method: 'POST', body: { id: m.id, approve: ev.target === ok } }); } catch (e) { toast(e.message); } };
    } else {
      d.className = 'msg ' + m.role; d.textContent = m.content;
      if (m.channel === 'voice') { const s = document.createElement('small'); s.textContent = 'voice'; d.append(s); }
    }
    th.append(d);
  }
  renderThinking(true);
  th.scrollTop = th.scrollHeight;
}
function renderThinking(skip) {
  const th = $('#thread'); if (!th) return; th.querySelectorAll('.thinking').forEach(n => n.remove());
  if (state.thinking) { const d = document.createElement('div'); d.className = 'msg assistant thinking'; d.textContent = 'Thinking'; th.append(d); th.hidden = false; $('#hero').hidden = true; th.scrollTop = th.scrollHeight; }
}
async function toggleRecording() {
  const btn = $('#mic');
  if (!state.recording) {
    if (!state.settings.permissions.microphone) return toast('Turn on Microphone in Settings -> Permissions first.');
    if (!(await startMic())) return;
    stopSpeaking(); state.recording = true; btn.classList.add('rec'); wsSend({ type: 'ptt_start' });
  } else { stopRecUI(); wsSend({ type: 'ptt_stop' }); state.thinking = true; renderThinking(); }
}
function stopRecUI() { state.recording = false; const b = $('#mic'); b && b.classList.remove('rec'); }

/* ---------------------------------------------------------------- history */
async function renderHistory() {
  const v = $('#view-history'); v.innerHTML = '<div class="split"><div class="days" id="days"></div><div class="day-main" id="day-main"></div></div>';
  let days = []; try { days = await api('/api/history'); } catch (e) { toast(e.message); }
  const list = $('#days');
  if (!days.length) { $('#day-main').innerHTML = '<div class="empty">No chats yet. Everything you type or say to Paru is saved here by date, on this device only.</div>'; list.innerHTML = ''; return; }
  list.innerHTML = days.map(d => `<button class="day" data-day="${d.day}"><b>${d.label}</b><span>${d.text} text, ${d.voice} voice</span></button>`).join('');
  list.onclick = e => { const b = e.target.closest('.day'); if (b) openDay(b.dataset.day); };
  openDay(state.activeDay && days.some(d => d.day === state.activeDay) ? state.activeDay : days[0].day, days);
}
async function openDay(day, days) {
  state.activeDay = day; document.querySelectorAll('.day').forEach(b => b.classList.toggle('active', b.dataset.day === day));
  const label = day.split('-').reverse().join('-'); const main = $('#day-main');
  main.innerHTML = `<div class="day-head"><h2>${label}</h2><button class="btn primary" id="sum">Summarize this day</button><button class="btn danger" id="del">Delete</button></div><div id="sumbox"></div><div class="thread" id="daythread"></div>`;
  const msgs = await api('/api/history/' + day);
  const th = $('#daythread');
  th.innerHTML = msgs.map(m => `<div class="msg ${m.role}">${esc(m.content)}<small>${new Date(m.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${m.channel === 'voice' ? ' · voice' : ''}</small></div>`).join('');
  $('#sum').onclick = async ev => {
    const b = ev.target; b.disabled = true; b.textContent = 'Summarizing...';
    try { const { summary } = await api('/api/summarize/' + day, { method: 'POST' }); $('#sumbox').innerHTML = `<div class="summary">${esc(summary)}</div>`; speak(summary, { force: true }); }
    catch (e) { toast(e.message); } b.disabled = false; b.textContent = 'Summarize this day';
  };
  $('#del').onclick = async () => { if (confirm(`Delete all chats from ${label}?`)) { await api('/api/history/' + day, { method: 'DELETE' }); state.activeDay = null; renderHistory(); } };
}

/* ---------------------------------------------------------------- settings */
const PERMS = [['microphone', 'Microphone', 'Listen for "Alexi" and take voice notes'], ['speaker', 'Speaker', 'Speak replies out loud'],
  ['media', 'Videos and photos', 'Find and open your pictures and videos'], ['files', 'Files', 'Find, download and upload files'], ['apps', 'Apps', 'Open, close, install and operate apps, lock the screen']];
function schema() {
  const s = state.status || { tools: [], asr: {}, voice_id: {} };
  return [
    { t: 'Profile', f: [{ k: 'name', l: 'Your name', ty: 'text' }, { k: 'language', l: 'Speech language', h: 'Auto detects English, Tamil, Hindi and more', ty: 'select',
      o: [['auto', 'Auto detect'], ['en', 'English'], ['ta', 'Tamil'], ['hi', 'Hindi'], ['te', 'Telugu'], ['ml', 'Malayalam'], ['kn', 'Kannada'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['ar', 'Arabic']] }] },
    { t: 'Voice and wake word', h: s.asr.ok ? '' : 'Voice recognition is not installed on this device yet: ' + (s.asr.reason || ''), f: [
      { k: 'wake_words.0', l: 'Wake word', h: 'Say it and the orb appears. Similar spellings are matched too.', ty: 'text' },
      { k: 'stop_words.0', l: 'Quiet phrase', h: 'Say it and the orb goes away', ty: 'text' },
      { k: 'listen_in_background', l: 'Listen in the background', ty: 'toggle' },
      { k: 'only_my_voice', l: 'Only answer my voice', h: s.voice_id.ok ? (s.voice_id.enrolled ? 'Your voice is saved on this device' : 'Record your voice first') : 'Needs: pip install resemblyzer. Convenience filter, not security.', ty: 'toggle' },
      { l: 'My voice', ty: 'button', b: 'Record again', a: 'enroll' },
      { k: 'speak_replies', l: 'Speak replies', ty: 'toggle' },
      { k: 'voice', l: 'Reply voice', h: s.neural_tts ? 'Natural voices' : 'Using system voices. For natural voices: pip install edge-tts', ty: 'voice' },
      { k: 'whisper_model', l: 'Recognition quality', h: 'Bigger is more accurate but slower', ty: 'select', o: [['tiny', 'Fastest (tiny)'], ['base', 'Balanced (base)'], ['small', 'Most accurate (small)']] }] },
    { t: 'Orb', f: [{ k: 'orb_enabled', l: 'Show the orb on screen', ty: 'toggle' }, { k: 'orb_size', l: 'Orb size', ty: 'range', min: 90, max: 300 }] },
    { t: 'AI', h: 'Free key at aistudio.google.com. Without it, Paru still handles built-in commands offline.', f: [
      { k: 'gemini_key', l: 'Gemini API key', ty: 'password' }, { k: 'gemini_model', l: 'Model', h: 'gemini-flash-latest is a good default', ty: 'text' },
      { k: 'auto_switch_models', l: 'Switch model when a limit is reached', h: 'If the main model hits its free limit, Paru continues with a backup model', ty: 'toggle' },
      { k: 'fallback_models', l: 'Backup models', h: 'Comma separated, tried in order', ty: 'text' },
      { k: 'thinking', l: 'Response speed', h: 'Fast turns the model\'s extra thinking down. Smart is slower but better for hard questions.', ty: 'select', o: [['fast', 'Fast'], ['smart', 'Smart (slower)']] },
      { k: 'fast_commands', l: 'Instant simple commands', h: 'Timers, time, lock and opening apps skip the AI and run immediately', ty: 'toggle' }, { l: 'Check connection', ty: 'button', b: 'Test', a: 'test/gemini' }] },
    { t: 'Mail', h: 'Use an app password (Gmail: Google Account -> Security -> App passwords). Stored only on this device.', f: [
      { k: 'mail.address', l: 'Email address', ty: 'text' }, { k: 'mail.app_password', l: 'App password', ty: 'password' }, { k: 'mail.imap_host', l: 'IMAP server', ty: 'text' },
      { k: 'mail.smtp_host', l: 'SMTP server', ty: 'text' }, { l: 'Check connection', ty: 'button', b: 'Test', a: 'test/mail' }] },
    { t: 'Calendar', h: 'Google Calendar: Settings -> your calendar -> Integrate calendar -> Secret address in iCal format.', f: [
      { k: 'calendar_ics', l: 'iCal link or file path', ty: 'text' }, { l: 'Check connection', ty: 'button', b: 'Test', a: 'test/calendar' }] },
    { t: 'Accounts', h: 'Client IDs for sign-in. Create them free in the Google Cloud console and GitHub developer settings.', f: [
      { k: 'oauth.google_client_id', l: 'Google client ID', ty: 'text' }, { k: 'oauth.github_client_id', l: 'GitHub client ID', ty: 'text' }] },
    { t: 'Permissions', f: PERMS.map(p => ({ k: 'permissions.' + p[0], l: p[1], h: p[2], ty: 'toggle' })) },
    { t: 'Safety', f: [{ k: 'confirm_risky', l: 'Ask before risky actions', h: 'Install, uninstall, close apps, send email, update, lock, download, upload, call, typing', ty: 'toggle' }] },
    { t: 'Appearance and startup', f: [{ k: 'theme', l: 'Theme', ty: 'select', o: [['dark', 'Dark'], ['light', 'Light']] }, { k: 'autostart', l: 'Start Paru when I sign in', ty: 'toggle' }] },
    { t: 'Your data', h: 'Chats, voice profile, settings and keys are stored only in your Paru folder on this device.', f: [
      { l: 'Delete all chat history', ty: 'button', b: 'Delete', a: 'clear', danger: true }] },
  ];
}
async function renderSettings() {
  const v = $('#view-settings'); state.status = await api('/api/status').catch(() => state.status);
  v.innerHTML = '<div class="settings"><h2>Settings</h2></div>'; const box = v.firstChild;
  for (const g of schema()) {
    const el = document.createElement('div'); el.className = 'group'; el.innerHTML = `<h3>${esc(g.t)}</h3>${g.h ? `<p class="hint">${esc(g.h)}</p>` : ''}`;
    for (const f of g.f) el.append(field(f));
    box.append(el);
  }
  const tools = document.createElement('div'); tools.className = 'group';
  tools.innerHTML = `<h3>What Paru can do</h3><p class="hint">${state.status.tools.length} skills are installed. Just ask in plain words.</p><div class="tools">${state.status.tools.map(t => `<code>${esc(t)}</code>`).join('')}</div>`;
  box.append(tools);
}
function field(f) {
  const row = document.createElement('div'); row.className = 'field';
  row.innerHTML = `<div class="lab">${esc(f.l)}${f.h ? `<small>${esc(f.h)}</small>` : ''}</div>`;
  const cur = f.k ? getPath(state.settings, f.k) : null; let ctl;
  const save = debounced(async v => { const patch = setPath({}, f.k, v); if (f.k.startsWith('wake_words') || f.k.startsWith('stop_words')) { const key = f.k.split('.')[0]; const list = [...state.settings[key]]; list[0] = v; Object.assign(patch, { [key]: list }); }
    await saveSettings(patch); if (f.k === 'theme') applyTheme(v); if (f.k.startsWith('permissions.microphone') && v) startMic(); if (f.k === 'listen_in_background') updateBanner(); if (f.k.startsWith('mail') || f.k.startsWith('gemini')) refreshStatus(); });
  if (f.ty === 'toggle') { ctl = document.createElement('span'); ctl.className = 'switch'; ctl.innerHTML = '<input type="checkbox" aria-label=""><i></i>'; const i = ctl.firstChild; i.setAttribute('aria-label', f.l); i.checked = !!cur; i.onchange = () => save(i.checked); }
  else if (f.ty === 'select') { ctl = document.createElement('select'); ctl.innerHTML = f.o.map(o => `<option value="${o[0]}">${esc(o[1])}</option>`).join(''); ctl.value = cur; ctl.onchange = () => save(ctl.value); }
  else if (f.ty === 'range') { ctl = document.createElement('input'); ctl.type = 'range'; ctl.min = f.min; ctl.max = f.max; ctl.value = cur; ctl.oninput = () => save(+ctl.value); }
  else if (f.ty === 'voice') { ctl = document.createElement('select'); ctl.innerHTML = `<option>${esc(cur)}</option>`; api('/api/voices').then(vs => { ctl.innerHTML = vs.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join(''); ctl.value = cur; }); ctl.onchange = () => { save(ctl.value); speak('Hi, this is how I sound.', { force: true }); }; }
  else if (f.ty === 'button') { ctl = document.createElement('button'); ctl.className = 'btn' + (f.danger ? ' danger' : ''); ctl.textContent = f.b; ctl.onclick = () => action(f.a, ctl); }
  else { ctl = document.createElement('input'); ctl.type = f.ty === 'password' ? 'password' : 'text'; ctl.value = cur ?? ''; ctl.autocomplete = 'off'; ctl.spellcheck = false; ctl.setAttribute('aria-label', f.l); ctl.oninput = () => save(ctl.value); }
  if (f.k && f.k.includes('wake_words') || f.k && f.k.includes('stop_words')) ctl.value = getPath(state.settings, f.k) ?? '';
  row.append(ctl); return row;
}
async function refreshStatus() { state.status = await api('/api/status').catch(() => state.status); updateBanner(); }
async function action(a, btn) {
  if (a === 'clear') { if (confirm('Delete ALL chat history on this device? This cannot be undone.')) { await api('/api/history', { method: 'DELETE' }); toast('History deleted.'); } return; }
  if (a === 'enroll') return runOnboarding('voice', true);
  if (a.startsWith('test/')) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Testing...';
    try { const r = await api('/api/' + a, { method: 'POST' }); toast(r.ok ? 'Connected. ' + (r.result || r.reply || '').toString().slice(0, 80) : (r.error || 'Failed'), 5000); } catch (e) { toast(e.message); }
    btn.disabled = false; btn.textContent = old;
  }
}

/* ---------------------------------------------------------------- first-run: login -> permissions -> voice */
const dots = n => `<div class="steps">${[0, 1, 2].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
const AVATAR = '<div class="orb-avatar"><img src="/assets/orb.webp" alt=""></div>';
function runOnboarding(step, fromSettings = false) {
  const el = $('#onboarding'); $('#shell').hidden = true; el.hidden = false; state.step = step; state.fromSettings = fromSettings;
  ({ login: stepLogin, perms: stepPerms, voice: stepVoice })[step](el);
}
function stepLogin(el) {
  el.innerHTML = `<div class="card">${dots(0)}${AVATAR}<h1>Welcome to Paru</h1><p class="sub">Your assistant and agent. Your chats and voice stay on this device.</p>
    <button class="provider" data-p="google"><b>G</b> Continue with Google / Gmail</button>
    <button class="provider" data-p="apple"><b>A</b> Continue with Apple</button>
    <button class="provider" data-p="github"><b>GH</b> Continue with GitHub</button>
    <div class="or">or</div><input type="text" id="lname" placeholder="Just use my name" maxlength="40" aria-label="Your name" autocomplete="name">
    <button class="btn primary" id="lgo">Continue</button><div class="err" id="lerr" role="alert"></div><div id="lextra"></div></div>`;
  const err = m => $('#lerr').textContent = m;
  $('#lgo').onclick = async () => { const n = $('#lname').value.trim(); if (!n) return err('Type your name to continue, or use one of the accounts above.');
    try { await api('/api/login/local', { method: 'POST', body: { name: n } }); state.settings = await api('/api/settings'); runOnboarding('perms'); } catch (e) { err(e.message); } };
  $('#lname').onkeydown = e => e.key === 'Enter' && $('#lgo').click();
  el.querySelectorAll('.provider').forEach(b => b.onclick = () => oauthLogin(b.dataset.p, err));
}
async function oauthLogin(p, err) {
  err(''); const extra = $('#lextra'); extra.innerHTML = '';
  const r = await api(`/api/oauth/${p}/start`, { method: 'POST' }).catch(e => ({ ok: false, error: e.message }));
  if (!r.ok) {
    err(r.error);
    if (p !== 'apple' && /client id/i.test(r.error)) {
      extra.innerHTML = `<input type="text" id="cid" placeholder="Paste your ${p} client ID" aria-label="Client ID"><button class="btn" id="csave" style="margin-top:8px">Save and try again</button>`;
      $('#csave').onclick = async () => { const v = $('#cid').value.trim(); if (!v) return; await saveSettings({ oauth: { [p + '_client_id']: v } }); oauthLogin(p, err); };
    } return;
  }
  if (r.flow === 'device') extra.innerHTML = `<p class="sub">Enter this code on GitHub:</p><div class="codebox">${esc(r.user_code)}</div>`;
  else extra.innerHTML = '<p class="sub">Finish signing in in the browser window that opened...</p>';
  window.open(r.url, '_blank');
  for (let i = 0; i < 300; i++) {
    await sleep(r.flow === 'device' ? 5000 : 1500);
    const s = await api(`/api/oauth/${p}/poll`).catch(() => ({ status: 'pending' }));
    if (s.status === 'ok') { state.settings = await api('/api/settings'); return runOnboarding('perms'); }
    if (s.status === 'error') return err(s.error);
  }
  err('Sign-in timed out. Please try again.');
}
function stepPerms(el) {
  const p = state.settings.permissions;
  el.innerHTML = `<div class="card">${dots(1)}<h1>Let Paru help</h1><p class="sub">Choose what Paru may use. You can change this any time in Settings.</p>
    ${PERMS.map(x => `<div class="perm"><div class="lab"><b>${x[1]}</b><small>${x[2]}</small></div><span class="switch"><input type="checkbox" data-k="${x[0]}" aria-label="${x[1]}" ${p[x[0]] ? 'checked' : ''}><i></i></span></div>`).join('')}
    <div class="err" id="perr" role="alert"></div><button class="btn primary" id="pgo">Continue</button><button class="btn" id="pall">Allow everything</button></div>`;
  const boxes = [...el.querySelectorAll('input[data-k]')];
  $('#pall').onclick = () => boxes.forEach(b => b.checked = true);
  $('#pgo').onclick = async () => {
    const patch = {}; boxes.forEach(b => patch[b.dataset.k] = b.checked);
    if (patch.microphone && !(await startMic())) { patch.microphone = false; boxes.find(b => b.dataset.k === 'microphone').checked = false; $('#perr').textContent = 'Microphone access was blocked, so voice is off. Allow it in your system settings, then turn it on in Settings.'; await saveSettings({ permissions: patch }); return; }
    if (patch.speaker) { try { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); g.gain.value = .06; o.frequency.value = 660; o.connect(g); g.connect(c.destination); o.start(); setTimeout(() => { o.stop(); c.close(); }, 180); } catch {} }
    await saveSettings({ permissions: patch }); runOnboarding('voice');
  };
}
function stepVoice(el) {
  const w = (state.settings.wake_words[0] || 'alexi'); const W = w[0].toUpperCase() + w.slice(1); const vid = state.status && state.status.voice_id;
  el.innerHTML = `<div class="card">${state.fromSettings ? '' : dots(2)}<h1>Teach Paru your voice</h1>
    <p class="sub">Press record and read this out loud, naturally. Paru saves your voice on this device so it answers only you.</p>
    <div class="say">"Hey ${esc(W)}, this is my voice. Please open my calendar and check my mail."</div>
    <div class="meter" aria-hidden="true"><i id="lvl"></i></div><div class="err" id="verr" role="alert"></div>
    ${vid && !vid.ok ? '<p class="sub">The voice-matching add-on isn\'t installed yet (pip install resemblyzer), so Paru will answer to the wake word from any voice for now.</p>' : ''}
    <button class="btn primary" id="vrec">Start recording</button><button class="btn" id="vskip">${state.fromSettings ? 'Cancel' : 'Skip for now'}</button></div>`;
  const finish = async () => { state.onLevel = null; if (state.fromSettings) { $('#onboarding').hidden = true; $('#shell').hidden = false; return show('settings'); } await saveSettings({ onboarded: true }); enterApp(); toast(`All set. Say "${W}" any time.`, 5000); };
  $('#vskip').onclick = finish;
  $('#vrec').onclick = async ev => {
    const b = ev.target, err = m => $('#verr').textContent = m; err('');
    if (!(await startMic())) return err('Microphone is not available. Allow it in system settings.');
    b.disabled = true; wsSend({ type: 'enroll_start' }); state.onLevel = l => $('#lvl').style.width = Math.min(100, l * 500) + '%';
    for (let s = 7; s > 0; s--) { b.textContent = `Recording... ${s}`; await sleep(1000); }
    b.textContent = 'Saving...'; state.onEnrolled = r => { state.onLevel = null; state.onEnrolled = null; if (r.ok) { toast('Voice saved.'); finish(); } else { err(r.error); b.disabled = false; b.textContent = 'Try again'; } };
    wsSend({ type: 'enroll_stop' });
  };
}

/* ---------------------------------------------------------------- start */
function enterApp() {
  $('#onboarding').hidden = true; $('#shell').hidden = false; buildChat(); show('chat'); updateBanner(); webOrb(false);
  if (state.settings.permissions.microphone && state.settings.listen_in_background) startMic();
}
async function boot() {
  for (let i = 0; i < 60; i++) { try { state.settings = await api('/api/settings'); break; } catch { await sleep(500); } }
  if (!state.settings) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">Paru\'s engine did not start. Run it from a terminal to see the error: <code>python -m agent.server</code></p>'; return; }
  applyTheme(state.settings.theme); state.status = await api('/api/status').catch(() => null); connect();
  if (!state.settings.onboarded) runOnboarding('login'); else enterApp();
  if (native && state.settings.autostart) native.setAutostart(true);
}
boot();
