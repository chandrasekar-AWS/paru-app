import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, Upload, Plus, ArrowUp, ArrowDown, LogOut, X, DatabaseBackup, Download, RotateCcw } from 'lucide-react';
import { api, setToken, uploadImage, deleteMedia, tokenExpiry, goToLogin } from '../utils/api';
import { useContent } from '../context/ContentContext';
import './Admin.css';

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const TABS = ['Gallery', 'Reviews', 'Services', 'Enquiries', 'Backups'];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { refresh } = useContent();
  const [ready, setReady] = useState(false);
  const [warn, setWarn] = useState(false);
  const [tab, setTab] = useState('Gallery');
  const [toast, setToast] = useState(null);
  const [left, setLeft] = useState(null);

  useEffect(() => {
    document.title = 'Admin';
    api('/api/login')
      .then((d) => { setWarn(d.usingDefaults); setReady(true); })
      .catch(() => { setToken(''); navigate('/admin/login', { replace: true }); });
  }, [navigate]);

  // Auto-logout: counts down to the session end, then signs out.
  useEffect(() => {
    const exp = tokenExpiry();
    if (!exp) return undefined;
    const tick = () => {
      const ms = exp - Date.now();
      if (ms <= 0) goToLogin(true); else setLeft(ms);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ready]);

  const say = (text, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3500);
  };
  const save = async (payload, msg = 'Saved ✓') => {
    try { await api('/api/content', { method: 'PUT', body: payload }); await refresh(); say(msg); return true; }
    catch (e) { say(e.message, false); return false; }
  };
  const logout = () => goToLogin(false);

  if (!ready) return <div className="adm-page"><p className="adm-muted" style={{ padding: '3rem' }}>Checking sign-in…</p></div>;

  return (
    <div className="adm-page">
      <header className="adm-top">
        <img src="/logo/logo.png" alt="AD ZONEX" />
        <strong>Admin Home</strong>
        <span className="adm-spacer" />
        {left !== null && (
          <span className={`adm-pill${left > 5 * 60000 ? ' adm-pill--ok' : ''}`}>
            Auto logout in {String(Math.floor(left / 60000)).padStart(2, '0')}:{String(Math.floor(left / 1000) % 60).padStart(2, '0')}
          </span>
        )}
        <Link to="/" className="adm-btn">View website</Link>
        <button className="adm-btn" onClick={logout}><LogOut size={15} /> Log out</button>
      </header>

      {warn && (
        <div className="adm-warn">
          You are still using the <b>example ID / password / key</b>. Change them in
          <code> server/lib/admin-config.mjs </code> (make a new key with <code>npm run gen-key</code>), then restart.
        </div>
      )}

      <nav className="adm-tabs">
        {TABS.map((t) => (
          <button key={t} className={`adm-tab${tab === t ? ' adm-tab--on' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      <main className="adm-main">
        {tab === 'Gallery' && <GalleryTab save={save} say={say} />}
        {tab === 'Reviews' && <ReviewsTab save={save} />}
        {tab === 'Services' && <ServicesTab save={save} say={say} />}
        {tab === 'Enquiries' && <EnquiriesTab say={say} />}
        {tab === 'Backups' && <BackupsTab say={say} />}
      </main>

      {toast && <div className={`adm-toast${toast.ok ? '' : ' adm-toast--bad'}`}>{toast.text}</div>}
    </div>
  );
}

/* ───────────────────────── Gallery ───────────────────────── */
function GalleryTab({ save, say }) {
  const { gallery, sessions } = useContent();
  const [cat, setCat] = useState(sessions[0].id);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of files) {
        const image = await uploadImage(f);
        added.push({ id: uid(), image, category: cat, title: title.trim() || f.name.replace(/\.[^.]+$/, '') });
      }
      await save({ gallery: [...added, ...gallery] }, `${added.length} image(s) added to gallery ✓`);
      setTitle('');
    } catch (err) { say(err.message, false); }
    setBusy(false);
  };

  const update = (id, patch) => save({ gallery: gallery.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  const remove = async (g) => {
    if (!window.confirm(`Delete "${g.title}" from the gallery?`)) return;
    if (await save({ gallery: gallery.filter((x) => x.id !== g.id) }, 'Deleted ✓')) deleteMedia(g.image);
  };

  return (
    <section>
      <div className="adm-card">
        <h2>Upload to gallery</h2>
        <div className="adm-row">
          <label>Category
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="adm-grow">Title (optional)
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shop front ACP board" />
          </label>
          <label className="adm-btn adm-btn--primary adm-file">
            <Upload size={15} /> {busy ? 'Uploading…' : 'Choose images'}
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={upload} />
          </label>
        </div>
      </div>

      <p className="adm-muted">{gallery.length} images. Changes appear on the public Gallery page immediately.</p>
      <div className="adm-grid">
        {gallery.map((g) => <GalleryItem key={g.id} g={g} sessions={sessions} onSave={update} onDelete={remove} />)}
      </div>
    </section>
  );
}

function GalleryItem({ g, sessions, onSave, onDelete }) {
  const [title, setTitle] = useState(g.title);
  const [category, setCategory] = useState(g.category);
  const dirty = title !== g.title || category !== g.category;
  return (
    <div className="adm-item">
      <img src={g.image} alt={g.title} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} />
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
      <div className="adm-actions">
        <button className="adm-btn adm-btn--primary" disabled={!dirty} onClick={() => onSave(g.id, { title, category })}>Save</button>
        <button className="adm-btn adm-btn--danger" onClick={() => onDelete(g)} aria-label="Delete"><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

/* ───────────────────────── Reviews ───────────────────────── */
function ReviewsTab({ save }) {
  const { reviews } = useContent();
  const [draft, setDraft] = useState({ quote: '', name: '', role: 'Customer' });

  const add = async () => {
    if (!draft.quote.trim() || !draft.name.trim()) return;
    if (await save({ reviews: [...reviews, { id: uid(), ...draft }] }, 'Review added ✓')) setDraft({ quote: '', name: '', role: 'Customer' });
  };

  return (
    <section>
      <div className="adm-card">
        <h2>Add a review</h2>
        <label>Review text
          <textarea rows={3} value={draft.quote} onChange={(e) => setDraft({ ...draft, quote: e.target.value })} />
        </label>
        <div className="adm-row">
          <label className="adm-grow">Customer name
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="adm-grow">Role / business
            <input value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
          </label>
          <button className="adm-btn adm-btn--primary" onClick={add}><Plus size={15} /> Add review</button>
        </div>
      </div>

      <div className="adm-list">
        {reviews.map((r) => (
          <ReviewItem key={r.id} r={r}
            onSave={(v) => save({ reviews: reviews.map((x) => (x.id === r.id ? { ...x, ...v } : x)) })}
            onDelete={() => window.confirm('Delete this review?') && save({ reviews: reviews.filter((x) => x.id !== r.id) }, 'Deleted ✓')} />
        ))}
        {!reviews.length && <p className="adm-muted">No reviews yet.</p>}
      </div>
    </section>
  );
}

function ReviewItem({ r, onSave, onDelete }) {
  const [v, setV] = useState({ quote: r.quote, name: r.name, role: r.role });
  const dirty = v.quote !== r.quote || v.name !== r.name || v.role !== r.role;
  return (
    <div className="adm-card">
      <textarea rows={3} value={v.quote} onChange={(e) => setV({ ...v, quote: e.target.value })} />
      <div className="adm-row">
        <input className="adm-grow" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
        <input className="adm-grow" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })} />
        <button className="adm-btn adm-btn--primary" disabled={!dirty} onClick={() => onSave(v)}>Save</button>
        <button className="adm-btn adm-btn--danger" onClick={onDelete} aria-label="Delete"><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

/* ───────────────────────── Services ───────────────────────── */
function ServicesTab({ save, say }) {
  const { sessions } = useContent();
  const [cat, setCat] = useState(sessions[0].id);
  const session = sessions.find((s) => s.id === cat);
  const [list, setList] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setList(session.services.map((s) => ({ name: s.name, description: s.description || '', images: [...(s.images ?? (s.image ? [s.image] : []))] })));
    setDirty(false);
  }, [cat, session]);

  const edit = (i, patch) => { setList((l) => l.map((s, k) => (k === i ? { ...s, ...patch } : s))); setDirty(true); };
  const move = (i, d) => {
    const j = i + d; if (j < 0 || j >= list.length) return;
    const l = [...list]; [l[i], l[j]] = [l[j], l[i]]; setList(l); setDirty(true);
  };
  const del = (i) => { if (window.confirm(`Delete "${list[i].name}"?`)) { setList(list.filter((_, k) => k !== i)); setDirty(true); } };
  const add = () => { setList([...list, { name: 'New service', description: '', images: [] }]); setDirty(true); };
  const addImages = async (i, files) => {
    setBusy(true);
    try {
      const urls = [];
      for (const f of files) urls.push(await uploadImage(f));
      edit(i, { images: [...list[i].images, ...urls] });
    } catch (e) { say(e.message, false); }
    setBusy(false);
  };

  return (
    <section>
      <div className="adm-card">
        <div className="adm-row">
          <label>Category
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <span className="adm-grow" />
          <button className="adm-btn" onClick={add}><Plus size={15} /> Add service</button>
          <button className="adm-btn adm-btn--primary" disabled={!dirty || busy}
            onClick={async () => { if (await save({ services: { [cat]: list } }, 'Services saved ✓')) setDirty(false); }}>
            Save changes
          </button>
        </div>
        {dirty && <p className="adm-muted">You have unsaved changes.</p>}
      </div>

      {list.map((s, i) => (
        <div className="adm-card" key={i}>
          <div className="adm-row">
            <input className="adm-grow adm-title" value={s.name} onChange={(e) => edit(i, { name: e.target.value })} />
            <button className="adm-btn" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={15} /></button>
            <button className="adm-btn" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={15} /></button>
            <button className="adm-btn adm-btn--danger" onClick={() => del(i)} aria-label="Delete service"><Trash2 size={15} /></button>
          </div>
          <textarea rows={4} placeholder="Description" value={s.description} onChange={(e) => edit(i, { description: e.target.value })} />
          <div className="adm-thumbs">
            {s.images.map((src, k) => (
              <div className="adm-thumb" key={src + k}>
                <img src={src} alt="" />
                <button onClick={() => edit(i, { images: s.images.filter((_, x) => x !== k) })} aria-label="Remove image"><X size={13} /></button>
              </div>
            ))}
            <label className="adm-thumb adm-thumb--add">
              <Upload size={18} />
              <input type="file" accept="image/*" multiple hidden disabled={busy}
                onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) addImages(i, f); }} />
            </label>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ───────────────────────── Enquiries ───────────────────────── */
function EnquiriesTab({ say }) {
  const [items, setItems] = useState(null);
  const load = () => api('/api/enquiries').then((d) => setItems(d.items)).catch((e) => say(e.message, false));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const del = async (key) => {
    if (!window.confirm('Delete this enquiry?')) return;
    await api(`/api/enquiries?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    load();
  };
  if (!items) return <p className="adm-muted">Loading…</p>;
  return (
    <section className="adm-list">
      <p className="adm-muted">Every message from the Contact page is saved here, even if the email fails.</p>
      {items.map((q) => (
        <div className="adm-card" key={q.key}>
          <div className="adm-row">
            <strong className="adm-grow">{q.name} · {q.service || 'General enquiry'}</strong>
            <span className={`adm-pill${q.emailed ? ' adm-pill--ok' : ''}`}>{q.emailed ? `Emailed → ${q.sentTo}` : `Saved here · server email off (${q.sentTo})`}</span>
            <button className="adm-btn adm-btn--danger" onClick={() => del(q.key)} aria-label="Delete"><Trash2 size={15} /></button>
          </div>
          <p className="adm-muted">{new Date(q.at).toLocaleString()} · <a href={`mailto:${q.email}`}>{q.email}</a>{q.phone && ` · ${q.phone}`}{(q.city || q.state) && ` · ${[q.city, q.state].filter(Boolean).join(', ')}`}</p>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{q.message || '—'}</p>
        </div>
      ))}
      {!items.length && <p className="adm-muted">No enquiries yet.</p>}
    </section>
  );
}

/* ───────────────────────── Backups ───────────────────────── */
function BackupsTab({ say }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/api/backups').then((d) => setItems(d.items)).catch((e) => say(e.message, false));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const backupNow = async () => {
    setBusy(true);
    try { await api('/api/backups', { method: 'POST' }); say('Backup saved ✓'); load(); }
    catch (e) { say(e.message, false); }
    setBusy(false);
  };

  const restore = async (key) => {
    if (!window.confirm('Restore this backup? It will replace the current gallery, reviews and services.')) return;
    try { await api(`/api/backups?key=${encodeURIComponent(key)}`, { method: 'PUT' }); say('Restored ✓ — reload the site to see it.'); }
    catch (e) { say(e.message, false); }
  };

  const download = async (key) => {
    try {
      const token = (await import('../utils/api')).getToken();
      const res = await fetch(`/api/content`, { headers: { authorization: `Bearer ${token}` } });
      const live = await res.json();
      const blob = new Blob([JSON.stringify(live, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `adzone-backup-${key.split('/')[1] || 'current'}.json`;
      a.click();
    } catch (e) { say(e.message, false); }
  };

  if (!items) return <p className="adm-muted">Loading…</p>;
  return (
    <section>
      <div className="adm-card">
        <div className="adm-row">
          <div className="adm-grow">
            <h2 style={{ marginBottom: 4 }}>Backups</h2>
            <p className="adm-muted">A snapshot of your gallery, reviews and services is taken automatically every day (last 30 kept). You can also back up right now, or download the current data as a file.</p>
          </div>
          <button className="adm-btn" onClick={() => download('current')}><Download size={15} /> Download current data</button>
          <button className="adm-btn adm-btn--primary" disabled={busy} onClick={backupNow}><DatabaseBackup size={15} /> {busy ? 'Saving…' : 'Back up now'}</button>
        </div>
      </div>

      <div className="adm-list">
        {items.map((b) => (
          <div className="adm-card" key={b.key}>
            <div className="adm-row">
              <strong className="adm-grow">{new Date(b.at).toLocaleString()}</strong>
              <span className={`adm-pill${b.reason === 'auto' ? ' adm-pill--ok' : ''}`}>{b.reason === 'auto' ? 'Automatic' : 'Manual'}</span>
              <button className="adm-btn" onClick={() => download(b.key)}><Download size={14} /> Download</button>
              <button className="adm-btn" onClick={() => restore(b.key)}><RotateCcw size={14} /> Restore</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="adm-muted">No backups yet — click "Back up now", or wait for tonight's automatic one.</p>}
      </div>
    </section>
  );
}
