'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db } = require('../src/db');
const { hashPassword } = require('../src/passwords');
const { normalizeUsernameKey } = require('../src/utils');
const { DATA_DIR } = require('../src/paths');

const username = String(process.argv[2] || '').trim();
if (!username) {
  console.error('Χρήση: npm run reset-password -- <όνομα χρήστη>');
  process.exit(1);
}

async function main() {
const user = await db.prepare('SELECT id, username FROM users WHERE username_key = ?')
  .get(normalizeUsernameKey(username));
if (!user) {
  console.error('Ο λογαριασμός δεν βρέθηκε.');
  process.exit(1);
}

const suppliedPassword = process.env.NEW_PASSWORD;
let password = suppliedPassword;
let generated = false;
if (password) {
  if (password.length < 8 || password.length > 128) {
    console.error('Ο νέος κωδικός πρέπει να έχει από 8 έως 128 χαρακτήρες.');
    process.exit(1);
  }
} else {
  password = crypto.randomBytes(18).toString('base64url');
  generated = true;
}

await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

console.log('Ο κωδικός άλλαξε για τον λογαριασμό: ' + user.username);
console.log('Όλες οι ενεργές συνδέσεις του λογαριασμού τερματίστηκαν.');

if (generated) {
  const credentialsFile = path.join(DATA_DIR, 'password-reset.txt');
  const body = [
    'Επαναφορά κωδικού «Πες το»',
    'Όνομα χρήστη: ' + user.username,
    'Νέος κωδικός πρόσβασης: ' + password,
    '',
    'Διαγράψτε αυτό το αρχείο μετά τη χρήση.'
  ].join('\n') + '\n';
  fs.writeFileSync(credentialsFile, body, { mode: 0o600 });
  try { fs.chmodSync(credentialsFile, 0o600); } catch {}
  console.log('');
  console.log('Τα νέα διαπιστευτήρια γράφτηκαν τοπικά στο:');
  console.log('  ' + credentialsFile);
} else {
  console.log('Ο νέος κωδικός ορίστηκε από τη μεταβλητή NEW_PASSWORD.');
}
await db.close();
}

main().catch(error => { console.error(error); process.exit(1); });
