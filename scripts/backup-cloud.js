'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const DATABASE_URL = process.env.DATABASE_URL || '';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/(?:rest|storage)\/v1$/i, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'pes-to-uploads';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(ROOT, 'backups', 'cloud-' + stamp);

const TABLES = [
  'users',
  'sessions',
  'suggestions',
  'suggestion_likes',
  'events',
  'polls',
  'choices',
  'codes',
  'votes',
  'login_attempts'
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!DATABASE_URL) fail('Ορίστε το DATABASE_URL πριν το backup.');
if (!SUPABASE_URL || !SUPABASE_KEY) fail('Ορίστε SUPABASE_URL και SUPABASE_SERVICE_ROLE_KEY πριν το backup.');

async function downloadUploads(supabase) {
  const dir = path.join(target, 'uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let offset = 0;
  const names = [];
  for (;;) {
    const { data, error } = await supabase.storage.from(BUCKET).list('', { limit: 1000, offset });
    if (error) fail('Αποτυχία ανάγνωσης Storage: ' + error.message);
    if (!data || !data.length) break;
    for (const item of data) {
      const name = path.basename(item.name);
      if (!name || name !== item.name) continue;
      const { data: file, error: downloadError } = await supabase.storage.from(BUCKET).download(name);
      if (downloadError || !file) fail('Αποτυχία λήψης ' + name + ': ' + (downloadError ? downloadError.message : 'κενό αρχείο'));
      fs.writeFileSync(path.join(dir, name), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
      names.push(name);
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return names;
}

async function main() {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
    application_name: 'pes-to-backup'
  });
  await client.connect();
  try {
    const dump = {};
    const counts = {};
    for (const table of TABLES) {
      const result = await client.query('SELECT * FROM ' + table);
      dump[table] = result.rows;
      counts[table] = result.rowCount;
    }

    const ownerCount = Number((await client.query("SELECT COUNT(*) AS c FROM users WHERE role = 'owner'")).rows[0].c);
    const orphanLikes = Number((await client.query(`
      SELECT COUNT(*) AS c FROM suggestion_likes l
      LEFT JOIN suggestions s ON s.id = l.suggestion_id
      LEFT JOIN users u ON u.id = l.user_id
      WHERE s.id IS NULL OR u.id IS NULL
    `)).rows[0].c);
    const orphanVotes = Number((await client.query(`
      SELECT COUNT(*) AS c FROM votes v
      LEFT JOIN polls p ON p.id = v.poll_id
      LEFT JOIN choices ch ON ch.id = v.choice_id
      WHERE p.id IS NULL OR ch.id IS NULL
    `)).rows[0].c);
    const duplicateVotes = Number((await client.query(`
      SELECT COUNT(*) AS c FROM (
        SELECT poll_id, user_id FROM votes WHERE user_id IS NOT NULL
        GROUP BY poll_id, user_id HAVING COUNT(*) > 1
      ) x
    `)).rows[0].c);
    if (ownerCount > 1) fail('Υπάρχουν πολλοί λογαριασμοί ιδιοκτήτη.');
    if (orphanLikes || orphanVotes || duplicateVotes) fail('Η βάση έχει ορφανές ή διπλές εγγραφές.');

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const uploads = await downloadUploads(supabase);

    fs.writeFileSync(path.join(target, 'data.json'), JSON.stringify(dump, null, 2), { mode: 0o600 });
    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
      created_at: new Date().toISOString(),
      counts,
      owner_count: ownerCount,
      orphan_likes: orphanLikes,
      orphan_votes: orphanVotes,
      duplicate_votes: duplicateVotes,
      uploads
    }, null, 2), { mode: 0o600 });

    console.log('Cloud backup: ' + target);
    for (const [table, count] of Object.entries(counts)) console.log('  ' + table + ': ' + count);
    console.log('  uploads: ' + uploads.length);
    console.log('  σχέσεις και μονός ιδιοκτήτης: ok');
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
