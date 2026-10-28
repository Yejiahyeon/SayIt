'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(ROOT, 'backups', stamp);

fs.mkdirSync(target, { recursive: true });
const dbPath = path.join(DATA_DIR, 'pes-to.db');
if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec("VACUUM INTO '" + path.join(target, 'pes-to.db').replaceAll("'", "''") + "'");
  } finally {
    db.close();
  }
}
for (const name of ['secret.key']) {
  const source = path.join(DATA_DIR, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, name));
}
if (fs.existsSync(UPLOAD_DIR)) {
  fs.cpSync(UPLOAD_DIR, path.join(target, 'uploads'), { recursive: true });
}
console.log('Backup: ' + target);
