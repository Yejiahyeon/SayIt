'use strict';
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const IS_VERCEL = Boolean(process.env.VERCEL);
const IS_CLOUD = Boolean(process.env.DATABASE_URL) || IS_VERCEL;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

if (!IS_CLOUD) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

module.exports = { ROOT, DATA_DIR, UPLOAD_DIR, IS_VERCEL, IS_CLOUD };
