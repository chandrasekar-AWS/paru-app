// Copies the shared UI (../ui) into www/ so the phone app and the desktop app are the same code. app.html becomes index.html.
const fs = require('fs'), path = require('path'), src = path.join(__dirname, '..', 'ui'), dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true }); fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f === 'app.html' ? 'index.html' : f));
try { const c = fs.readFileSync(path.join(__dirname, '..', 'config', 'supabase.json'), 'utf8'); if (JSON.parse(c).url) fs.writeFileSync(path.join(dst, 'supabase-config.js'), 'window.PARU_SUPABASE=' + c + ';'); } catch { }
console.log('web files ready in mobile/www');
