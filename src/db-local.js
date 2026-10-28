'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./paths');
const { normalizeUsernameKey } = require('./utils');
const { hashPassword, verifyPassword } = require('./passwords');

const db = new DatabaseSync(path.join(DATA_DIR, 'pes-to.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

const SUGGESTION_CATEGORIES = [
  'Γενική',
  'Φιλανθρωπική',
  'Περιβαλλοντική',
  'Αθλητική',
  'Πολιτισμική'
];

const REMOVED_POLL_QUESTIONS = [
  'Ποια αθλητική δραστηριότητα θέλετε για την εκδρομή;'
];

const LEGACY_SUGGESTION_CATEGORIES = [
  ['Γενικές', 'Γενική'],
  ['Φιλανθρωπικές', 'Φιλανθρωπική'],
  ['Περιβαλλοντικές', 'Περιβαλλοντική'],
  ['Αθλητικές', 'Αθλητική'],
  ['Πολιτισμικές', 'Πολιτισμική']
];

function tableColumns(table) {
  return new Set(db.prepare('PRAGMA table_info(' + table + ')').all().map(row => row.name));
}

function migrate() {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');

  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      username_key TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'manager', 'owner')),
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suggestion_likes (
      suggestion_id INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (suggestion_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      event_time TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      image_path TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'closed',
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS choices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      text TEXT,
      image_path TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      attempt_key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
      choice_id INTEGER NOT NULL REFERENCES choices(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      code_id INTEGER REFERENCES codes(id),
      created_at TEXT NOT NULL
    );
    `);

    const userColumns = tableColumns('users');
    const wasLegacySchema = !userColumns.has('role');
    if (wasLegacySchema) {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    }
    if (!userColumns.has('username_key')) {
      db.exec('ALTER TABLE users ADD COLUMN username_key TEXT');
    }
    const missingKeys = db.prepare(
      "SELECT id, username FROM users WHERE username_key IS NULL OR username_key = ''"
    ).all();
    if (missingKeys.length) {
      const update = db.prepare('UPDATE users SET username_key = ? WHERE id = ?');
      for (const row of missingKeys) {
        update.run(normalizeUsernameKey(row.username), row.id);
      }
    }

    const eventColumns = tableColumns('events');
    if (!eventColumns.has('cancelled_at')) {
      db.exec('ALTER TABLE events ADD COLUMN cancelled_at TEXT');
    }

    const pollColumns = tableColumns('polls');
    if (!pollColumns.has('cancelled_at')) {
      db.exec('ALTER TABLE polls ADD COLUMN cancelled_at TEXT');
    }

    const suggestionColumns = tableColumns('suggestions');
    if (!suggestionColumns.has('is_public')) {
      db.exec('ALTER TABLE suggestions ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
    }

    const updateCategory = db.prepare('UPDATE suggestions SET category = ? WHERE category = ?');
    for (const [previous, current] of LEGACY_SUGGESTION_CATEGORIES) {
      updateCategory.run(current, previous);
    }

    const voteColumns = tableColumns('votes');
    const codeColumn = db.prepare('PRAGMA table_info(votes)').all().find(row => row.name === 'code_id');
    const needsVoteMigration = !voteColumns.has('user_id') || (codeColumn && Number(codeColumn.notnull) === 1);

    if (needsVoteMigration) {
      const countBefore = Number(db.prepare('SELECT COUNT(*) AS c FROM votes').get().c);
      db.exec('ALTER TABLE votes RENAME TO votes_legacy');
      db.exec(`
        CREATE TABLE votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
          choice_id INTEGER NOT NULL REFERENCES choices(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          code_id INTEGER REFERENCES codes(id),
          created_at TEXT NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO votes (id, poll_id, choice_id, user_id, code_id, created_at)
        SELECT id, poll_id, choice_id, NULL, code_id, created_at FROM votes_legacy
      `);
      const countAfter = Number(db.prepare('SELECT COUNT(*) AS c FROM votes').get().c);
      if (countBefore !== countAfter) {
        throw new Error('Η μετεγκατάσταση των ψήφων δεν ολοκληρώθηκε με ασφάλεια.');
      }
      db.exec('DROP TABLE votes_legacy');
    }

    if (wasLegacySchema) {
      const legacyAdmin = db.prepare("SELECT id, pass_hash FROM users WHERE username_key = 'admin'").get();
      if (legacyAdmin && verifyPassword('admin123', legacyAdmin.pass_hash)) {
        const lockedPassword = crypto.randomBytes(32).toString('hex');
        db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?')
          .run(hashPassword(lockedPassword), legacyAdmin.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(legacyAdmin.id);
      }
    }

    db.prepare(`
      UPDATE users
      SET role = 'user'
      WHERE role IS NULL OR role NOT IN ('user', 'manager', 'owner')
    `).run();
    db.prepare(`
      UPDATE users
      SET is_admin = CASE WHEN role IN ('manager', 'owner') THEN 1 ELSE 0 END
    `).run();

    const cancelledAt = new Date().toISOString();
    const cancelRemovedPoll = db.prepare(`
      UPDATE polls
      SET status = 'cancelled',
          cancelled_at = COALESCE(cancelled_at, ?),
          closed_at = COALESCE(closed_at, ?)
      WHERE question = ?
    `);
    for (const question of REMOVED_POLL_QUESTIONS) {
      cancelRemovedPoll.run(cancelledAt, cancelledAt, question);
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_key ON users(username_key);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner ON users(role) WHERE role = 'owner';
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_suggestions_public ON suggestions(is_public);
      CREATE INDEX IF NOT EXISTS idx_suggestions_public_created ON suggestions(created_at DESC, id DESC) WHERE is_public = 1;
      CREATE INDEX IF NOT EXISTS idx_suggestion_likes_suggestion ON suggestion_likes(suggestion_id);
      CREATE INDEX IF NOT EXISTS idx_events_upcoming ON events(event_date, event_time) WHERE cancelled_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_polls_visible_created ON polls(created_at DESC, id DESC) WHERE cancelled_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes(poll_id);
      CREATE INDEX IF NOT EXISTS idx_votes_choice ON votes(choice_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_poll_user ON votes(poll_id, user_id) WHERE user_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_poll_code ON votes(poll_id, code_id) WHERE code_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_choices_poll ON choices(poll_id);
    `);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

migrate();

module.exports = { db, SUGGESTION_CATEGORIES };
