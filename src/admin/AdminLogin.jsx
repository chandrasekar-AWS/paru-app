import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, KeyRound, ShieldCheck, ShieldX, FileKey, Eye, EyeOff, Check, X as XIcon } from 'lucide-react';
import { api, getToken, setToken } from '../utils/api';
import './Admin.css';

// How long the green tick stays visible after a field is verified (ms)
const TICK_MS = 3000;
// Steps shown while the key file is processed
const KEY_STAGES = ['Uploading key file…', 'Decrypting key…', 'Verifying signature…'];
const STAGE_MS = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// true for TICK_MS after `status` becomes 'ok', then false again
function useTimedTick(status) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (status !== 'ok') { setOn(false); return undefined; }
    setOn(true);
    const t = setTimeout(() => setOn(false), TICK_MS);
    return () => clearTimeout(t);
  }, [status]);
  return on;
}

// Fixed-size slot at the right edge of a field so spinner / tick / cross line up perfectly
function StatusDot({ status, showOk = true }) {
  let inner = null;
  if (status === 'checking') inner = <span className="adm-dot adm-dot--busy" aria-label="Checking…" />;
  else if (status === 'ok' && showOk) inner = <span className="adm-dot adm-dot--ok" aria-label="Correct"><Check size={12} strokeWidth={3} /></span>;
  else if (status === 'bad') inner = <span className="adm-dot adm-dot--bad" aria-label="Incorrect"><XIcon size={12} strokeWidth={3} /></span>;
  return <span className="adm-slot">{inner}</span>;
}

export default function AdminLogin() {
  const navigate = useNavigate();
  const fileRef = useRef(null);

  const [id, setId] = useState('');
  const [idStatus, setIdStatus] = useState('none');
  const [idTicket, setIdTicket] = useState('');

  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [pwStatus, setPwStatus] = useState('none');
  const [pwTicket, setPwTicket] = useState('');

  const [key, setKey] = useState({ status: 'none', name: '', ticket: '', stage: 0 });

  const idTick = useTimedTick(idStatus);
  const pwTick = useTimedTick(pwStatus);
  const keyTick = useTimedTick(key.status);

  const [error, setError] = useState(
    new URLSearchParams(window.location.search).get('expired') ? 'Your session ended (60 minutes). Please sign in again.' : ''
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in';
    const m = document.createElement('meta');
    m.name = 'robots';
    m.content = 'noindex,nofollow';
    document.head.appendChild(m);
    if (getToken()) api('/api/login').then(() => navigate('/admin', { replace: true })).catch(() => setToken(''));
    return () => m.remove();
  }, [navigate]);

  const explain = (err) =>
    err.status === 404
      ? 'Cannot reach the login server. Stop the site (Ctrl+C) and start it again with: npm run dev'
      : err.message;

  const restartAll = () => {
    setIdStatus('none'); setIdTicket('');
    setPwStatus('none'); setPwTicket(''); setPassword('');
    setKey({ status: 'none', name: '', ticket: '', stage: 0 });
  };

  // ── Step 1: Admin ID ──────────────────────────────────────────
  const checkId = async () => {
    if (!id.trim() || idStatus === 'checking') return;
    setError('');
    setIdStatus('checking');
    try {
      const d = await api('/api/login', { method: 'POST', body: { action: 'checkId', id } });
      setIdStatus('ok');
      setIdTicket(d.ticket);
    } catch (err) {
      setIdStatus('bad');
      setError(explain(err));
    }
  };
  const onIdChange = (v) => {
    setId(v);
    if (idStatus !== 'none') { setIdStatus('none'); setIdTicket(''); setPwStatus('none'); setPwTicket(''); setKey({ status: 'none', name: '', ticket: '', stage: 0 }); }
  };

  // ── Step 2: Password ─────────────────────────────────────────
  const checkPassword = async () => {
    if (!password || pwStatus === 'checking' || idStatus !== 'ok') return;
    setError('');
    setPwStatus('checking');
    try {
      const d = await api('/api/login', { method: 'POST', body: { action: 'checkPassword', ticket: idTicket, password } });
      setPwStatus('ok');
      setPwTicket(d.ticket);
    } catch (err) {
      setPwStatus('bad');
      if (err.restart) restartAll();
      setError(explain(err));
    }
  };
  const onPwChange = (v) => {
    setPassword(v);
    if (pwStatus !== 'none') { setPwStatus('none'); setPwTicket(''); setKey({ status: 'none', name: '', ticket: '', stage: 0 }); }
  };

  // ── Step 3: Key file ──────────────────────────────────────────
  const chooseFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || pwStatus !== 'ok') return;
    setError('');
    if (file.size > 4000) { setKey({ status: 'bad', name: file.name, ticket: '' }); setError('That is not a valid key file.'); return; }
    setKey({ status: 'checking', name: file.name, ticket: '', stage: 0 });
    // Walk through the stages so the person can see what is happening
    const timers = KEY_STAGES.slice(1).map((_, i) =>
      setTimeout(() => setKey((k) => (k.status === 'checking' ? { ...k, stage: i + 1 } : k)), STAGE_MS * (i + 1))
    );
    try {
      const keyFile = await file.text();
      const [d] = await Promise.all([
        api('/api/login', { method: 'POST', body: { action: 'key', ticket: pwTicket, keyFile } }),
        sleep(STAGE_MS * KEY_STAGES.length),
      ]);
      setKey({ status: 'ok', name: file.name, ticket: d.ticket, stage: 0 });
    } catch (err) {
      setKey({ status: 'bad', name: file.name, ticket: '', stage: 0 });
      if (err.restart) restartAll();
      setError(explain(err));
    } finally {
      timers.forEach(clearTimeout);
    }
  };

  // ── Final sign in ────────────────────────────────────────────
  const submit = async (e) => {
    e.preventDefault();
    if (key.status !== 'ok' || busy) return;
    setBusy(true);
    setError('');
    try {
      const d = await api('/api/login', { method: 'POST', body: { action: 'login', ticket: key.ticket } });
      setToken(d.token);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err.restart) restartAll();
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  };

  const idLocked = idStatus === 'ok';
  const pwUnlocked = idStatus === 'ok';
  const pwLocked = pwStatus === 'ok';
  const keyUnlocked = pwStatus === 'ok';
  const readyToSignIn = key.status === 'ok';

  return (
    <div className="adm-login-page">
      <form className="adm-login-card" onSubmit={submit}>
        <img src="/logo/logo.png" alt="AD ZONEX" className="adm-login-logo" />
        <h1><Lock size={18} /> Admin Login</h1>

        {/* Step 1 — Admin ID */}
        <label>
          <span className="adm-step-label">Step 1 · Admin ID</span>
          <span className={`adm-input-wrap adm-input-wrap--${idStatus}`}>
            <input
              value={id}
              autoComplete="username"
              autoFocus
              disabled={idLocked}
              onChange={(e) => onIdChange(e.target.value)}
              onBlur={checkId}
              onKeyDown={(e) => { if (e.key === 'Enter' && idStatus !== 'ok') { e.preventDefault(); checkId(); } }}
            />
            <StatusDot status={idStatus} showOk={idTick} />
          </span>
        </label>

        {/* Step 2 — Password */}
        <label>
          <span className="adm-step-label">Step 2 · Password</span>
          <span className={`adm-input-wrap adm-input-wrap--${pwUnlocked ? pwStatus : 'none'}`}>
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              autoComplete="current-password"
              disabled={!pwUnlocked || pwLocked}
              placeholder={pwUnlocked ? '' : 'Verify Admin ID first'}
              onChange={(e) => onPwChange(e.target.value)}
              onBlur={checkPassword}
              onKeyDown={(e) => { if (e.key === 'Enter' && pwUnlocked && pwStatus !== 'ok') { e.preventDefault(); checkPassword(); } }}
            />
            {pwUnlocked && (
              <button type="button" className="adm-eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
            <StatusDot status={pwUnlocked ? pwStatus : 'none'} showOk={pwTick} />
          </span>
        </label>

        {/* Step 3 — Key file */}
        <div className="adm-key">
          <span className="adm-key-label"><KeyRound size={13} /> Step 3 · Access key file</span>
          <button
            type="button"
            className={`adm-keybox adm-keybox--${keyUnlocked ? key.status : 'none'}`}
            disabled={!keyUnlocked}
            onClick={() => fileRef.current?.click()}
          >
            {key.status === 'ok' && <ShieldCheck size={20} />}
            {key.status === 'bad' && <ShieldX size={20} />}
            {(key.status === 'none' || key.status === 'checking') && <FileKey size={20} />}
            <span>
              {!keyUnlocked && 'Verify your password first'}
              {keyUnlocked && key.status === 'none' && 'Choose your key file…'}
              {keyUnlocked && key.status === 'checking' && KEY_STAGES[key.stage]}
              {keyUnlocked && key.status === 'ok' && `Key verified · ${key.name}`}
              {keyUnlocked && key.status === 'bad' && `Invalid key · ${key.name}`}
            </span>
            {key.status === 'checking' && <span className="adm-spin-sm" aria-hidden="true" />}
            {key.status === 'ok' && keyTick && <span className="adm-dot adm-dot--ok adm-keybox-tick"><Check size={12} strokeWidth={3} /></span>}
            {key.status === 'checking' && (
              <span className="adm-progress" aria-hidden="true">
                <span style={{ width: `${((key.stage + 1) / KEY_STAGES.length) * 100}%` }} />
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" hidden onChange={chooseFile} />
        </div>

        {error && <p className="adm-error" role="alert">{error}</p>}

        {readyToSignIn && (
          <button className="adm-btn adm-btn--primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        )}
        <Link to="/" className="adm-link">← Back to website</Link>
      </form>
    </div>
  );
}
