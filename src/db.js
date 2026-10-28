'use strict';
const { IS_VERCEL } = require('./paths');

const DATABASE_URL = process.env.DATABASE_URL || '';
const IS_POSTGRES = Boolean(DATABASE_URL);
const IS_CLOUD = IS_POSTGRES || IS_VERCEL;

let local = null;
if (!IS_POSTGRES && IS_VERCEL) {
  throw new Error('DATABASE_URL is required on Vercel.');
}
if (IS_POSTGRES && DATABASE_URL.includes('[YOUR-PASSWORD]')) {
  throw new Error('DATABASE_URL still contains the [YOUR-PASSWORD] placeholder.');
}
if (!IS_POSTGRES && !IS_VERCEL) {
  local = require('./db-local');
}

const { POSTGRES_SCHEMA } = require('./schema-postgres');

let pool = null;
let readyPromise = null;

function init() {
  if (!IS_POSTGRES) return Promise.resolve();
  if (readyPromise) return readyPromise;
  const { Pool } = require('pg');
  const needsSsl = !/^postgres(ql)?:\/\/[^/]*(localhost|127\.0\.0\.1)/i.test(DATABASE_URL);
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX) || 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'pes-to'
  });
  readyPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(982451653)");
      await client.query(POSTGRES_SCHEMA);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      readyPromise = null;
      throw error;
    } finally {
      client.release();
    }
  })();
  return readyPromise;
}

function toPostgres(sql) {
  let out = String(sql);
  const ignore = /INSERT\s+OR\s+IGNORE\s+INTO/i.test(out);
  if (ignore) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  }
  let index = 0;
  out = out.replace(/\?/g, () => '$' + (++index));
  if (ignore) out = out.trim().replace(/;$/, '') + ' ON CONFLICT DO NOTHING';
  return out;
}

const NO_ID_TABLES = new Set(['suggestion_likes', 'sessions', 'login_attempts']);

function insertTable(sql) {
  const match = /^\s*INSERT\s+INTO\s+([a-z_]+)/i.exec(sql);
  return match ? match[1].toLowerCase() : '';
}

async function query(sql, params = [], mode = 'all') {
  await init();
  if (!IS_POSTGRES) {
    const statement = local.db.prepare(sql);
    if (mode === 'get') return statement.get(...params) || null;
    if (mode === 'run') return statement.run(...params);
    return statement.all(...params);
  }

  let text = toPostgres(sql);
  let returning = false;
  if (mode === 'run' && /^\s*INSERT\s/i.test(text) && !/RETURNING/i.test(text)) {
    if (!NO_ID_TABLES.has(insertTable(text))) {
      text = text.replace(/;$/, '') + ' RETURNING id';
      returning = true;
    }
  }
  const result = await pool.query(text, params);
  if (mode === 'get') return result.rows[0] || null;
  if (mode === 'run') {
    return {
      changes: result.rowCount,
      lastInsertRowid: returning && result.rows[0] ? Number(result.rows[0].id) : 0
    };
  }
  return result.rows;
}

function prepare(sql) {
  return {
    get: (...params) => query(sql, params, 'get'),
    all: (...params) => query(sql, params, 'all'),
    run: (...params) => query(sql, params, 'run')
  };
}

async function exec(sql) {
  await init();
  if (!IS_POSTGRES) {
    local.db.exec(sql);
    return;
  }
  await pool.query(String(sql));
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    readyPromise = null;
  }
}

const db = { prepare, exec, query, init, close };
const SUGGESTION_CATEGORIES = local ? local.SUGGESTION_CATEGORIES : [
  'Γενική',
  'Φιλανθρωπική',
  'Περιβαλλοντική',
  'Αθλητική',
  'Πολιτισμική'
];

module.exports = { db, SUGGESTION_CATEGORIES, IS_POSTGRES, IS_CLOUD };
