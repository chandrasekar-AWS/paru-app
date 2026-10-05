import fs from 'node:fs';
import { makeKeyFile } from '../server/lib/keyfile.mjs';

const { kid, text } = makeKeyFile();
fs.mkdirSync('generated-keys', { recursive: true });
const file = `generated-keys/adzone-admin-${kid}.key`;
fs.writeFileSync(file, text);
console.log(`\nNew key file created:\n\n   ${file}\n   (key ID: ${kid})\n`);
console.log('Copy it somewhere safe (pen-drive). Upload it on /admin/login to sign in.');
console.log('To disable this key later, add its ID to REVOKED_KEY_IDS in server/lib/admin-config.mjs\n');
