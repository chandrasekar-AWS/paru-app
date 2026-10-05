import crypto from 'node:crypto';
import * as cfg from './admin-config.mjs';

// A key file is an AES-256-GCM encrypted (and tamper-proof) blob. Only someone
// who knows KEY_SECRET can create one, and the server decrypts it to check it.
const secret = () => process.env.ADMIN_KEY_SECRET || cfg.KEY_SECRET;
const kdf = () => crypto.scryptSync(secret(), 'adzone-keyfile-v1', 32);
const AAD = Buffer.from('adzone-admin-key');
const BEGIN = '-----BEGIN ADZONE ACCESS KEY-----';
const END = '-----END ADZONE ACCESS KEY-----';

export function makeKeyFile() {
  const kid = crypto.randomBytes(5).toString('hex').toUpperCase();
  const payload = JSON.stringify({ v: 1, app: 'adzone-admin', kid, iat: Date.now() });
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', kdf(), iv);
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(payload, 'utf8'), c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  const wrapped = blob.match(/.{1,64}/g).join('\n');
  return { kid, text: `${BEGIN}\n${wrapped}\n${END}\n` };
}

/** Returns { kid } if the file is a genuine, non-revoked key file, else null. */
export function readKeyFile(text) {
  try {
    const raw = String(text).slice(0, 4000);
    const b64 = raw.replace(BEGIN, '').replace(END, '').replace(/\s+/g, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 30) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', kdf(), buf.subarray(0, 12));
    d.setAAD(AAD);
    d.setAuthTag(buf.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    if (p.v !== 1 || p.app !== 'adzone-admin' || !p.kid) return null;
    if ((cfg.REVOKED_KEY_IDS || []).includes(p.kid)) return null;
    return { kid: p.kid };
  } catch {
    return null; // wrong secret / edited / not a key file
  }
}
