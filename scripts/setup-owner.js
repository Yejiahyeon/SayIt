'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db } = require('../src/db');
const { hashPassword } = require('../src/passwords');
const { validateNickname, normalizeUsernameKey } = require('../src/utils');
const { DATA_DIR } = require('../src/paths');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const passwordFromStdin = args.includes('--password-stdin');
const usernameArg = args.find(arg => !arg.startsWith('--'));

if (!usernameArg) {
  console.error('Χρήση: npm run setup-owner -- <όνομα χρήστη> [--reset] [--password-stdin]');
  process.exit(1);
}

const { username, error } = validateNickname(usernameArg);
if (error) {
  console.error(error);
  process.exit(1);
}

async function main() {
const owner = await db.prepare("SELECT id, username FROM users WHERE role = 'owner'").get();
if (owner && !reset) {
  console.error('Υπάρχει ήδη λογαριασμός ιδιοκτήτη: ' + owner.username);
  console.error('Για αλλαγή κωδικού ιδιοκτήτη: npm run setup-owner -- ' + owner.username + ' --reset');
  process.exit(1);
}

const usernameKey = normalizeUsernameKey(username);
const existing = await db.prepare('SELECT id, username, role FROM users WHERE username_key = ?').get(usernameKey);

let targetId;
if (owner) {
  if (normalizeUsernameKey(owner.username) !== usernameKey) {
    console.error('Υπάρχει ήδη ιδιοκτήτης με όνομα χρήστη: ' + owner.username);
    console.error('Για αλλαγή κωδικού χρησιμοποιήστε το ίδιο όνομα με --reset.');
    process.exit(1);
  }
  targetId = Number(owner.id);
} else {
  if (existing) {
    console.error('Το όνομα χρήστη χρησιμοποιείται ήδη. Δεν γίνεται αυτόματη προαγωγή υπάρχοντος λογαριασμού.');
    process.exit(1);
  }
}

let suppliedPassword = process.env.OWNER_PASSWORD;
if (passwordFromStdin) {
  try {
    suppliedPassword = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  } catch {
    console.error('Δεν ήταν δυνατή η ανάγνωση του κωδικού από την είσοδο.');
    process.exit(1);
  }
}

let password = suppliedPassword;
let generated = false;
if (password !== undefined && password !== '') {
  if (password.length < 6 || password.length > 128) {
    console.error('Ο κωδικός ιδιοκτήτη πρέπει να έχει από 6 έως 128 χαρακτήρες.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.warn('Προσοχή: ο αρχικός κωδικός είναι σύντομος. Αλλάξτε τον μετά την πρώτη σύνδεση.');
  }
} else {
  password = crypto.randomBytes(24).toString('base64url');
  generated = true;
}

const passHash = hashPassword(password);
const now = new Date().toISOString();

if (owner) {
  await db.prepare("UPDATE users SET pass_hash = ?, role = 'owner', is_admin = 1 WHERE id = ?")
    .run(passHash, targetId);
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
  console.log('Ο κωδικός του λογαριασμού ιδιοκτήτη ενημερώθηκε.');
  console.log('  Όνομα χρήστη: ' + owner.username);
} else {
  const info = await db.prepare(`
    INSERT INTO users (username, username_key, pass_hash, role, is_admin, created_at)
    VALUES (?, ?, ?, 'owner', 1, ?)
  `).run(username, usernameKey, passHash, now);
  targetId = Number(info.lastInsertRowid);
  console.log('Δημιουργήθηκε λογαριασμός ιδιοκτήτη.');
  console.log('  Όνομα χρήστη: ' + username);
}

if (generated) {
  const credentialsFile = path.join(DATA_DIR, 'owner-credentials.txt');
  const body = [
    'Λογαριασμός ιδιοκτήτη «Πες το»',
    'Όνομα χρήστη: ' + (owner ? owner.username : username),
    'Κωδικός πρόσβασης: ' + password,
    '',
    'Συνδεθείτε στη διεύθυνση /syndesi, αλλάξτε τον κωδικό από «Ο λογαριασμός μου»',
    'και διαγράψτε μετά αυτό το αρχείο.'
  ].join('\n') + '\n';
  fs.writeFileSync(credentialsFile, body, { mode: 0o600 });
  try { fs.chmodSync(credentialsFile, 0o600); } catch {}
  console.log('');
  console.log('Τα διαπιστευτήρια γράφτηκαν μόνο τοπικά στο:');
  console.log('  ' + credentialsFile);
  console.log('Διαβάστε τα, συνδεθείτε, αλλάξτε τον κωδικό και διαγράψτε το αρχείο.');
} else {
  console.log('Ο κωδικός ορίστηκε με ασφαλή τρόπο και δεν εμφανίζεται.');
}
console.log('');
console.log('Σύνδεση: /syndesi');
await db.close();
}

main().catch(error => { console.error(error); process.exit(1); });
