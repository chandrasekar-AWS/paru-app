import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Phone, Mail, ArrowLeft, ChevronDown } from 'lucide-react';
import ServiceSlider from '../components/ServiceSlider';
import { SocialLink, WhatsAppIcon } from '../components/SocialIcons';
import { INDIA_LOCATIONS, INDIA_STATES } from '../data/indiaLocations';
import SiteHeader from '../components/SiteHeader';
import Footer from '../components/Footer';
import Button from '../components/Button';
import Toast from '../components/Toast';
import PhoneInput, { isPhonePossible } from '../components/PhoneInput';
import { CONTACT_INFO, SOCIALS, ENQUIRY_MAIL, findService, flattenServices, servicePath } from '../data/services';
import { useContent } from '../context/ContentContext';
import './ContactPage.css';



/**
 * Works out which "mode" the Contact page is in from the URL, synchronously,
 * so the default "Get in Touch" text never flashes before service text:
 *   /contact                       -> null  (Mode 1)
 *   /contact?service=<slug>        -> that service  (Mode 2)
 *   /contact?service=<category>    -> that category (Mode 2, category intro)
 *   /contact?service=<unknown>     -> null  (falls back to Mode 1, no error)
 */
function resolveContext(sessions, param) {
  if (!param) return null;
  const svc = findService(sessions, param);
  if (svc) {
    return {
      key: svc.slug,
      kind: 'service',
      label: svc.categoryLabel,
      title: svc.title,
      description: svc.description,
      images: svc.images,
      glowColor: svc.glowColor,
      dropdown: svc.title,
      message: `I'm interested in ${svc.title}.`,
      backTo: servicePath(svc.slug),
      backLabel: `Back to ${svc.title}`,
    };
  }
  const cat = sessions.find((x) => x.id === String(param).toLowerCase());
  if (cat) {
    const first = flattenServices(sessions).find((x) => x.category === cat.id);
    const images = cat.services
      .flatMap((sv) => (sv.images ?? (sv.image ? [sv.image] : [])).slice(0, 1))
      .filter((v, i, a) => a.indexOf(v) === i);
    return {
      key: `cat-${cat.id}`,
      kind: 'category',
      label: cat.label,
      title: cat.label,
      description: cat.description || '',
      images,
      glowColor: cat.glowColor,
      dropdown: first?.title ?? '',
      message: `I'm interested in ${first?.title ?? `${cat.label} services`}.`,
      backTo: `/service#${cat.id}`,
      backLabel: 'Back to Services',
    };
  }
  return null;
}

export default function ContactPage() {
  const [searchParams] = useSearchParams();
  const { sessions } = useContent();
  const categoryOf = (svcName) => sessions.find((s) => s.services.some((sv) => sv.name === svcName))?.id ?? 'general';

  const ctx = useMemo(() => resolveContext(sessions, searchParams.get('service')), [sessions, searchParams]);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    service: ctx?.dropdown ?? '',
    state: '',
    city: '',
    message: ctx?.message ?? '',
    website: '',
  });

  // When the URL changes without a remount (browser back/forward, another
  // Contact button), re-apply the pre-selection. A message the visitor has
  // edited is never overwritten.
  const prefilled = useRef(ctx?.message ?? '');
  const ctxKey = ctx?.key ?? '';
  useEffect(() => {
    setForm((f) => ({
      ...f,
      service: ctx?.dropdown ?? '',
      message: !f.message || f.message === prefilled.current ? (ctx?.message ?? '') : f.message,
    }));
    prefilled.current = ctx?.message ?? '';
  }, [ctxKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToForm = () => {
    document.getElementById('contact-form-anchor')?.scrollIntoView({ block: 'start' });
  };

  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const closeToast = useCallback(() => setToast(null), []);

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required.';
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email))
      errs.email = 'A valid email is required.';
    if (form.phone && !isPhonePossible(form.phone)) errs.phone = 'Enter a valid phone number for the selected country.';
    return errs;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((er) => ({ ...er, [name]: undefined }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (sending) return;
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setSending(true);
    setToast(null);
    try {
      const category = categoryOf(form.service);
      const to = category === 'design' ? ENQUIRY_MAIL.design : ENQUIRY_MAIL.other;
      let saved = false;
      let emailed = false;

      // 1) Save on the server; it emails too if SMTP is configured.
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...form, category }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 400) throw new Error(data.error || 'Please check your details.');
        saved = res.ok;
        emailed = !!data.emailed;
      } catch (err) {
        if (err.message && !/fetch|network/i.test(err.message)) throw err;
      }

      // 2) Not emailed by the server? Send straight to the right inbox via FormSubmit.
      if (!emailed) {
        let r = null;
        try {
        r = await fetch(`https://formsubmit.co/ajax/${to}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            _subject: `New enquiry: ${form.service || 'General'} — ${form.name}`,
            _template: 'table',
            _captcha: 'false',
            Name: form.name,
            email: form.email,
            Phone: form.phone || '-',
            Service: form.service || 'General enquiry',
            State: form.state || '-',
            City: form.city || '-',
            Message: form.message || '-',
          }),
        });
        } catch { /* FormSubmit unreachable — fine if the enquiry was saved above */ }
        const d = r ? await r.json().catch(() => ({})) : {};
        emailed = !!r && r.ok && String(d.success) !== 'false';
        if (!emailed && !saved) throw new Error('Could not send your message. Please call or WhatsApp us on +91 93423 07860.');
      }
      setToast({ id: Date.now(), type: 'success', title: 'Message received!', message: `We've received your message and will get back to you within one business day.` });
      setForm({ name: '', email: '', phone: '', service: ctx?.dropdown ?? '', state: '', city: '', message: ctx?.message ?? '', website: '' });
      setErrors({});
    } catch (err) {
      setToast({ id: Date.now(), type: 'error', title: 'Message not sent', message: err.message || 'Could not send your message. Please try again.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page contact-page">
      <SiteHeader activeHref="/contact" />

      <main>
      {ctx ? (
        /* Service-specific intro, shown above the form */
        <section className="contact-intro section--white" key={ctx.key} aria-label={`${ctx.title} intro`}>
          <div className="container">
            <Link to={ctx.backTo} className="contact-back"><ArrowLeft size={16} aria-hidden="true" /> {ctx.backLabel}</Link>
            <div className="contact-intro-grid">
              {ctx.images.length > 0 && (
                <div className="contact-intro-media">
                  <ServiceSlider images={ctx.images} alt={ctx.title} />
                </div>
              )}
              <div className="contact-intro-text">
                <span className="eyebrow">{ctx.label}</span>
                <h1>{ctx.title}</h1>
                {ctx.description && <p className="contact-intro-desc">{ctx.description}</p>}
                <div className="contact-intro-cta">
                  <Button onClick={scrollToForm} variant="primary">Enquire now</Button>
                  <span className="contact-scroll-hint"><ChevronDown size={18} aria-hidden="true" /> or fill in the form below</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="page-hero">
          <div className="container">
            <span className="eyebrow">Contact</span>
            <h1>Get in touch</h1>
            <p>Tell us what you need and we'll get back to you within one business day.</p>
          </div>
        </section>
      )}

      <div className="container contact-body section" id="contact-form-anchor">
        {/* ── Left: form ─────────────────────────────────────── */}
        <div className="contact-form-col">
            <form
              id="contact-form"
              className="contact-form"
              onSubmit={handleSubmit}
              noValidate
            >
              <div className="cf-row cf-row--2">
                <div className="cf-field">
                  <label htmlFor="cf-name">Name *</label>
                  <input
                    id="cf-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={form.name}
                    onChange={handleChange}
                    aria-describedby={errors.name ? 'cf-name-err' : undefined}
                    className={errors.name ? 'cf-input--error' : ''}
                  />
                  {errors.name && (
                    <span id="cf-name-err" className="cf-error">{errors.name}</span>
                  )}
                </div>

                <div className="cf-field">
                  <label htmlFor="cf-email">Email *</label>
                  <input
                    id="cf-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={handleChange}
                    aria-describedby={errors.email ? 'cf-email-err' : undefined}
                    className={errors.email ? 'cf-input--error' : ''}
                  />
                  {errors.email && (
                    <span id="cf-email-err" className="cf-error">{errors.email}</span>
                  )}
                </div>
              </div>

              <div className="cf-row cf-row--2">
                <div className="cf-field">
                  <label htmlFor="cf-phone">Phone</label>
                  <PhoneInput
                    id="cf-phone"
                    value={form.phone}
                    invalid={!!errors.phone}
                    onChange={(v) => { setForm((f) => ({ ...f, phone: v })); if (errors.phone) setErrors((er) => ({ ...er, phone: undefined })); }}
                  />
                  {errors.phone && <span className="cf-error">{errors.phone}</span>}
                </div>

                <div className="cf-field">
                  <label htmlFor="cf-service">Service</label>
                  <select
                    id="cf-service"
                    name="service"
                    value={form.service}
                    onChange={handleChange}
                  >
                    <option value="">Select a service</option>
                    {sessions.map((s) => (
                      <optgroup key={s.id} label={s.label}>
                        {s.services.map((sv) => (
                          <option key={`${s.id}-${sv.name}`} value={sv.name}>{sv.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>

              <div className="cf-row cf-row--2">
                <div className="cf-field">
                  <label htmlFor="cf-state">State</label>
                  <select
                    id="cf-state"
                    name="state"
                    value={form.state}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: '' }))}
                  >
                    <option value="">— Select state —</option>
                    {INDIA_STATES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div className="cf-field">
                  <label htmlFor="cf-city">City</label>
                  <select
                    id="cf-city"
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    disabled={!form.state}
                  >
                    <option value="">{form.state ? '— Select city —' : 'Select a state first'}</option>
                    {(INDIA_LOCATIONS[form.state] || []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* honeypot — hidden from people, bots fill it in */}
              <input type="text" name="website" value={form.website} onChange={handleChange} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }} />

              <div className="cf-field">
                <label htmlFor="cf-message">Message</label>
                <textarea
                  id="cf-message"
                  name="message"
                  rows={5}
                  placeholder="Describe what you're looking for…"
                  value={form.message}
                  onChange={handleChange}
                />
              </div>

              <div className="cf-submit">
                <Button type="submit" variant="primary" disabled={sending}>{sending ? 'Sending…' : 'Send message'}</Button>
              </div>
            </form>
        </div>

        {/* ── Right: contact details ──────────────────────────── */}
        <aside className="contact-details-col">
          <div className="contact-detail-card">
            <h2 className="contact-details-heading">Contact Details</h2>

            <a href={`tel:${CONTACT_INFO.phone.replace(/\s+/g, '')}`} className="contact-detail-row">
              <Phone size={18} />
              <span>{CONTACT_INFO.phone}</span>
            </a>

            <a href={CONTACT_INFO.whatsapp} target="_blank" rel="noreferrer" className="contact-detail-row">
              <WhatsAppIcon size={18} className="wa-glow" />
              <span>WhatsApp us</span>
            </a>

            <a href={`mailto:${CONTACT_INFO.email}`} className="contact-detail-row">
              <Mail size={18} />
              <span>{CONTACT_INFO.email}</span>
            </a>

            <div className="contact-detail-divider" />

            <p className="contact-socials-label">Find us online</p>
            <div className="contact-socials">
              {SOCIALS.map((s) => (
                <SocialLink key={s.name} name={s.name} url={s.url} />
              ))}
            </div>
          </div>
        </aside>
      </div>

      </main>

      <Footer />
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
