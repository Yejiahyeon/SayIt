'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const OWNER_USERNAME = 'Δοκιμή Ιδιοκτήτη';
const OWNER_PASSWORD = '0Owner-Test-Pass!2345';
const USER1_PASSWORD = 'User-One-Pass!23';
const USER2_PASSWORD = 'User-Two-Pass!23';
const RESERVED_OWNER_USERNAME = 'Linda W';

let passed = 0;

function ok(condition, message) {
  assert.ok(condition, message);
  passed += 1;
  console.log('  ok  ' + message);
}

function includes(text, needle, message) {
  ok(String(text).includes(needle), message);
}

function notIncludes(text, needle, message) {
  ok(!String(text).includes(needle), message);
}

function inputTag(html, id) {
  const match = new RegExp('<input id="' + id + '"[^>]*>').exec(String(html));
  return match ? match[0] : '';
}

function futureDate(days = 60) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function greekDate(isoDate) {
  return new Intl.DateTimeFormat('el-GR', {
    timeZone: 'Europe/Athens',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date(isoDate + 'T12:00:00Z'));
}

function assertNoAuthControls(response, label) {
  notIncludes(response.text, 'Σύνδεση', label + ': χωρίς «Σύνδεση»');
  notIncludes(response.text, 'Εγγραφή', label + ': χωρίς «Εγγραφή»');
  notIncludes(response.text, 'href="/syndesi"', label + ': χωρίς σύνδεσμο σύνδεσης');
  notIncludes(response.text, 'href="/eggrafi"', label + ': χωρίς σύνδεσμο εγγραφής');
}

function assertStatus(response, expected, message) {
  ok(response.status === expected, message + ' (HTTP ' + response.status + ')');
}

function assertNoAccountNames(response, usernames, label) {
  for (const username of usernames) {
    notIncludes(response.text, String(username), label + ': δεν εμφανίζεται όνομα λογαριασμού');
  }
}

class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => key + '=' + value).join('; ');
  }

  async request(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    let body = options.body;
    if (options.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(options.form).toString();
    }
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    const response = await fetch(this.base + pathname, {
      method: options.method || (options.form ? 'POST' : 'GET'),
      headers,
      body,
      redirect: 'manual'
    });
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [];
    for (const raw of setCookies) {
      const pair = raw.split(';')[0];
      const index = pair.indexOf('=');
      if (index < 1) continue;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
    const text = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      contentType: response.headers.get('content-type') || '',
      cacheControl: response.headers.get('cache-control') || '',
      text
    };
  }
}

function query(dataDir, sql, params = []) {
  const db = new DatabaseSync(path.join(dataDir, 'pes-to.db'), { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function startServer(port, dataDir, uploadDir) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      UPLOAD_DIR: uploadDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  return { child, output: () => output };
}

async function waitForServer(base, child) {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error('Ο server τερματίστηκε πρόωρα:\n' + child.output);
    try {
      const response = await fetch(base + '/');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Ο server δεν ξεκίνησε:\n' + child.output);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill('SIGTERM');
  await Promise.race([
    once(server.child, 'exit'),
    new Promise(resolve => setTimeout(resolve, 3000))
  ]);
  if (server.child.exitCode === null) server.child.kill('SIGKILL');
}

function createLegacyDatabase(dataDir) {
  const { hashPassword } = require('../src/passwords');
  const db = new DatabaseSync(path.join(dataDir, 'pes-to.db'));
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'closed',
      created_at TEXT NOT NULL,
      closed_at TEXT
    );
    CREATE TABLE choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT,
      image_path TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      choice_id INTEGER NOT NULL REFERENCES choices(id) ON DELETE CASCADE,
      code_id INTEGER NOT NULL REFERENCES codes(id),
      created_at TEXT NOT NULL,
      UNIQUE (poll_id, code_id)
    );
  `);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (username, pass_hash, is_admin, created_at) VALUES (?, ?, 1, ?)')
    .run('admin', hashPassword('admin123'), now);
  db.prepare('INSERT INTO suggestions (category, title, description, created_at) VALUES (?, ?, ?, ?)')
    .run('Αθλητικές', 'Παλιά ιδιωτική πρόταση', 'Η πρόταση αυτή ήταν ιδιωτική πριν τη μετεγκατάσταση.', now);
  db.prepare(`
    INSERT INTO events (title, event_date, event_time, location, description, image_path, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run('Παλιά εκδήλωση', '2099-12-18', '18:00', 'Αίθουσα', 'Παλιά περιγραφή.', now);
  db.prepare('INSERT INTO polls (question, status, created_at) VALUES (?, ?, ?)')
    .run('Παλιά ανοιχτή ψηφοφορία', 'open', now);
  db.prepare('INSERT INTO choices (poll_id, text, position) VALUES (1, ?, 0)').run('Επιλογή Α');
  db.prepare('INSERT INTO choices (poll_id, text, position) VALUES (1, ?, 1)').run('Επιλογή Β');
  db.prepare('INSERT INTO polls (question, status, created_at) VALUES (?, ?, ?)')
    .run('Ποια αθλητική δραστηριότητα θέλετε για την εκδρομή;', 'open', now);
  db.prepare('INSERT INTO choices (poll_id, text, position) VALUES (2, ?, 0)').run('Ποδόσφαιρο');
  db.prepare('INSERT INTO choices (poll_id, text, position) VALUES (2, ?, 1)').run('Μπάσκετ');
  db.prepare('INSERT INTO codes (code, created_at) VALUES (?, ?)').run('AAAAAAAA', now);
  db.prepare('INSERT INTO codes (code, created_at) VALUES (?, ?)').run('BBBBBBBB', now);
  db.prepare('INSERT INTO votes (poll_id, choice_id, code_id, created_at) VALUES (1, 1, 1, ?)').run(now);
  db.prepare('INSERT INTO votes (poll_id, choice_id, code_id, created_at) VALUES (1, 2, 2, ?)').run(now);
  db.close();
}

async function migrationScenario(tempRoot) {
  console.log('\n14. Μετεγκατάσταση παλιών δεδομένων χωρίς διαγραφή');
  const dataDir = path.join(tempRoot, 'legacy-data');
  const uploadDir = path.join(tempRoot, 'legacy-uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });
  createLegacyDatabase(dataDir);

  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const server = startServer(port, dataDir, uploadDir);
  await waitForServer(base, server.child);

  try {
    const guest = new Client(base);
    const entry = await guest.request('/');
    assertStatus(entry, 200, 'Η αρχική για επισκέπτη είναι η σελίδα εισόδου');
    includes(entry.text, 'id="login_username"', 'Η σελίδα εισόδου έχει σύνδεση');
    includes(entry.text, 'id="register_username"', 'Η σελίδα εισόδου έχει εγγραφή');
    notIncludes(entry.text, 'action-card', 'Ο επισκέπτης δεν βλέπει περιεχόμενο αρχικής');
    assertStatus(await guest.request('/ekdiloseis'), 302, 'Οι παλιές εκδηλώσεις προστατεύονται πίσω από σύνδεση');
    assertStatus(await guest.request('/protaseis'), 302, 'Οι παλιές προτάσεις προστατεύονται πίσω από σύνδεση');

    const oldDefaultLogin = await new Client(base).request('/syndesi', {
      form: { username: 'admin', password: 'admin123' }
    });
    assertStatus(oldDefaultLogin, 401, 'Ο γνωστός προεπιλεγμένος κωδικός admin123 δεν λειτουργεί πλέον');

    const student = new Client(base);
    const registered = await student.request('/eggrafi', {
      form: { username: 'Νεος_Χρηστης', password: 'New-User-Pass!23', confirm: 'New-User-Pass!23' }
    });
    assertStatus(registered, 302, 'Νέος λογαριασμός δημιουργείται στη μεταγκατεστημένη βάση');
    ok(registered.location === '/?m=eggrafi', 'Η εγγραφή ανοίγει την αρχική');

    const home = await student.request('/');
    includes(home.text, 'action-title">Ψηφίστε', 'Η παλιά ανοιχτή ψηφοφορία διατηρεί το «Ψηφίστε»');
    const publicEvents = await student.request('/ekdiloseis');
    includes(publicEvents.text, 'Παλιά εκδήλωση', 'Η παλιά εκδήλωση διατηρείται');
    assertNoAuthControls(publicEvents, 'Παλιά εκδήλωση');
    const removedPollRows = query(
      dataDir,
      'SELECT id, status, cancelled_at FROM polls WHERE question = ?',
      ['Ποια αθλητική δραστηριότητα θέλετε για την εκδρομή;']
    );
    ok(removedPollRows.length === 1, 'Η ανεπιθύμητη αθλητική ψηφοφορία παραμένει ως ιστορικό αρχείο');
    ok(removedPollRows[0].status === 'cancelled' && removedPollRows[0].cancelled_at, 'Η ανεπιθύμητη ψηφοφορία σημάνθηκε ως ακυρωμένη στην εκκίνηση');
    ok(query(dataDir, 'SELECT id FROM choices WHERE poll_id = ?', [Number(removedPollRows[0].id)]).length === 2, 'Οι επιλογές της ακυρωμένης ψηφοφορίας δεν διαγράφηκαν');
    const publicPolls = await student.request('/psifos');
    notIncludes(publicPolls.text, 'Ποια αθλητική δραστηριότητα θέλετε για την εκδρομή;', 'Η ανεπιθύμητη ψηφοφορία δεν εμφανίζεται στη δημόσια λίστα');
    assertStatus(await student.request('/psifos/' + Number(removedPollRows[0].id)), 404, 'Η ακυρωμένη ψηφοφορία δεν ανοίγει δημόσια');
    const board = await student.request('/protaseis');
    includes(board.text, 'Δεν υπάρχουν ακόμα δημόσιες προτάσεις.', 'Η παλιά ιδιωτική πρόταση δεν δημοσιεύεται αυτόματα');
    notIncludes(board.text, 'Παλιά ιδιωτική πρόταση', 'Η παλιά ιδιωτική πρόταση παραμένει κρυφή');

    const migratedSuggestions = query(dataDir, 'SELECT category, is_public FROM suggestions');
    ok(migratedSuggestions.length === 1 && Number(migratedSuggestions[0].is_public) === 0, 'Η παλιά πρόταση σημάνθηκε ως ιδιωτική');
    ok(migratedSuggestions[0].category === 'Αθλητική', 'Η παλιά κατηγορία διατηρήθηκε ως ενική «Αθλητική»');
    const migratedVotes = query(dataDir, 'SELECT poll_id, choice_id, user_id, code_id FROM votes ORDER BY id');
    ok(migratedVotes.length === 2, 'Οι παλιές ψήφοι διατηρήθηκαν');
    ok(migratedVotes.every(vote => vote.user_id === null && vote.code_id !== null), 'Οι παλιές ψήφοι κράτησαν τους κωδικούς τους');
    ok(query(dataDir, 'SELECT id FROM codes').length === 2, 'Οι παλιοί κωδικοί ψηφοφορίας διατηρήθηκαν');
    const legacyAdmin = query(dataDir, "SELECT role, is_admin FROM users WHERE username = 'admin'")[0];
    ok(legacyAdmin.role === 'user' && Number(legacyAdmin.is_admin) === 0, 'Ο παλιός διαχειριστής έγινε απλός χρήστης');

    const voted = await student.request('/psifos/1', { form: { choice: '1' } });
    assertStatus(voted, 302, 'Ο νέος λογαριασμός ψηφίζει στην παλιά ψηφοφορία');
    const results = await student.request('/psifos/1');
    includes(results.text, 'id="total">3</strong>', 'Τα παλιά και τα νέα αποτελέσματα αθροίζονται σωστά');
    const allVotes = query(dataDir, 'SELECT id FROM votes WHERE poll_id = 1');
    ok(allVotes.length === 3, 'Δεν διαγράφηκε καμία παλιά ψήφος');
  } finally {
    await stopServer(server);
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pes-to-test-'));
  const dataDir = path.join(tempRoot, 'data');
  const uploadDir = path.join(tempRoot, 'uploads');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  let server = null;

  try {
    console.log('\n1. Σελίδα εισόδου και προστασία διαδρομών');
    server = startServer(port, dataDir, uploadDir);
    await waitForServer(base, server.child);

    const guest = new Client(base);
    const entry = await guest.request('/');
    assertStatus(entry, 200, 'Η αρχική για επισκέπτη φορτώνει τη σελίδα εισόδου');
    includes(entry.text, '<html lang="el">', 'Η γλώσσα της σελίδας είναι ελληνικά');
    includes(entry.text, 'id="syndesi"', 'Υπάρχει περιοχή «Σύνδεση»');
    includes(entry.text, 'id="eggrafi"', 'Υπάρχει περιοχή «Εγγραφή»');
    includes(entry.text, 'id="login_username"', 'Η σύνδεση έχει όνομα χρήστη');
    includes(entry.text, 'id="login_password"', 'Η σύνδεση έχει κωδικό πρόσβασης');
    includes(entry.text, 'id="register_password"', 'Η εγγραφή έχει κωδικό πρόσβασης');
    includes(entry.text, 'id="register_confirm"', 'Η εγγραφή έχει επιβεβαίωση κωδικού');
    includes(entry.text, 'Επιβεβαίωση κωδικού πρόσβασης', 'Η επιβεβαίωση έχει ακριβή ελληνική ετικέτα');
    includes(entry.text, 'Σύνδεση</button>', 'Υπάρχει κουμπί «Σύνδεση»');
    includes(entry.text, 'Εγγραφή</button>', 'Υπάρχει κουμπί «Εγγραφή»');
    notIncludes(entry.text, 'type="email"', 'Δεν ζητείται ηλεκτρονικό ταχυδρομείο');
    notIncludes(entry.text, 'action-card', 'Ο επισκέπτης δεν βλέπει τις ενέργειες της αρχικής');
    notIncludes(entry.text, 'Πρότεινε μια δραστηριότητα', 'Ο επισκέπτης δεν βλέπει την πρόταση δραστηριότητας');
    notIncludes(entry.text, 'href="/protaseis"', 'Ο επισκέπτης δεν έχει σύνδεσμο προτάσεων');
    const entryPasswordTags = [...entry.text.matchAll(/<input[^>]*type="password"[^>]*>/g)].map(m => m[0]);
    ok(entryPasswordTags.length === 3, 'Η σελίδα εισόδου έχει τρία πεδία κωδικού');
    ok(entryPasswordTags.every(tag => !tag.includes('value=')), 'Κανένα πεδίο κωδικού δεν προσυμπληρώνεται');

    for (const pathname of ['/protasi', '/protaseis', '/ekdiloseis', '/psifos', '/logariasmos', '/symvoulio']) {
      const protectedPage = await guest.request(pathname);
      assertStatus(protectedPage, 302, 'Η διαδρομή ' + pathname + ' απαιτεί σύνδεση');
      ok(String(protectedPage.location || '').startsWith('/?next='), 'Η προστατευμένη διαδρομή ' + pathname + ' οδηγεί στη σελίδα εισόδου');
    }
    assertStatus(await guest.request('/protasi', { form: { category: 'Γενική', title: 'Δοκιμή', description: 'Μια αρκετά μεγάλη περιγραφή.' } }), 302, 'Η υποβολή πρότασης απαιτεί σύνδεση');
    assertStatus(await guest.request('/uploads/not-found.jpg'), 302, 'Τα μεταφορτωμένα αρχεία απαιτούν σύνδεση');
    assertStatus(await guest.request('/syndesi'), 200, 'Η άμεση διαδρομή σύνδεσης εμφανίζει τη σελίδα εισόδου');
    assertStatus(await guest.request('/eggrafi'), 200, 'Η άμεση διαδρομή εγγραφής εμφανίζει τη σελίδα εισόδου');
    ok(query(dataDir, "SELECT id FROM users WHERE role = 'owner'").length === 0, 'Κανένας λογαριασμός δεν γίνεται αυτόματα ιδιοκτήτης');

    console.log('\n2. Εγγραφή, σύνδεση και θησαυροφυλάκιο');
    const mismatch = await new Client(base).request('/eggrafi', {
      form: { username: 'Μαθητης_1', password: USER1_PASSWORD, confirm: USER2_PASSWORD }
    });
    assertStatus(mismatch, 400, 'Η εγγραφή απορρίπτεται όταν οι κωδικοί δεν ταιριάζουν');
    includes(mismatch.text, 'Οι δύο κωδικοί πρόσβασης δεν ταιριάζουν.', 'Υπάρχει ελληνικό μήνυμα για διαφορετικούς κωδικούς');
    ok(query(dataDir, 'SELECT id FROM users').length === 0, 'Η αποτυχημένη εγγραφή δεν δημιουργεί λογαριασμό');

    const user1 = new Client(base);
    const register1 = await user1.request('/eggrafi', {
      form: {
        username: 'Μαθητης_1',
        password: USER1_PASSWORD,
        confirm: USER1_PASSWORD,
        role: 'owner',
        is_admin: '1'
      }
    });
    assertStatus(register1, 302, 'Η εγγραφή του πρώτου χρήστη ολοκληρώνεται');
    ok(register1.location === '/?m=eggrafi', 'Η εγγραφή οδηγεί στην αρχική');
    ok(user1.cookies.has('pt_session'), 'Η εγγραφή συνδέει αυτόματα τον χρήστη');

    const home1 = await user1.request('/');
    assertStatus(home1, 200, 'Ο συνδεδεμένος χρήστης βλέπει την αρχική');
    includes(home1.text, 'Πρότεινε μια δραστηριότητα', 'Η αρχική έχει την πρόταση δραστηριότητας');
    includes(home1.text, 'Επερχόμενες εκδηλώσεις', 'Η αρχική έχει τις εκδηλώσεις');
    notIncludes(home1.text, 'action-title">Ψηφίστε', 'Δεν εμφανίζεται «Ψηφίστε» χωρίς ανοιχτή ψηφοφορία');
    ok((home1.text.match(/class="action-card/g) || []).length === 2, 'Η αρχική έχει τις δύο διαθέσιμες ενέργειες');
    assertNoAuthControls(home1, 'Αρχική μετά τη σύνδεση');

    const emptyEvents = await user1.request('/ekdiloseis');
    includes(emptyEvents.text, 'Δεν υπάρχουν ακόμα εκδηλώσεις.', 'Κενή κατάσταση εκδηλώσεων με ακριβές μήνυμα');
    notIncludes(emptyEvents.text, '>+ Νέο</a>', 'Ο απλός χρήστης δεν βλέπει «+ Νέο» στις εκδηλώσεις');
    notIncludes(emptyEvents.text, '/epexergasia', 'Ο απλός χρήστης δεν βλέπει επεξεργασία εκδήλωσης');
    assertNoAuthControls(emptyEvents, 'Εκδηλώσεις');
    const emptyBoard = await user1.request('/protaseis');
    includes(emptyBoard.text, 'Δεν υπάρχουν ακόμα δημόσιες προτάσεις.', 'Κενή κατάσταση προτάσεων');
    assertNoAuthControls(emptyBoard, 'Προτάσεις');
    const emptyPolls = await user1.request('/psifos');
    includes(emptyPolls.text, 'Δεν υπάρχει ενεργή ψηφοφορία αυτή τη στιγμή.', 'Κενή κατάσταση ψηφοφοριών');
    assertNoAuthControls(emptyPolls, 'Ψηφοφορίες');

    const suggestPage = await user1.request('/protasi');
    includes(suggestPage.text, 'Δείτε τις προτάσεις', 'Το κουμπί «Δείτε τις προτάσεις» υπάρχει στη φόρμα πρότασης');
    includes(suggestPage.text, 'θα είναι ορατή σε όλους τους μαθητές', 'Η φόρμα εξηγεί ότι η πρόταση είναι δημόσια');
    assertNoAuthControls(suggestPage, 'Φόρμα πρότασης');
    const categories = ['Γενική', 'Φιλανθρωπική', 'Περιβαλλοντική', 'Αθλητική', 'Πολιτισμική'];
    let lastIndex = -1;
    let ordered = true;
    for (const category of categories) {
      const index = suggestPage.text.indexOf('>' + category + '<');
      if (index <= lastIndex) ordered = false;
      lastIndex = index;
    }
    ok(ordered, 'Οι κατηγορίες εμφανίζονται σε ενικό και με τη σωστή σειρά');
    for (const plural of ['Γενικές', 'Φιλανθρωπικές', 'Περιβαλλοντικές', 'Αθλητικές', 'Πολιτισμικές']) {
      notIncludes(suggestPage.text, '>' + plural + '<', 'Δεν εμφανίζεται η πληθυντική κατηγορία «' + plural + '»');
    }

    const user2 = new Client(base);
    const register2 = await user2.request('/eggrafi', {
      form: { username: 'Μαθητης_2', password: USER2_PASSWORD, confirm: USER2_PASSWORD }
    });
    assertStatus(register2, 302, 'Η εγγραφή του δεύτερου χρήστη ολοκληρώνεται');
    const registered = query(dataDir, 'SELECT id, username, role, pass_hash, is_admin FROM users ORDER BY id');
    ok(registered.length === 2, 'Δημιουργήθηκαν δύο λογαριασμοί');
    ok(registered.every(user => user.role === 'user' && Number(user.is_admin) === 0), 'Οι νέοι λογαριασμοί είναι απλοί χρήστες παρά το πεδίο role που στάλθηκε');
    ok(registered.every(user => String(user.pass_hash).startsWith('scrypt$')), 'Οι κωδικοί αποθηκεύονται ως hashes scrypt');
    ok(registered.every(user => user.pass_hash !== USER1_PASSWORD && user.pass_hash !== USER2_PASSWORD), 'Κανένας κωδικός δεν αποθηκεύεται σε καθαρό κείμενο');
    const user1Id = Number(registered[0].id);
    const user2Id = Number(registered[1].id);

    const duplicateName = await new Client(base).request('/eggrafi', {
      form: { username: 'μαθητης_1', password: USER1_PASSWORD, confirm: USER1_PASSWORD }
    });
    assertStatus(duplicateName, 400, 'Το ίδιο όνομα χρήστη απορρίπτεται ανεξάρτητα από πεζά/κεφαλαία');
    includes(duplicateName.text, 'Το όνομα χρήστη χρησιμοποιείται ήδη.', 'Υπάρχει ελληνικό μήνυμα για διπλό όνομα');
    notIncludes(duplicateName.text, 'μαθητης_1', 'Η σελίδα διπλού ονόματος δεν εμφανίζει το όνομα που δοκιμάστηκε');
    ok(!inputTag(duplicateName.text, 'register_username').includes('value='), 'Η φόρμα εγγραφής δεν επανεμφανίζει όνομα χρήστη');
    const reserved = await new Client(base).request('/eggrafi', {
      form: { username: RESERVED_OWNER_USERNAME, password: USER1_PASSWORD, confirm: USER1_PASSWORD }
    });
    assertStatus(reserved, 400, 'Το δεσμευμένο όνομα ιδιοκτήτη δεν μπορεί να εγγραφεί ως απλός χρήστης');
    includes(reserved.text, 'δεν είναι διαθέσιμο', 'Υπάρχει ελληνικό μήνυμα για μη διαθέσιμο όνομα');
    notIncludes(reserved.text, RESERVED_OWNER_USERNAME, 'Η σελίδα δεν εμφανίζει το δεσμευμένο όνομα ιδιοκτήτη');
    ok(query(dataDir, 'SELECT id FROM users').length === 2, 'Η απόπειρα με δεσμευμένο όνομα δεν δημιουργεί λογαριασμό');

    const rememberedBrowser = new Client(base);
    rememberedBrowser.cookies.set('pt_last_username', encodeURIComponent('Μαθητης_1'));
    const rememberedEntry = await rememberedBrowser.request('/');
    notIncludes(rememberedEntry.text, 'Μαθητης_1', 'Το παλιό cookie ψευδωνύμου δεν εμφανίζεται στη σελίδα εισόδου');
    ok(!inputTag(rememberedEntry.text, 'login_username').includes('value='), 'Το πεδίο σύνδεσης δεν προσυμπληρώνει όνομα χρήστη');
    ok(!inputTag(rememberedEntry.text, 'login_password').includes('value='), 'Ο κωδικός δεν προσυμπληρώνεται ποτέ');
    ok(!inputTag(rememberedEntry.text, 'register_password').includes('value='), 'Το πεδίο κωδικού εγγραφής μένει κενό');
    assertStatus(await user1.request('/syndesi'), 302, 'Έγκυρη συνεδρία δεν ξαναδείχνει σύνδεση');
    assertStatus(await user1.request('/eggrafi'), 302, 'Έγκυρη συνεδρία δεν ξαναδείχνει εγγραφή');

    const wrongLogin = await new Client(base).request('/syndesi', {
      form: { username: 'Μαθητης_2', password: 'wrong-password' }
    });
    assertStatus(wrongLogin, 401, 'Λάθος κωδικός απορρίπτεται');
    includes(wrongLogin.text, 'Λάθος όνομα χρήστη ή κωδικός πρόσβασης.', 'Υπάρχει γενικό ελληνικό μήνυμα αποτυχίας');
    notIncludes(wrongLogin.text, 'Μαθητης_2', 'Η αποτυχημένη σύνδεση δεν επανεμφανίζει το όνομα χρήστη');
    ok(!inputTag(wrongLogin.text, 'login_password').includes('value='), 'Ο λανθασμένος κωδικός δεν ξαναεμφανίζεται');

    const loggedIn2 = new Client(base);
    const user2Login = await loggedIn2.request('/syndesi', {
      form: { username: 'Μαθητης_2', password: USER2_PASSWORD }
    });
    assertStatus(user2Login, 302, 'Ο απλός χρήστης συνδέεται με όνομα χρήστη και κωδικό');
    ok(user2Login.location === '/', 'Ο απλός χρήστης οδηγείται στην αρχική');

    console.log('\n3. Προτάσεις, ενικές κατηγορίες και καρδιές');
    const suggestion = await user1.request('/protasi', {
      form: {
        category: 'Αθλητική',
        title: 'Πρόταση δοκιμής',
        description: 'Αυτή η πρόταση δημιουργήθηκε για τον αυτόματο έλεγχο.'
      }
    });
    assertStatus(suggestion, 200, 'Η δημόσια πρόταση υποβάλλεται');
    includes(suggestion.text, 'θα εμφανιστεί δημόσια σε όλους τους μαθητές', 'Η επιτυχής υποβολή αναφέρει ότι η πρόταση είναι δημόσια');
    const suggestionRows = query(dataDir, 'SELECT id, category, is_public FROM suggestions ORDER BY id');
    ok(suggestionRows.length === 1 && Number(suggestionRows[0].is_public) === 1, 'Η νέα πρόταση αποθηκεύεται ως δημόσια');
    ok(suggestionRows[0].category === 'Αθλητική', 'Η νέα πρόταση αποθηκεύεται με ενική κατηγορία');
    const suggestionId = Number(suggestionRows[0].id);

    let board = await user1.request('/protaseis');
    includes(board.text, 'Πρόταση δοκιμής', 'Η πρόταση εμφανίζεται στις «Δείτε τις προτάσεις»');
    includes(board.text, '>Αθλητική<', 'Η κατηγορία εμφανίζεται στην ενική μορφή');
    includes(board.text, 'aria-label="Μου αρέσει', 'Το κουμπί καρδιάς έχει ελληνική προσβασιμότητα');
    notIncludes(board.text, '>Μου αρέσει<', 'Το κουμπί καρδιάς δεν έχει ορατό κείμενο');
    const likeButtonMatch = board.text.match(/<button type="submit" class="like-button[\s\S]*?<\/button>/);
    ok(likeButtonMatch && likeButtonMatch[0].includes('<svg'), 'Το κουμπί καρδιάς περιέχει μόνο το εικονίδιο');
    ok(likeButtonMatch && !likeButtonMatch[0].replace(/<[^>]+>/g, '').trim(), 'Το κουμπί καρδιάς δεν εμφανίζει κείμενο');
    assertNoAuthControls(board, 'Πίνακας προτάσεων');

    assertStatus(await guest.request('/protaseis/' + suggestionId + '/mou-aresei', { form: {} }), 302, 'Η καρδιά απαιτεί σύνδεση');
    let like = await user1.request('/protaseis/' + suggestionId + '/mou-aresei', { form: {} });
    assertStatus(like, 302, 'Ο χρήστης μπορεί να πατήσει την καρδιά');
    let likeRows = query(dataDir, 'SELECT * FROM suggestion_likes');
    ok(likeRows.length === 1, 'Η προτίμηση αποθηκεύεται στη βάση');
    like = await user1.request('/protaseis/' + suggestionId + '/mou-aresei', { form: {} });
    assertStatus(like, 302, 'Το δεύτερο πάτημα επεξεργάζεται');
    likeRows = query(dataDir, 'SELECT * FROM suggestion_likes');
    ok(likeRows.length === 0, 'Το δεύτερο πάτημα αφαιρεί την προτίμηση');
    await user1.request('/protaseis/' + suggestionId + '/mou-aresei', { form: {} });
    await user2.request('/protaseis/' + suggestionId + '/mou-aresei', { form: {} });
    likeRows = query(dataDir, 'SELECT * FROM suggestion_likes ORDER BY user_id');
    ok(likeRows.length === 2, 'Κάθε λογαριασμός έχει μία προτίμηση και μόνο');
    ok(new Set(likeRows.map(row => Number(row.user_id))).size === 2, 'Οι προτιμήσεις ανήκουν σε διαφορετικούς λογαριασμούς');

    console.log('\n4. Επανεκκίνηση χωρίς αυτόματο περιεχόμενο');
    await stopServer(server);
    server = startServer(port, dataDir, uploadDir);
    await waitForServer(base, server.child);
    board = await user1.request('/protaseis');
    assertStatus(board, 200, 'Η συνεδρία παραμένει έγκυρη μετά την επανεκκίνηση');
    includes(board.text, 'Πρόταση δοκιμής', 'Η πρόταση παραμένει μετά την επανεκκίνηση');
    includes(board.text, 'aria-pressed="true"', 'Η προτίμηση παραμένει μετά την επανεκκίνηση');
    likeRows = query(dataDir, 'SELECT * FROM suggestion_likes');
    ok(likeRows.length === 2, 'Οι προτιμήσεις παραμένουν στη βάση μετά την επανεκκίνηση');
    includes((await user1.request('/ekdiloseis')).text, 'Δεν υπάρχουν ακόμα εκδηλώσεις.', 'Δεν εμφανίστηκε αυτόματη εκδήλωση μετά την επανεκκίνηση');
    includes((await user1.request('/psifos')).text, 'Δεν υπάρχει ενεργή ψηφοφορία αυτή τη στιγμή.', 'Δεν εμφανίστηκε αυτόματη ψηφοφορία μετά την επανεκκίνηση');
    ok(query(dataDir, 'SELECT id FROM events').length === 0, 'Η βάση παραμένει χωρίς εκδηλώσεις');
    ok(query(dataDir, 'SELECT id FROM polls').length === 0, 'Η βάση παραμένει χωρίς ψηφοφορίες');

    console.log('\n5. Ασφαλής λογαριασμός ιδιοκτήτη με όνομα που περιέχει κενό');
    await stopServer(server);
    const setupOwner = spawnSync(process.execPath, [
      '--disable-warning=ExperimentalWarning',
      'scripts/setup-owner.js',
      OWNER_USERNAME
    ], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        UPLOAD_DIR: uploadDir,
        OWNER_PASSWORD
      },
      encoding: 'utf8'
    });
    ok(setupOwner.status === 0, 'Το script δημιουργίας ιδιοκτήτη εκτελείται');
    ok(!String(setupOwner.stdout).includes(OWNER_PASSWORD) && !String(setupOwner.stderr).includes(OWNER_PASSWORD), 'Ο κωδικός δεν εμφανίζεται στην έξοδο του script');
    const ownerRows = query(dataDir, "SELECT id, username, role, pass_hash FROM users WHERE role = 'owner'");
    ok(ownerRows.length === 1, 'Υπάρχει ακριβώς ένας λογαριασμός ιδιοκτήτη');
    ok(ownerRows[0].username === OWNER_USERNAME, 'Το όνομα ιδιοκτήτη με κενό αποθηκεύεται ακριβώς');
    ok(Number(ownerRows[0].id) !== user1Id, 'Ο ιδιοκτήτης δεν είναι ο πρώτος εγγεγραμμένος χρήστης');
    ok(String(ownerRows[0].pass_hash).startsWith('scrypt$'), 'Ο κωδικός ιδιοκτήτη αποθηκεύεται ως hash');
    ok(ownerRows[0].pass_hash !== OWNER_PASSWORD, 'Ο κωδικός ιδιοκτήτη δεν αποθηκεύεται σε καθαρό κείμενο');
    const ownerId = Number(ownerRows[0].id);
    const knownAccountNames = [OWNER_USERNAME, 'Μαθητης_1', 'Μαθητης_2', RESERVED_OWNER_USERNAME];
    ok(query(dataDir, "SELECT id FROM users WHERE role = 'manager'").length === 0, 'Αρχικά δεν υπάρχει κανένας διαχειριστής');

    server = startServer(port, dataDir, uploadDir);
    await waitForServer(base, server.child);
    const owner = new Client(base);
    const ownerLogin = await owner.request('/syndesi', { form: { username: OWNER_USERNAME, password: OWNER_PASSWORD } });
    assertStatus(ownerLogin, 302, 'Ο ιδιοκτήτης συνδέεται');
    ok(ownerLogin.location === '/symvoulio', 'Ο ιδιοκτήτης οδηγείται στην περιοχή διαχείρισης');
    const ownerHome = await owner.request('/');
    includes(ownerHome.text, 'Πρότεινε μια δραστηριότητα', 'Ο ιδιοκτήτης βλέπει την αρχική');
    includes(ownerHome.text, 'href="/symvoulio">Περιοχή διαχείρισης</a>', 'Ο ιδιοκτήτης βλέπει την είσοδο «Περιοχή διαχείρισης»');
    notIncludes(ownerHome.text, 'data-account-menu', 'Δεν υπάρχει δοχείο μενού λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'account-trigger', 'Δεν υπάρχει κουμπί λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'account-icon', 'Δεν υπάρχει εικονίδιο λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'account-menu', 'Δεν υπάρχει μενού λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'Άνοιγμα μενού λογαριασμού', 'Δεν υπάρχει tooltip λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'aria-haspopup="menu"', 'Δεν υπάρχει αναπτυσσόμενο μενού λογαριασμού στην αρχική');
    notIncludes(ownerHome.text, 'action="/aposyndesi"', 'Δεν υπάρχει φόρμα αποσύνδεσης στην αρχική');
    notIncludes(ownerHome.text, 'class="header-logout"', 'Δεν υπάρχει ορατό κουμπί αποσύνδεσης');
    assertNoAuthControls(ownerHome, 'Αρχική ιδιοκτήτη');
    assertNoAccountNames(ownerHome, knownAccountNames, 'Αρχική ιδιοκτήτη');

    const ordinaryHome = await user2.request('/');
    notIncludes(ordinaryHome.text, 'Περιοχή διαχείρισης', 'Ο απλός χρήστης δεν βλέπει «Περιοχή διαχείρισης»');
    notIncludes(ordinaryHome.text, 'account-trigger', 'Δεν υπάρχει κουμπί λογαριασμού στην αρχική απλού χρήστη');
    notIncludes(ordinaryHome.text, 'account-icon', 'Δεν υπάρχει εικονίδιο λογαριασμού στην αρχική απλού χρήστη');
    assertNoAccountNames(ordinaryHome, knownAccountNames, 'Αρχική απλού χρήστη');
    notIncludes(ordinaryHome.text, 'href="/symvoulio"', 'Ο απλός χρήστης δεν έχει σύνδεσμο στην περιοχή διαχείρισης');
    assertStatus(await user2.request('/symvoulio'), 403, 'Ο απλός χρήστης δεν μπαίνει στην περιοχή διαχείρισης');
    assertStatus(await user2.request('/symvoulio/prosvasi'), 403, 'Ο απλός χρήστης δεν μπαίνει στη «Διαχείριση πρόσβασης»');

    const ownerDashboard = await owner.request('/symvoulio');
    assertStatus(ownerDashboard, 200, 'Ο ιδιοκτήτης βλέπει την περιοχή διαχείρισης');
    includes(ownerDashboard.text, 'Διαχείριση πρόσβασης', 'Ο ιδιοκτήτης βλέπει τη «Διαχείριση πρόσβασης»');
    notIncludes(ownerDashboard.text, 'council-user', 'Δεν υπάρχει δοχείο λογαριασμού στην περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'account-trigger', 'Δεν υπάρχει κουμπί λογαριασμού στην περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'account-icon', 'Δεν υπάρχει εικονίδιο λογαριασμού στην περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'account-menu', 'Δεν υπάρχει μενού λογαριασμού στην περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'Άνοιγμα μενού λογαριασμού', 'Δεν υπάρχει tooltip λογαριασμού στην περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'action="/aposyndesi"', 'Δεν υπάρχει φόρμα αποσύνδεσης στην περιοχή διαχείρισης');
    assertNoAccountNames(ownerDashboard, knownAccountNames, 'Περιοχή διαχείρισης');
    notIncludes(ownerDashboard.text, 'Εγγραφή', 'Η «Εγγραφή» δεν έγινε κουμπί διαχείρισης');
    let access = await owner.request('/symvoulio/prosvasi');
    assertStatus(access, 200, 'Ο ιδιοκτήτης ανοίγει τη «Διαχείριση πρόσβασης»');
    includes(access.text, 'Σύνολο χρηστών', 'Εμφανίζεται το «Σύνολο χρηστών»');
    includes(access.text, 'Διαχειριστές', 'Εμφανίζεται η ενότητα «Διαχειριστές»');
    includes(access.text, 'Σύνολο διαχειριστών: <strong>0</strong>', 'Το σύνολο διαχειριστών ξεκινά από μηδέν');
    notIncludes(access.text, 'account-trigger', 'Δεν υπάρχει κουμπί λογαριασμού στη «Διαχείριση πρόσβασης»');
    notIncludes(access.text, 'account-icon', 'Δεν υπάρχει εικονίδιο λογαριασμού στη «Διαχείριση πρόσβασης»');
    notIncludes(access.text, 'account-menu', 'Δεν υπάρχει μενού λογαριασμού στη «Διαχείριση πρόσβασης»');
    assertNoAccountNames(access, knownAccountNames, 'Διαχείριση πρόσβασης');
    const ownerAccountPage = await owner.request('/logariasmos');
    includes(ownerAccountPage.text, 'href="/symvoulio">Περιοχή διαχείρισης</a>', 'Ο ιδιοκτήτης διατηρεί την πρόσβαση στην «Περιοχή διαχείρισης» από τον λογαριασμό του');
    includes(ownerAccountPage.text, 'Αλλαγή κωδικού', 'Η σελίδα λογαριασμού ιδιοκτήτη παραμένει διαθέσιμη');
    assertNoAccountNames(ownerAccountPage, knownAccountNames, 'Λογαριασμός ιδιοκτήτη');
    includes((await owner.request('/ekdiloseis')).text, '>+ Νέο</a>', 'Ο ιδιοκτήτης βλέπει «+ Νέο» στις εκδηλώσεις');
    includes((await owner.request('/symvoulio/ekdiloseis')).text, '>+ Νέο</a>', 'Ο ιδιοκτήτης βλέπει «+ Νέο» στη διαχείριση εκδηλώσεων');

    console.log('\n6. Παραχώρηση και άμεση αφαίρεση διαχείρισης');
    access = await owner.request('/symvoulio/prosvasi', { form: { username: 'Μαθητης_1' } });
    includes(access.text, 'Βρέθηκε λογαριασμός απλού χρήστη', 'Η αναζήτηση βρίσκει τον λογαριασμό πριν την παραχώρηση');
    includes(access.text, 'Λογαριασμός #' + user1Id, 'Η αναζήτηση δείχνει μόνο αριθμό λογαριασμού');
    includes(access.text, 'Παραχώρηση δικαιωμάτων διαχείρισης', 'Υπάρχει το κουμπί παραχώρησης');
    assertNoAccountNames(access, knownAccountNames, 'Αποτέλεσμα αναζήτησης');
    ok(!inputTag(access.text, 'username').includes('value='), 'Η φόρμα αναζήτησης δεν επανεμφανίζει όνομα χρήστη');
    const grant = await owner.request('/symvoulio/prosvasi/parachorisi', { form: { user_id: String(user1Id) } });
    assertStatus(grant, 302, 'Ο ιδιοκτήτης παραχωρεί δικαιώματα διαχείρισης');
    ok(query(dataDir, 'SELECT role FROM users WHERE id = ?', [user1Id])[0].role === 'manager', 'Ο λογαριασμός έγινε διαχειριστής χωρίς νέο λογαριασμό');

    const promotedHome = await user1.request('/');
    assertStatus(promotedHome, 200, 'Ο νέος διαχειριστής συνεχίζει στην ίδια συνεδρία');
    includes(promotedHome.text, 'Εργαλεία διαχείρισης', 'Ο διαχειριστής βλέπει τα εργαλεία του');
    notIncludes(promotedHome.text, 'Περιοχή διαχείρισης', 'Ο διαχειριστής δεν βλέπει την «Περιοχή διαχείρισης»');
    assertStatus(await user1.request('/symvoulio'), 403, 'Ο διαχειριστής δεν μπαίνει στην περιοχή διαχείρισης του ιδιοκτήτη');
    const promotedTools = await user1.request('/symvoulio/ekdiloseis');
    assertStatus(promotedTools, 200, 'Ο διαχειριστής διατηρεί τα εργαλεία εκδηλώσεων');
    notIncludes(promotedTools.text, 'Περιοχή διαχείρισης', 'Η σελίδα εργαλείων δεν χρησιμοποιεί τον τίτλο της περιοχής ιδιοκτήτη');
    notIncludes(promotedTools.text, 'Διαχείριση πρόσβασης', 'Ο διαχειριστής δεν βλέπει σύνδεσμο για τη «Διαχείριση πρόσβασης»');
    assertStatus(await user1.request('/symvoulio/prosvasi'), 403, 'Ο διαχειριστής δεν μπαίνει στη «Διαχείριση πρόσβασης»');
    assertStatus(await user1.request('/symvoulio/prosvasi/parachorisi', { form: { user_id: String(user2Id) } }), 403, 'Ο διαχειριστής δεν μπορεί να διορίσει άλλον διαχειριστή');
    assertStatus(await user1.request('/symvoulio/prosvasi/afairesi', { form: { user_id: String(ownerId) } }), 403, 'Ο διαχειριστής δεν μπορεί να αλλάξει τον ιδιοκτήτη');
    const managerLogin = await new Client(base).request('/syndesi', {
      form: { username: 'Μαθητης_1', password: USER1_PASSWORD }
    });
    assertStatus(managerLogin, 302, 'Ο διαχειριστής συνδέεται ξανά');
    ok(managerLogin.location === '/symvoulio/ekdiloseis', 'Η σύνδεση διαχειριστή οδηγεί στα εργαλεία του, όχι στην περιοχή ιδιοκτήτη');
    includes((await user1.request('/ekdiloseis')).text, '>+ Νέο</a>', 'Ο εξουσιοδοτημένος διαχειριστής βλέπει «+ Νέο» στις εκδηλώσεις');
    access = await owner.request('/symvoulio/prosvasi');
    includes(access.text, 'Σύνολο διαχειριστών: <strong>1</strong>', 'Η σελίδα δείχνει τον σωστό αριθμό διαχειριστών');
    includes(access.text, 'Λογαριασμός #' + user1Id, 'Η λίστα διαχειριστών δείχνει μόνο αριθμό λογαριασμού');
    includes(access.text, 'Αφαίρεση δικαιωμάτων διαχείρισης', 'Υπάρχει το κουμπί αφαίρεσης');
    assertNoAccountNames(access, knownAccountNames, 'Λίστα διαχειριστών');

    console.log('\n7. Εκδηλώσεις και ψηφοφορίες με σωστά δικαιώματα');
    const ordinaryEvents = await user2.request('/ekdiloseis');
    includes(ordinaryEvents.text, 'Δεν υπάρχουν ακόμα εκδηλώσεις.', 'Ο απλός χρήστης βλέπει κενές εκδηλώσεις');
    notIncludes(ordinaryEvents.text, '>+ Νέο</a>', 'Ο απλός χρήστης δεν βλέπει «+ Νέο»');
    notIncludes(ordinaryEvents.text, '/epexergasia', 'Ο απλός χρήστης δεν βλέπει επεξεργασία');
    assertStatus(await user2.request('/symvoulio/ekdiloseis/nea'), 403, 'Ο απλός χρήστης δεν ανοίγει φόρμα εκδήλωσης');
    assertStatus(await user2.request('/symvoulio/ekdiloseis', {
      form: { title: 'Απαγορευμένη', event_date: '2026-12-01', event_time: '18:00', location: 'Αίθουσα', description: 'Δοκιμή.' }
    }), 403, 'Ο απλός χρήστης δεν δημιουργεί εκδήλωση');
    assertStatus(await user2.request('/symvoulio/psifismata', {
      form: { question: 'Απαγορευμένη ψηφοφορία', choice_text_0: 'Α', choice_text_1: 'Β' }
    }), 403, 'Ο απλός χρήστης δεν δημιουργεί ψηφοφορία');

    const testEventDate = futureDate(60);
    const eventForm = await user1.request('/symvoulio/ekdiloseis/nea');
    for (const label of ['Τίτλος', 'Ημερομηνία', 'Ώρα', 'Τοποθεσία', 'Σημειώσεις', 'Αποθήκευση', 'Ακύρωση']) {
      includes(eventForm.text, label, 'Η φόρμα εκδήλωσης περιέχει «' + label + '»');
    }
    includes(eventForm.text, 'type="date"', 'Η ημερομηνία χρησιμοποιεί ημερολόγιο');
    includes(eventForm.text, 'type="time"', 'Η ώρα χρησιμοποιεί επιλογέα ώρας');
    ok(query(dataDir, 'SELECT id FROM events').length === 0, 'Δεν δημοσιεύεται εκδήλωση πριν την αποθήκευση');

    const event = await user1.request('/symvoulio/ekdiloseis', {
      form: {
        title: 'Εκδήλωση δοκιμής',
        event_date: testEventDate,
        event_time: '18:30',
        location: 'Αίθουσα τελετών',
        description: 'Σημειώσεις εκδήλωσης δοκιμής.'
      }
    });
    assertStatus(event, 302, 'Ο διαχειριστής δημιουργεί εκδήλωση');
    ok(query(dataDir, 'SELECT id FROM events').length === 1, 'Η εκδήλωση αποθηκεύτηκε');
    const publicEvents = await user2.request('/ekdiloseis');
    includes(publicEvents.text, 'Εκδήλωση δοκιμής', 'Η εκδήλωση εμφανίζεται μετά την αποθήκευση');
    includes(publicEvents.text, greekDate(testEventDate), 'Η ημερομηνία εμφανίζεται στα ελληνικά');
    includes(publicEvents.text, '18:30', 'Η ώρα εμφανίζεται σωστά');
    includes(publicEvents.text, 'Σημειώσεις εκδήλωσης δοκιμής.', 'Οι σημειώσεις εμφανίζονται στην εκδήλωση');
    notIncludes(publicEvents.text, '>+ Νέο</a>', 'Ο απλός χρήστης δεν βλέπει δημιουργία ούτε μετά την εκδήλωση');
    assertNoAuthControls(publicEvents, 'Δημόσια εκδήλωση');
    const managerEvents = await user1.request('/symvoulio/ekdiloseis');
    includes(managerEvents.text, '>+ Νέο</a>', 'Η διαχείριση εκδηλώσεων έχει «+ Νέο»');
    includes(managerEvents.text, 'Επεξεργασία', 'Ο διαχειριστής βλέπει επεξεργασία εκδήλωσης');
    const eventRow = query(dataDir, 'SELECT id FROM events ORDER BY id LIMIT 1')[0];
    const eventId = Number(eventRow.id);
    const ownerEventsPage = await owner.request('/ekdiloseis');
    includes(ownerEventsPage.text, 'data-detail-url="/symvoulio/ekdiloseis/' + eventId + '"', 'Η καρτέλα εκδήλωσης ανοίγει λεπτομέρειες για τον ιδιοκτήτη');
    includes(ownerEventsPage.text, 'tabindex="0"', 'Η καρτέλα εκδήλωσης είναι προσβάσιμη από πληκτρολόγιο');
    notIncludes((await user1.request('/ekdiloseis')).text, 'data-detail-url=', 'Ο διαχειριστής δεν αποκτά τη διπλή ενέργεια καρτέλας του ιδιοκτήτη');
    const ownerEventDetail = await owner.request('/symvoulio/ekdiloseis/' + eventId);
    assertStatus(ownerEventDetail, 200, 'Ο ιδιοκτήτης ανοίγει τις λεπτομέρειες εκδήλωσης');
    includes(ownerEventDetail.text, 'Ακύρωση εκδήλωσης', 'Ο ιδιοκτήτης βλέπει «Ακύρωση εκδήλωσης»');
    includes(ownerEventDetail.text, 'Θέλετε σίγουρα να ακυρώσετε αυτή την εκδήλωση;', 'Υπάρχει επιβεβαίωση ακύρωσης εκδήλωσης');
    const managerEventDetail = await user1.request('/symvoulio/ekdiloseis/' + eventId);
    assertStatus(managerEventDetail, 200, 'Ο διαχειριστής ανοίγει τις λεπτομέρειες εκδήλωσης');
    notIncludes(managerEventDetail.text, 'Ακύρωση εκδήλωσης', 'Ο διαχειριστής δεν βλέπει «Ακύρωση εκδήλωσης»');

    notIncludes((await user2.request('/')).text, 'action-title">Ψηφίστε', 'Το «Ψηφίστε» παραμένει κρυφό πριν ανοίξει ψηφοφορία');
    const managerPollsBefore = await user1.request('/symvoulio/psifismata');
    includes(managerPollsBefore.text, '>+ Νέο</a>', 'Η περιοχή ψηφοφοριών έχει «+ Νέο»');
    includes(managerPollsBefore.text, 'Δεν υπάρχουν ακόμα ψηφοφορίες.', 'Η λίστα ψηφοφοριών ξεκινά κενή');
    const pollForm = await user1.request('/symvoulio/psifismata/nea');
    includes(pollForm.text, 'type="file"', 'Η δημιουργία ψηφοφορίας διατηρεί επιλογές με εικόνα');

    const pollCreate = await user1.request('/symvoulio/psifismata', {
      form: {
        question: 'Ποια δραστηριότητα προτιμάτε;',
        choice_text_0: 'Ποδόσφαιρο',
        choice_text_1: 'Μπάσκετ'
      }
    });
    assertStatus(pollCreate, 302, 'Ο διαχειριστής δημιουργεί την πρώτη ψηφοφορία');
    const pollMatch = /\/symvoulio\/psifismata\/(\d+)/.exec(pollCreate.location || '');
    ok(!!pollMatch, 'Η ψηφοφορία δημιουργήθηκε με αναγνωριστικό');
    const pollId = Number(pollMatch[1]);
    const pollRows = query(dataDir, 'SELECT id, status FROM polls WHERE id = ?', [pollId]);
    ok(pollRows.length === 1 && pollRows[0].status === 'closed', 'Η νέα ψηφοφορία ξεκινά κλειστή');
    const closedPoll = await user2.request('/psifos/' + pollId);
    includes(closedPoll.text, 'Η ψηφοφορία έχει κλείσει.', 'Η κλειστή ψηφοφορία δεν επιτρέπει ψήφο');
    assertStatus(await guest.request('/psifos/' + pollId), 302, 'Η ψηφοφορία απαιτεί σύνδεση');
    const openPoll = await user1.request('/symvoulio/psifismata/' + pollId + '/anoigma', { form: {} });
    assertStatus(openPoll, 302, 'Ο διαχειριστής ανοίγει την ψηφοφορία');
    const homeWithPoll = await user2.request('/');
    includes(homeWithPoll.text, 'action-title">Ψηφίστε', 'Το «Ψηφίστε» εμφανίζεται όταν υπάρχει ανοιχτή ψηφοφορία');
    assertNoAuthControls(homeWithPoll, 'Αρχική με ανοιχτή ψηφοφορία');
    notIncludes((await guest.request('/')).text, 'action-title">Ψηφίστε', 'Ο επισκέπτης δεν βλέπει «Ψηφίστε»');
    const ownerPollsPage = await owner.request('/psifos');
    includes(ownerPollsPage.text, 'data-detail-url="/symvoulio/psifismata/' + pollId + '"', 'Η καρτέλα ψηφοφορίας ανοίγει λεπτομέρειες για τον ιδιοκτήτη');
    includes(ownerPollsPage.text, 'data-detail-single-click', 'Η απλή επιλογή ψήφου παραμένει διαθέσιμη στον ιδιοκτήτη');
    notIncludes((await user1.request('/psifos')).text, 'data-detail-url=', 'Ο διαχειριστής δεν αποκτά τη διπλή ενέργεια καρτέλας ψηφοφορίας');
    const ownerPollDetail = await owner.request('/symvoulio/psifismata/' + pollId);
    includes(ownerPollDetail.text, 'Ακύρωση ψηφοφορίας', 'Ο ιδιοκτήτης βλέπει «Ακύρωση ψηφοφορίας»');
    includes(ownerPollDetail.text, 'Θέλετε σίγουρα να ακυρώσετε αυτή την ψηφοφορία;', 'Υπάρχει επιβεβαίωση ακύρωσης ψηφοφορίας');
    const managerPollDetail = await user1.request('/symvoulio/psifismata/' + pollId);
    assertStatus(managerPollDetail, 200, 'Ο διαχειριστής ανοίγει τις λεπτομέρειες ψηφοφορίας');
    notIncludes(managerPollDetail.text, 'Ακύρωση ψηφοφορίας', 'Ο διαχειριστής δεν βλέπει «Ακύρωση ψηφοφορίας»');

    console.log('\n8. Ψηφοφορία, διπλότυπα και αποτελέσματα');
    const choices = query(dataDir, 'SELECT id FROM choices WHERE poll_id = ? ORDER BY position, id', [pollId]);
    ok(choices.length === 2, 'Η ψηφοφορία έχει δύο επιλογές');
    const choiceId = Number(choices[0].id);
    let pollPage = await user2.request('/psifos/' + pollId);
    includes(pollPage.text, 'Καταχώριση ψήφου', 'Ο χρήστης βλέπει τη φόρμα ψήφου');
    notIncludes(pollPage.text, 'Σύνολο ψήφων', 'Ο χρήστης δεν βλέπει αποτελέσματα πριν ψηφίσει');
    notIncludes(pollPage.text, 'Ανανέωση αποτελεσμάτων', 'Ο χρήστης δεν βλέπει ανανέωση αποτελεσμάτων πριν ψηφίσει');
    assertNoAuthControls(pollPage, 'Ψηφοφορία');
    const resultsBefore = await user2.request('/psifos/' + pollId + '/apotelesmata.json');
    assertStatus(resultsBefore, 403, 'Το JSON αποτελεσμάτων αποκλείεται πριν την ψήφο');
    const resultsGuest = await guest.request('/psifos/' + pollId + '/apotelesmata.json');
    assertStatus(resultsGuest, 302, 'Το JSON αποτελεσμάτων απαιτεί σύνδεση');

    const vote = await user2.request('/psifos/' + pollId, { form: { choice: String(choiceId) } });
    assertStatus(vote, 302, 'Η ψήφος του χρήστη καταχωρίζεται');
    ok(vote.location === '/psifos/' + pollId + '?ok=1', 'Μετά την ψήφο εμφανίζονται τα αποτελέσματα');
    const duplicate = await user2.request('/psifos/' + pollId, { form: { choice: String(choices[1].id) } });
    assertStatus(duplicate, 302, 'Η δεύτερη ψήφος απορρίπτεται χωρίς σφάλμα διακομιστή');
    const voteRows = query(dataDir, 'SELECT * FROM votes WHERE poll_id = ? AND user_id = ?', [pollId, user2Id]);
    ok(voteRows.length === 1 && Number(voteRows[0].choice_id) === choiceId, 'Η βάση κρατά μία μόνο ψήφο ανά λογαριασμό και ψηφοφορία');
    const resultsAfter = await user2.request('/psifos/' + pollId);
    includes(resultsAfter.text, 'Αποτελέσματα', 'Ο χρήστης βλέπει αποτελέσματα μετά την ψήφο');
    includes(resultsAfter.text, 'Σύνολο ψήφων', 'Εμφανίζεται το σύνολο ψήφων');
    includes(resultsAfter.text, 'Ανανέωση αποτελεσμάτων', 'Υπάρχει το κουμπί «Ανανέωση αποτελεσμάτων»');
    includes(resultsAfter.text, '%', 'Εμφανίζονται ποσοστά');
    const resultsJson = await user2.request('/psifos/' + pollId + '/apotelesmata.json');
    assertStatus(resultsJson, 200, 'Το JSON αποτελεσμάτων επιτρέπεται μετά την ψήφο');
    const resultsData = JSON.parse(resultsJson.text);
    ok(resultsData.total === 1, 'Το σύνολο ψήφων είναι σωστό');

    console.log('\n9. Ακύρωση εκδηλώσεων και ψηφοφοριών μόνο από τον ιδιοκτήτη');
    assertStatus(await user1.request('/symvoulio/ekdiloseis/' + eventId + '/akyrosi', { form: {} }), 403, 'Ο διαχειριστής δεν ακυρώνει εκδήλωση');
    assertStatus(await user1.request('/symvoulio/psifismata/' + pollId + '/akyrosi', { form: {} }), 403, 'Ο διαχειριστής δεν ακυρώνει ψηφοφορία');
    assertStatus(await user2.request('/symvoulio/ekdiloseis/' + eventId + '/akyrosi', { form: {} }), 403, 'Ο απλός χρήστης δεν ακυρώνει εκδήλωση');
    assertStatus(await user2.request('/symvoulio/psifismata/' + pollId + '/akyrosi', { form: {} }), 403, 'Ο απλός χρήστης δεν ακυρώνει ψηφοφορία');
    ok(!query(dataDir, 'SELECT cancelled_at FROM events WHERE id = ?', [eventId])[0].cancelled_at, 'Η αποτυχημένη απόπειρα δεν ακύρωσε την εκδήλωση');
    ok(query(dataDir, 'SELECT status FROM polls WHERE id = ?', [pollId])[0].status === 'open', 'Η αποτυχημένη απόπειρα δεν ακύρωσε την ψηφοφορία');

    const cancelEvent = await owner.request('/symvoulio/ekdiloseis/' + eventId + '/akyrosi', { form: {} });
    assertStatus(cancelEvent, 302, 'Ο ιδιοκτήτης ακυρώνει την εκδήλωση');
    const cancelledEvent = query(dataDir, 'SELECT cancelled_at FROM events WHERE id = ?', [eventId])[0];
    ok(!!cancelledEvent.cancelled_at, 'Η εκδήλωση σημάνθηκε ως ακυρωμένη στη βάση');
    ok(query(dataDir, 'SELECT id FROM events WHERE id = ?', [eventId]).length === 1, 'Η εκδήλωση δεν διαγράφηκε από το ιστορικό');
    notIncludes((await user2.request('/ekdiloseis')).text, 'Εκδήλωση δοκιμής', 'Η ακυρωμένη εκδήλωση εξαφανίστηκε από τις δημόσιες εκδηλώσεις');
    notIncludes((await owner.request('/symvoulio/ekdiloseis')).text, 'Εκδήλωση δοκιμής', 'Η ακυρωμένη εκδήλωση κρύφτηκε από την προεπιλεγμένη λίστα διαχείρισης');
    const cancelledEventDetail = await owner.request('/symvoulio/ekdiloseis/' + eventId);
    includes(cancelledEventDetail.text, 'Ακυρωμένη', 'Η λεπτομέρεια εκδήλωσης δείχνει την κατάσταση ακύρωσης');
    notIncludes(cancelledEventDetail.text, 'Ακύρωση εκδήλωσης</button>', 'Η ακυρωμένη εκδήλωση δεν προσφέρει ξανά ακύρωση');

    const votesBeforeCancel = query(dataDir, 'SELECT id FROM votes WHERE poll_id = ?', [pollId]).length;
    const cancelPoll = await owner.request('/symvoulio/psifismata/' + pollId + '/akyrosi', { form: {} });
    assertStatus(cancelPoll, 302, 'Ο ιδιοκτήτης ακυρώνει την ψηφοφορία');
    const cancelledPoll = query(dataDir, 'SELECT status, cancelled_at FROM polls WHERE id = ?', [pollId])[0];
    ok(cancelledPoll.status === 'cancelled' && !!cancelledPoll.cancelled_at, 'Η ψηφοφορία σημάνθηκε ως ακυρωμένη στη βάση');
    ok(query(dataDir, 'SELECT id FROM polls WHERE id = ?', [pollId]).length === 1, 'Η ψηφοφορία δεν διαγράφηκε από το ιστορικό');
    ok(query(dataDir, 'SELECT id FROM votes WHERE poll_id = ?', [pollId]).length === votesBeforeCancel, 'Οι ψήφοι της ψηφοφορίας διατηρήθηκαν');
    notIncludes((await user2.request('/psifos')).text, 'Ποια δραστηριότητα προτιμάτε;', 'Η ακυρωμένη ψηφοφορία εξαφανίστηκε από τη δημόσια λίστα ψηφοφοριών');
    notIncludes((await owner.request('/symvoulio/psifismata')).text, 'Ποια δραστηριότητα προτιμάτε;', 'Η ακυρωμένη ψηφοφορία κρύφτηκε από την προεπιλεγμένη λίστα διαχείρισης');
    includes((await user2.request('/psifos')).text, 'Δεν υπάρχει ενεργή ψηφοφορία αυτή τη στιγμή.', 'Η δημόσια λίστα δείχνει κενή μετά την ακύρωση');
    notIncludes((await user2.request('/')).text, 'action-title">Ψηφίστε', 'Το «Ψηφίστε» κρύφτηκε όταν ακυρώθηκε η τελευταία ανοιχτή ψηφοφορία');
    assertStatus(await user2.request('/psifos/' + pollId), 404, 'Η ακυρωμένη ψηφοφορία δεν ανοίγει δημόσια');
    assertStatus(await user2.request('/psifos/' + pollId, { form: { choice: String(choiceId) } }), 404, 'Η ψήφος σε ακυρωμένη ψηφοφορία απορρίπτεται αμέσως');
    ok(query(dataDir, 'SELECT id FROM votes WHERE poll_id = ?', [pollId]).length === votesBeforeCancel, 'Η απόπειρα ψήφου δεν πρόσθεσε ψήφο');
    assertStatus(await user2.request('/psifos/' + pollId + '/apotelesmata.json'), 404, 'Τα αποτελέσματα ακυρωμένης ψηφοφορίας δεν είναι δημόσια');
    assertStatus(await owner.request('/symvoulio/psifismata/' + pollId + '/anoigma', { form: {} }), 400, 'Η ακυρωμένη ψηφοφορία δεν ξανανοίγει');
    const cancelledPollDetail = await owner.request('/symvoulio/psifismata/' + pollId);
    includes(cancelledPollDetail.text, 'Ακυρωμένη', 'Η λεπτομέρεια ψηφοφορίας δείχνει την κατάσταση ακύρωσης');
    includes(cancelledPollDetail.text, 'Η ψηφοφορία έχει ακυρωθεί και δεν δέχεται ψήφους.', 'Η λεπτομέρεια εξηγεί ότι δεν δέχεται ψήφους');

    console.log('\n10. Ανάκληση διαχείρισης και προστασία ιδιοκτήτη');
    const revoke = await owner.request('/symvoulio/prosvasi/afairesi', { form: { user_id: String(user1Id) } });
    assertStatus(revoke, 302, 'Ο ιδιοκτήτης αφαιρεί τα δικαιώματα διαχείρισης');
    ok(query(dataDir, 'SELECT role FROM users WHERE id = ?', [user1Id])[0].role === 'user', 'Ο λογαριασμός επέστρεψε σε απλό χρήστη');
    assertStatus(await user1.request('/symvoulio'), 403, 'Η αφαίρεση ισχύει αμέσως στην ενεργή συνεδρία');
    notIncludes((await user1.request('/ekdiloseis')).text, '>+ Νέο</a>', 'Ο ανακληθείς χρήστης δεν βλέπει «+ Νέο»');
    assertStatus(await user1.request('/symvoulio/ekdiloseis', {
      form: { title: 'Μετά την ανάκληση', event_date: '2026-12-21', event_time: '19:00', location: 'Αίθουσα', description: 'Δοκιμή.' }
    }), 403, 'Ο ανακληθείς διαχειριστής δεν μπορεί να δημιουργήσει εκδήλωση');
    const ownerSelfRevoke = await owner.request('/symvoulio/prosvasi/afairesi', { form: { user_id: String(ownerId) } });
    assertStatus(ownerSelfRevoke, 400, 'Ο λογαριασμός ιδιοκτήτη δεν αφαιρείται');
    includes(ownerSelfRevoke.text, 'Ο λογαριασμός ιδιοκτήτη δεν μπορεί να αλλάξει', 'Υπάρχει σαφές ελληνικό μήνυμα για τον ιδιοκτήτη');
    ok(query(dataDir, "SELECT id FROM users WHERE role = 'owner'")[0].id === ownerId, 'Ο ιδιοκτήτης παραμένει ιδιοκτήτης');
    includes((await owner.request('/symvoulio/prosvasi')).text, 'Σύνολο διαχειριστών: <strong>0</strong>', 'Ο αριθμός διαχειριστών ενημερώθηκε');

    console.log('\n11. Προστασία από επαναλαμβανόμενες προσπάθειες σύνδεσης');
    const attacker = new Client(base);
    let lastAttempt = null;
    for (let i = 0; i < 7; i += 1) {
      const attempt = await attacker.request('/syndesi', {
        form: { username: 'throttle_user', password: 'wrong-password-' + i }
      });
      lastAttempt = attempt;
      if (i < 6) ok(attempt.status === 401, 'Αποτυχημένη προσπάθεια ' + (i + 1) + ' απορρίπτεται');
      else includes(attempt.text, 'Πολλές αποτυχημένες προσπάθειες', 'Η έβδομη προσπάθεια μπλοκάρεται');
    }
    ok(lastAttempt.status === 429, 'Η σύνδεση μπλοκάρεται μετά από επαναλαμβανόμενες αποτυχίες');
    ok(inputTag(lastAttempt.text, 'login_username').length > 0, 'Η σελίδα αποτυχίας είναι η σελίδα εισόδου');
    ok(!inputTag(lastAttempt.text, 'login_password').includes('value='), 'Το μπλοκάρισμα δεν αποκαλύπτει κωδικό');

    console.log('\n12. Κανένα όνομα λογαριασμού στην διεπαφή');
    const storedNames = query(dataDir, 'SELECT username FROM users').map(row => String(row.username));
    storedNames.push(RESERVED_OWNER_USERNAME);
    const ownerPages = [
      ['/', 'αρχική'],
      ['/logariasmos', 'λογαριασμός'],
      ['/symvoulio', 'περιοχή διαχείρισης'],
      ['/symvoulio/prosvasi', 'διαχείριση πρόσβασης'],
      ['/symvoulio/ekdiloseis', 'διαχείριση εκδηλώσεων'],
      ['/symvoulio/ekdiloseis/nea', 'νέα εκδήλωση'],
      ['/symvoulio/ekdiloseis/' + eventId, 'λεπτομέρεια εκδήλωσης'],
      ['/symvoulio/ekdiloseis/' + eventId + '/epexergasia', 'επεξεργασία εκδήλωσης'],
      ['/symvoulio/psifismata', 'διαχείριση ψηφοφοριών'],
      ['/symvoulio/psifismata/nea', 'νέα ψηφοφορία'],
      ['/symvoulio/psifismata/' + pollId, 'λεπτομέρεια ψηφοφορίας'],
      ['/ekdiloseis', 'δημόσιες εκδηλώσεις'],
      ['/psifos', 'δημόσιες ψηφοφορίες'],
      ['/protaseis', 'προτάσεις'],
      ['/protasi', 'φόρμα πρότασης']
    ];
    for (const [pathname, label] of ownerPages) {
      assertNoAccountNames(await owner.request(pathname), storedNames, 'Ιδιοκτήτης: ' + label);
    }
    const ordinaryPages = [
      ['/', 'αρχική'],
      ['/logariasmos', 'λογαριασμός'],
      ['/ekdiloseis', 'δημόσιες εκδηλώσεις'],
      ['/psifos', 'δημόσιες ψηφοφορίες'],
      ['/protaseis', 'προτάσεις'],
      ['/protasi', 'φόρμα πρότασης'],
      ['/symvoulio', 'απαγορευμένη διαχείριση'],
      ['/symvoulio/prosvasi', 'απαγορευμένη πρόσβαση']
    ];
    for (const [pathname, label] of ordinaryPages) {
      assertNoAccountNames(await user2.request(pathname), storedNames, 'Απλός χρήστης: ' + label);
    }
    assertNoAccountNames(
      await owner.request('/symvoulio/prosvasi', { form: { username: 'Μαθητης_1' } }),
      storedNames,
      'Ιδιοκτήτης: αναζήτηση λογαριασμού'
    );
    assertNoAccountNames(
      await owner.request('/symvoulio/prosvasi', { form: { username: 'agnosto-onoma' } }),
      storedNames,
      'Ιδιοκτήτης: άγνωστη αναζήτηση'
    );
    const ownerMenu = await owner.request('/');
    notIncludes(ownerMenu.text, 'account-menu', 'Δεν υπάρχει μενού λογαριασμού στην αρχική');
    notIncludes(ownerMenu.text, 'account-trigger', 'Δεν υπάρχει κουμπί λογαριασμού στην αρχική');
    notIncludes(ownerMenu.text, 'account-icon', 'Δεν υπάρχει εικονίδιο λογαριασμού στην αρχική');
    notIncludes(ownerMenu.text, 'id="account-menu-trigger"', 'Δεν υπάρχει αναγνωριστικό κουμπιού λογαριασμού');
    notIncludes(ownerMenu.text, 'Άνοιγμα μενού λογαριασμού', 'Δεν υπάρχει tooltip λογαριασμού στην αρχική');
    notIncludes(ownerMenu.text, 'Αποσύνδεση', 'Η «Αποσύνδεση» δεν εμφανίζεται πλέον');

    console.log('\n13. Ελληνική διεπαφή, κινητή διάταξη και γραμματοσειρά');
    const entryAgain = await guest.request('/');
    for (const label of ['Όνομα χρήστη', 'Κωδικός πρόσβασης', 'Επιβεβαίωση κωδικού πρόσβασης', 'Σύνδεση', 'Εγγραφή']) {
      includes(entryAgain.text, label, 'Υπάρχει η ελληνική ετικέτα «' + label + '»');
    }
    notIncludes(entryAgain.text, 'type="email"', 'Δεν ζητείται email στην είσοδο');
    includes(entryAgain.text, 'name="viewport"', 'Υπάρχει ρύθμιση προβολής για κινητά');
    includes(entryAgain.text, 'bubble-text', 'Το λογότυπο χρησιμοποιεί στρογγυλεμένη γραφή');
    const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
    includes(css, '@font-face', 'Το CSS ορίζει τοπική ελληνική γραμματοσειρά');
    includes(css, '/fonts/comfortaa-bold.ttf', 'Η γραμματοσειρά φορτώνεται τοπικά');
    includes(css, '.bubble-text', 'Υπάρχει ειδικό στυλ για τίτλο και λογότυπο');
    includes(css, '.auth-grid', 'Η σελίδα εισόδου έχει διάταξη δύο στηλών');
    includes(css, '@media (max-width: 720px)', 'Η σελίδα εισόδου γίνεται μία στήλη σε μικρές οθόνες');
    includes(css, '@media (max-width: 480px)', 'Το CSS περιλαμβάνει διάταξη για κινητά');
    includes(css, '--bg: #eaf5ff', 'Το φωτεινό μπλε θέμα διατηρείται');
    includes(css, '--ink: #11386b', 'Το σκούρο μπλε κείμενο διατηρείται');
    notIncludes(css, '.account-menu', 'Δεν υπάρχει στυλ για μενού λογαριασμού');
    notIncludes(css, '.account-trigger', 'Δεν υπάρχει στυλ για κουμπί λογαριασμού');
    notIncludes(css, '.council-user', 'Δεν υπάρχει στυλ δοχείου λογαριασμού στην περιοχή διαχείρισης');
    includes(css, '.owner-detail-card', 'Υπάρχει στυλ για τις καρτέλες λεπτομερειών');
    includes(css, '.badge-cancelled', 'Υπάρχει στυλ για ακυρωμένα στοιχεία');
    const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
    notIncludes(appJs, 'setupAccountMenu', 'Το JS δεν ρυθμίζει πλέον μενού λογαριασμού');
    notIncludes(appJs, 'data-account-menu', 'Το JS δεν αναζητά δοχείο μενού λογαριασμού');
    notIncludes(appJs, 'account-trigger', 'Το JS δεν αναζητά κουμπί λογαριασμού');
    includes(appJs, "addEventListener('dblclick'", 'Οι καρτέλες ανοίγουν λεπτομέρειες με διπλό κλικ');
    includes(appJs, "addEventListener('touchend'", 'Υποστηρίζεται διπλό άγγιγμα σε οθόνες αφής για τις καρτέλες');
    includes(appJs, "addEventListener('keydown'", 'Υπάρχει πρόσβαση με πληκτρολόγιο στις καρτέλες');
    includes(appJs, 'data-detail-url', 'Οι καρτέλες ανοίγουν λεπτομέρειες με το JS');
    const fontInfo = fs.statSync(path.join(ROOT, 'public/fonts/comfortaa-bold.ttf'));
    ok(fontInfo.size > 10000, 'Το αρχείο ελληνικής γραμματοσειράς υπάρχει');
    const fontHead = await fetch(base + '/fonts/comfortaa-bold.ttf', { method: 'HEAD' });
    ok(fontHead.status === 200, 'Η γραμματοσειρά σερβίρεται δημόσια');

    console.log('\n13β. PWA, προσωρινή μνήμη και ασφαλής αποθήκευση');
    includes(entryAgain.text, 'rel="manifest" href="/manifest.webmanifest"', 'Η σελίδα συνδέεται με το manifest');
    includes(entryAgain.text, 'name="theme-color"', 'Υπάρχει χρώμα θέματος για κινητά');
    includes(entryAgain.text, 'apple-touch-icon', 'Υπάρχει εικονίδιο για iOS');
    ok(entryAgain.cacheControl.includes('no-store'), 'Οι δυναμικές σελίδες δεν αποθηκεύονται προσωρινά');
    const manifestResponse = await guest.request('/manifest.webmanifest');
    assertStatus(manifestResponse, 200, 'Το manifest σερβίρεται');
    const manifest = JSON.parse(manifestResponse.text);
    ok(manifest.display === 'standalone' && manifest.start_url === '/', 'Το manifest είναι εγκαταστάσιμο PWA');
    ok(manifest.icons.some(icon => icon.sizes === '192x192') && manifest.icons.some(icon => icon.purpose === 'maskable'), 'Το manifest έχει κανονικά και maskable εικονίδια');
    const swResponse = await guest.request('/sw.js');
    assertStatus(swResponse, 200, 'Το service worker σερβίρεται');
    includes(swResponse.text, "const CACHE = 'pes-to-static-v2'", 'Το service worker έχει έκδοση προσωρινής μνήμης');
    includes(swResponse.text, 'STATIC.has(url.pathname)', 'Το service worker αποθηκεύει μόνο επιτρεπόμενα στατικά αρχεία');
    notIncludes(swResponse.text, "'/psifos'", 'Το service worker δεν αποθηκεύει σελίδες ψηφοφορίας');
    notIncludes(appJs, 'beforeinstallprompt', 'Δεν εμφανίζεται αυτόματο μήνυμα εγκατάστασης');
    includes(appJs, "navigator.serviceWorker.register('/sw.js')", 'Το service worker καταχωρείται χωρίς εγκατάσταση');
    ok(fs.existsSync(path.join(ROOT, 'public/icons/icon-192.png')), 'Υπάρχει εικονίδιο PWA 192');
    ok(fs.existsSync(path.join(ROOT, 'public/icons/icon-512.png')), 'Υπάρχει εικονίδιο PWA 512');
    assertNoAuthControls(await user2.request('/'), 'Τελική αρχική χρήστη');
    const userAccountPage = await user2.request('/logariasmos');
    assertNoAuthControls(userAccountPage, 'Λογαριασμός χρήστη');
    includes(userAccountPage.text, 'Αλλαγή κωδικού', 'Η σελίδα λογαριασμού παραμένει διαθέσιμη');
    notIncludes(userAccountPage.text, 'action="/aposyndesi"', 'Δεν υπάρχει φόρμα αποσύνδεσης στη σελίδα λογαριασμού');
    notIncludes(userAccountPage.text, 'εικονίδιο λογαριασμού', 'Η σελίδα λογαριασμού δεν παραπέμπει σε εικονίδιο λογαριασμού');
    assertNoAuthControls(await owner.request('/symvoulio'), 'Περιοχή διαχείρισης');
    assertNoAuthControls(await owner.request('/symvoulio/prosvasi'), 'Διαχείριση πρόσβασης');

    assertStatus(await loggedIn2.request('/aposyndesi'), 404, 'Το άνοιγμα της διεύθυνσης αποσύνδεσης με GET δεν αποσυνδέει');
    assertStatus(await loggedIn2.request('/'), 200, 'Η συνεδρία παραμένει ενεργή πριν την επιλογή αποσύνδεσης');
    const logout = await loggedIn2.request('/aposyndesi', { form: {} });
    assertStatus(logout, 302, 'Η αποσύνδεση εκτελείται μόνο με POST');
    const afterLogout = await loggedIn2.request('/');
    includes(afterLogout.text, 'id="login_username"', 'Μετά την αποσύνδεση εμφανίζεται η σελίδα εισόδου');
    notIncludes(afterLogout.text, 'action-card', 'Η αποσυνδεδεμένη συνεδρία δεν βλέπει την αρχική');
    assertNoAccountNames(afterLogout, storedNames, 'Σελίδα εισόδου μετά την αποσύνδεση');
    ok(!inputTag(afterLogout.text, 'login_username').includes('value='), 'Η σελίδα εισόδου δεν εμφανίζει όνομα λογαριασμού');

    await stopServer(server);
    server = null;
    await migrationScenario(tempRoot);

    console.log('\n' + passed + ' έλεγχοι πέρασαν με επιτυχία.\n');
  } finally {
    await stopServer(server);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('\nΑΠΟΤΥΧΙΑ ΕΛΕΓΧΟΥ');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
