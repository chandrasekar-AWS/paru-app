import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { json, store, clip } from '../lib/util.mjs';

// ── Routing rule ────────────────────────────────────────────────
// Design services  -> designadzonex@gmail.com  (ONLY)
// Everything else  -> adzonecbe@outlook.com    (never design)
const DESIGN_MAIL = 'designadzonex@gmail.com';
const OTHER_MAIL = 'adzonecbe@outlook.com';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  const name = clip(b.name, 100).trim();
  const email = clip(b.email, 150).trim();
  const phone = clip(b.phone, 40).trim();
  const service = clip(b.service, 150).trim();
  const state = clip(b.state, 60).trim();
  const city = clip(b.city, 60).trim();
  const message = clip(b.message, 4000).trim();
  const category = ['design', 'print', 'signage', 'digital'].includes(b.category) ? b.category : 'general';

  if (b.website) return json({ ok: true, emailed: true }); // honeypot: bots fill hidden fields

  if (!name || !/\S+@\S+\.\S+/.test(email)) return json({ error: 'Name and a valid email are required.' }, 400);

  const to = category === 'design' ? DESIGN_MAIL : OTHER_MAIL;
  const record = { id: crypto.randomUUID(), at: new Date().toISOString(), name, email, phone, service, state, city, category, message, sentTo: to, emailed: false };

  // 1) Always save the enquiry first so it can never be lost.
  let s = null;
  const key = `enquiries/${Date.now()}-${record.id}`;
  try { s = store(); await s.setJSON(key, record); } catch (err) { s = null; console.error('Could not save enquiry:', err.message); }

  // 2) Email it to the right inbox.
  const { SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      const rows = [['Name', name], ['Email', email], ['Phone', phone || '—'], ['Service', service || 'General enquiry'], ['State', state || '—'], ['City', city || '—'], ['Category', category]];
      await transporter.sendMail({
        from: `"AD ZONEX Website" <${SMTP_USER}>`,
        to,
        replyTo: `"${name.replace(/"/g, '')}" <${email}>`,
        subject: `[${category === 'general' ? 'General' : category[0].toUpperCase() + category.slice(1)}] New enquiry: ${service || 'General'} — ${name}`,
        text: `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nMessage:\n${message || '—'}`,
        html: `<table cellpadding="6" style="font-family:Arial,sans-serif">${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${esc(v)}</td></tr>`).join('')}</table><p style="font-family:Arial,sans-serif"><b>Message</b><br>${esc(message || '—').replace(/\n/g, '<br>')}</p>`,
      });
      record.emailed = true;
      if (s) await s.setJSON(key, record).catch(() => {});
    } catch (err) {
      console.error('Email failed:', err);
    }
  } else {
    console.warn('SMTP_USER / SMTP_PASS not set — enquiry saved but not emailed.');
  }

  return json({ ok: true, emailed: record.emailed });
};
