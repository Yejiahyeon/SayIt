'use strict';
const crypto = require('node:crypto');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const greekDateFmt = new Intl.DateTimeFormat('el-GR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Athens'
});

const greekDateTimeFmt = new Intl.DateTimeFormat('el-GR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Athens'
});

const greekTimeFmt = new Intl.DateTimeFormat('el-GR', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC'
});

function formatDate(isoDate) {
  const d = new Date(String(isoDate) + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return String(isoDate);
  return greekDateFmt.format(d);
}

function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return greekDateTimeFmt.format(d);
}

function formatTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const hours = String(Math.min(23, Number(m[1]))).padStart(2, '0');
  const minutes = String(Math.min(59, Number(m[2]))).padStart(2, '0');
  const d = new Date(Date.UTC(2020, 0, 1, Number(hours), Number(minutes)));
  return greekTimeFmt.format(d);
}

function todayISO() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function formatPercent(part, total) {
  if (!total) return '0%';
  return (part / total * 100).toLocaleString('el-GR', { maximumFractionDigits: 1 }) + '%';
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const b of bytes) out += CODE_ALPHABET[b % 32];
  return out;
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatCode(code) {
  const s = String(code || '');
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : s;
}

function cookieParser(req, res, next) {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    for (const pair of header.split(';')) {
      const i = pair.indexOf('=');
      if (i > -1) {
        const key = pair.slice(0, i).trim();
        const raw = pair.slice(i + 1).trim();
        try {
          req.cookies[key] = decodeURIComponent(raw);
        } catch {
          req.cookies[key] = raw;
        }
      }
    }
  }
  next();
}

function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function normalizeUsernameKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('el-GR');
}

const RESERVED_USERNAME_KEYS = new Set([normalizeUsernameKey('Linda W')]);

function isReservedNickname(value) {
  return RESERVED_USERNAME_KEYS.has(normalizeUsernameKey(value));
}

function validateNickname(value) {
  const username = String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/^[\p{L}\p{N}._ -]{3,30}$/u.test(username)) {
    return {
      username,
      error: 'Το όνομα χρήστη πρέπει να έχει 3–30 χαρακτήρες και να περιέχει μόνο γράμματα, αριθμούς, κενά, τελείες, παύλες ή κάτω παύλες.'
    };
  }
  return { username, error: null };
}

function safeNextPath(value) {
  const target = String(value ?? '');
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return '/';
  return target;
}

const PAGE_SIZE = 20;

function pageState(value, total, pageSize = PAGE_SIZE) {
  const totalCount = Math.max(0, Number(total) || 0);
  const pages = Math.max(1, Math.ceil(totalCount / pageSize));
  const requested = Number.parseInt(String(value ?? ''), 10);
  const page = Number.isInteger(requested) && requested > 0 ? Math.min(requested, pages) : 1;
  return {
    page,
    pages,
    pageSize,
    total: totalCount,
    offset: (page - 1) * pageSize
  };
}

module.exports = {
  escapeHtml,
  formatDate,
  formatDateTime,
  formatTime,
  todayISO,
  formatPercent,
  generateCode,
  normalizeCode,
  formatCode,
  cookieParser,
  isPositiveInt,
  normalizeUsernameKey,
  validateNickname,
  isReservedNickname,
  safeNextPath,
  pageState,
  PAGE_SIZE
};
