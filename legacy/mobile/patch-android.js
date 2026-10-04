// Adds the microphone permission (and keeps cleartext HTTP to your PC allowed) to the generated Android project.
const fs = require('fs'), p = require('path').join(__dirname, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
let m = fs.readFileSync(p, 'utf8');
for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.WAKE_LOCK'])
  if (!m.includes(perm)) m = m.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
if (!m.includes('usesCleartextTraffic')) m = m.replace('<application', '<application android:usesCleartextTraffic="true"');
fs.writeFileSync(p, m); console.log('AndroidManifest patched');
