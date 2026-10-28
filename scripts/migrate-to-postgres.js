'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { Client } = require('pg');
const { POSTGRES_SCHEMA } = require('../src/schema-postgres');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const DATABASE_URL = process.env.DATABASE_URL || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/(?:rest|storage)\/v1$/i, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'pes-to-uploads';
const replace = process.argv.includes('--replace');
const skipUploads = process.argv.includes('--skip-uploads');
const uploadsOnly = process.argv.includes('--uploads-only');

const TABLES = [
  ['users', ['id', 'username', 'username_key', 'pass_hash', 'role', 'is_admin', 'created_at']],
  ['sessions', ['token', 'user_id', 'created_at', 'expires_at']],
  ['suggestions', ['id', 'category', 'title', 'description', 'is_public', 'created_at']],
  ['suggestion_likes', ['suggestion_id', 'user_id', 'created_at']],
  ['events', ['id', 'title', 'event_date', 'event_time', 'location', 'description', 'image_path', 'created_at', 'cancelled_at']],
  ['polls', ['id', 'question', 'status', 'created_at', 'closed_at', 'cancelled_at']],
  ['choices', ['id', 'poll_id', 'text', 'image_path', 'position']],
  ['codes', ['id', 'code', 'created_at']],
  ['votes', ['id', 'poll_id', 'choice_id', 'user_id', 'code_id', 'created_at']]
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!DATABASE_URL) fail('Ορίστε το DATABASE_URL (Supabase Postgres) πριν τη μετεγκατάσταση.');
if (DATABASE_URL.includes('[YOUR-PASSWORD]')) fail('Το DATABASE_URL περιέχει ακόμη το [YOUR-PASSWORD]. Αντικαταστήστε το με τον κωδικό της βάσης.');
const databaseIsLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const dbPath = path.join(DATA_DIR, 'pes-to.db');
if (!fs.existsSync(dbPath)) fail('Δεν βρέθηκε η τοπική βάση: ' + dbPath);

const source = new DatabaseSync(dbPath, { readOnly: true });
source.exec('PRAGMA busy_timeout = 5000');

function columns(table) {
  try {
    return new Set(source.prepare('PRAGMA table_info(' + table + ')').all().map(row => row.name));
  } catch {
    return new Set();
  }
}

function sourceRows(table, wanted) {
  const available = columns(table);
  if (!available.size) return { columns: [], rows: [] };
  const selected = wanted.filter(column => available.has(column));
  if (!selected.length) return { columns: [], rows: [] };
  const rows = source.prepare('SELECT ' + selected.join(', ') + ' FROM ' + table).all();
  return { columns: selected, rows };
}

function countSource(table) {
  try {
    return Number(source.prepare('SELECT COUNT(*) AS c FROM ' + table).get().c);
  } catch {
    return 0;
  }
}

async function uploadImages() {
  if (skipUploads) {
    console.log('  Παραλείπεται η μεταφορά εικόνων (--skip-uploads).');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    fail('Για τη μεταφορά εικόνων απαιτούνται SUPABASE_URL και SUPABASE_SERVICE_ROLE_KEY (ή χρησιμοποιήστε --skip-uploads).');
  }
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: bucket } = await supabase.storage.getBucket(BUCKET);
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error && !/already exists/i.test(error.message)) fail('Αποτυχία δημιουργίας bucket: ' + error.message);
  }
  if (!fs.existsSync(UPLOAD_DIR)) {
    console.log('  Δεν υπάρχει τοπικός φάκελος uploads· δεν μεταφέρθηκαν εικόνες.');
    return;
  }
  const files = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true }).filter(entry => entry.isFile());
  const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
  for (const entry of files) {
    const ext = path.extname(entry.name).toLowerCase();
    const buffer = fs.readFileSync(path.join(UPLOAD_DIR, entry.name));
    const { error } = await supabase.storage.from(BUCKET).upload(entry.name, buffer, {
      contentType: types[ext] || 'application/octet-stream',
      upsert: true,
      cacheControl: '31536000'
    });
    if (error) fail('Αποτυχία μεταφόρτωσης ' + entry.name + ': ' + error.message);
  }
  const { data: listed, error: listError } = await supabase.storage.from(BUCKET).list('', { limit: 1000 });
  if (listError) fail('Αποτυχία επαλήθευσης bucket: ' + listError.message);
  const remote = new Set((listed || []).map(item => item.name));
  const missing = files.filter(entry => !remote.has(entry.name));
  if (missing.length) fail('Λείπουν εικόνες από το Storage: ' + missing.map(x => x.name).join(', '));
  console.log('  Μεταφέρθηκαν και επαληθεύτηκαν ' + files.length + ' εικόνες.');
}

async function main() {
  console.log('Μετεγκατάσταση «Πες το» προς Supabase Postgres');
  console.log('  Πηγή: ' + dbPath);
  console.log('  Προορισμός: Supabase Postgres (τα διαπιστευτήρια δεν εμφανίζονται)');
  console.log('');

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: databaseIsLocal ? false : { rejectUnauthorized: false },
    application_name: 'pes-to-migration'
  });
  await client.connect();
  try {
    if (uploadsOnly) {
      await uploadImages();
      console.log('\nΗ μεταφορά εικόνων ολοκληρώθηκε.');
      return;
    }
    await client.query(POSTGRES_SCHEMA);
    const existing = await client.query(`
      SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM suggestions) +
             (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM polls) +
             (SELECT COUNT(*) FROM votes) AS total
    `);
    if (Number(existing.rows[0].total) > 0 && !replace) {
      fail('Ο προορισμός περιέχει ήδη δεδομένα. Χρησιμοποιήστε --replace μόνο αν θέλετε αντικατάσταση.');
    }

    await client.query('BEGIN');
    if (replace) {
      await client.query('TRUNCATE login_attempts, votes, codes, choices, polls, suggestion_likes, suggestions, events, sessions, users RESTART IDENTITY CASCADE');
    }

    for (const [table, wanted] of TABLES) {
      const { columns: cols, rows } = sourceRows(table, wanted);
      if (!cols.length) {
        console.log('  ' + table + ': δεν υπάρχει στην πηγή, παράλειψη.');
        continue;
      }
      for (const row of rows) {
        const values = cols.map(column => row[column]);
        const placeholders = cols.map((_, index) => '$' + (index + 1));
        await client.query(
          'INSERT INTO ' + table + ' (' + cols.join(', ') + ') VALUES (' + placeholders.join(', ') + ')',
          values
        );
      }
      console.log('  ' + table + ': ' + rows.length + ' εγγραφές.');
    }

    for (const table of ['users', 'suggestions', 'events', 'polls', 'choices', 'codes', 'votes']) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('${table}', 'id'),
          COALESCE(MAX(id), 1),
          MAX(id) IS NOT NULL
        ) FROM ${table}
      `);
    }
    await client.query('COMMIT');

    console.log('\nΕπαλήθευση δεδομένων');
    let failed = false;
    for (const [table] of TABLES) {
      const before = countSource(table);
      const after = Number((await client.query('SELECT COUNT(*) AS c FROM ' + table)).rows[0].c);
      const ok = before === after;
      if (!ok) failed = true;
      console.log('  ' + (ok ? 'ok  ' : 'FAIL') + ' ' + table + ': ' + before + ' → ' + after);
    }

    const checks = [
      ['Ορφανές προτιμήσεις', 'SELECT COUNT(*) AS c FROM suggestion_likes l LEFT JOIN suggestions s ON s.id = l.suggestion_id LEFT JOIN users u ON u.id = l.user_id WHERE s.id IS NULL OR u.id IS NULL'],
      ['Ορφανές επιλογές', 'SELECT COUNT(*) AS c FROM choices ch LEFT JOIN polls p ON p.id = ch.poll_id WHERE p.id IS NULL'],
      ['Ορφανές ψήφοι', 'SELECT COUNT(*) AS c FROM votes v LEFT JOIN polls p ON p.id = v.poll_id LEFT JOIN choices ch ON ch.id = v.choice_id WHERE p.id IS NULL OR ch.id IS NULL'],
      ['Διπλές ψήφοι χρήστη', 'SELECT COUNT(*) AS c FROM (SELECT poll_id, user_id FROM votes WHERE user_id IS NOT NULL GROUP BY poll_id, user_id HAVING COUNT(*) > 1) x'],
      ['Διπλές ψήφοι κωδικού', 'SELECT COUNT(*) AS c FROM (SELECT poll_id, code_id FROM votes WHERE code_id IS NOT NULL GROUP BY poll_id, code_id HAVING COUNT(*) > 1) x']
    ];
    for (const [label, sql] of checks) {
      const count = Number((await client.query(sql)).rows[0].c);
      if (count !== 0) failed = true;
      console.log('  ' + (count === 0 ? 'ok  ' : 'FAIL') + ' ' + label + ': ' + count);
    }
    const ownerCount = Number((await client.query("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'")).rows[0].c);
    if (ownerCount > 1) failed = true;
    console.log('  ' + (ownerCount <= 1 ? 'ok  ' : 'FAIL') + ' Λογαριασμοί ιδιοκτήτη: ' + ownerCount);

    if (failed) fail('Η επαλήθευση απέτυχε. Μην προχωρήσετε σε deployment.');

    await uploadImages();
    console.log('\nΗ μετεγκατάσταση ολοκληρώθηκε και επαληθεύτηκε.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
    source.close();
  }
}

main().catch(error => {
  console.error('\nΑΠΟΤΥΧΙΑ ΜΕΤΕΓΚΑΤΑΣΤΑΣΗΣ');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
