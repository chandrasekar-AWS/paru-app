// ════════════════════════════════════════════════════════════════
//  ADMIN LOGIN SETTINGS  —  change ID / password / key-secret HERE
// ════════════════════════════════════════════════════════════════
//  Logging in takes THREE things:
//    1) your KEY FILE  (adzone-admin.key — uploaded from your device)
//    2) Admin ID
//    3) Password
//  The Sign-in button only appears after the key file is verified.
//
//  After changing anything: save, stop the server (Ctrl + C), start again.
//
//  ▸ Make a new key file:   npm run gen-key
//      (saved in  demo/generated-keys/ — keep it OFF the website, e.g. on a
//       pen-drive. Anyone holding the file + ID + password can log in.)
//  ▸ Lock out a lost key file: add its ID (printed by gen-key) to REVOKED_KEY_IDS.
//  ▸ Change KEY_SECRET  → every old key file stops working (then run gen-key).
//
//  Vercel tip: ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_KEY_SECRET set in
//  Vercel → Settings → Environment Variables win over the values below.
// ════════════════════════════════════════════════════════════════

export const ADMIN_ID = 'adzone_admin';
export const ADMIN_PASSWORD = 'AdZone@2026#Secure';

// Private text used to encrypt/decrypt key files. Long + random. Never share it.
export const KEY_SECRET = 'Hq7-mV2xT9-Lp4Zr8-Wc3Nb6-Ya5Fd1-adzone-keyfile-2026';

// Key files you want to disable (their IDs).
export const REVOKED_KEY_IDS = [];

// Logged out automatically after this many minutes.
export const SESSION_MINUTES = 60;

// Signs login sessions. Any long random text. Changing it logs everyone out.
export const SESSION_SECRET = 'k9f3Qw-Zr72Lp-Xc81Vb-Nm45Ty-adzone-2026';
