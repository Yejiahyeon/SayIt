'use strict';
const crypto = require('node:crypto');
const { db } = require('./db');
const { hashPassword, verifyPassword } = require('./passwords');
const { normalizeUsernameKey, safeNextPath } = require('./utils');

const SESSION_COOKIE = 'pt_session';
const SESSION_DAYS = 7;

const DUMMY_HASH = hashPassword(crypto.randomBytes(24).toString('hex'));

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_USER_MAX = 8;
const LOGIN_USER_IP_MAX = 6;
const LOGIN_IP_MAX = 50;

function isUniqueError(error) {
  return error && (error.code === '23505' || String(error.message).includes('UNIQUE'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now.toISOString(), expires.toISOString());
  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000 };
}

async function destroySession(token) {
  if (token) await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

async function destroyUserSessions(userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

async function cleanupSessions() {
  const now = new Date().toISOString();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  await db.prepare('DELETE FROM login_attempts WHERE reset_at <= ?').run(now);
}

async function isOwnerAccount(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return false;
  const row = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'owner'").get(id);
  return Boolean(row);
}

async function attachUser(req, res, next) {
  req.user = null;
  const token = req.cookies[SESSION_COOKIE];
  if (token) {
    const row = await db.prepare(`
      SELECT u.id, u.username, u.role, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token);
    if (row && row.expires_at > new Date().toISOString()) {
      const role = row.role === 'owner' || row.role === 'manager' ? row.role : 'user';
      const isOwner = role === 'owner' && await isOwnerAccount(row.id);
      req.user = {
        id: Number(row.id),
        username: row.username,
        role,
        is_owner: isOwner,
        is_manager: !isOwner && role === 'manager',
        can_manage: isOwner || role === 'manager'
      };
      req.sessionToken = token;
    } else if (row) {
      await destroySession(token);
    }
  }
  next();
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === '1' || Boolean(process.env.VERCEL)
  };
}

function setSessionCookie(res, token, maxAge) {
  res.cookie(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const nextPath = safeNextPath(req.originalUrl || req.url || '/');
    return res.redirect('/?next=' + encodeURIComponent(nextPath));
  }
  next();
}

function requireManager(req, res, next) {
  if (!req.user) {
    const nextPath = safeNextPath(req.originalUrl || req.url || '/');
    return res.redirect('/?next=' + encodeURIComponent(nextPath));
  }
  if (!req.user.can_manage) {
    const views = require('./views');
    return res.status(403).send(views.forbiddenPage({ user: req.user }));
  }
  next();
}

async function requireOwner(req, res, next) {
  if (!req.user) {
    const nextPath = safeNextPath(req.originalUrl || req.url || '/');
    return res.redirect('/?next=' + encodeURIComponent(nextPath));
  }
  if (!await isOwnerAccount(req.user.id)) {
    const views = require('./views');
    return res.status(403).send(views.forbiddenPage({ user: req.user }));
  }
  next();
}

async function findUserByUsername(username) {
  return await db.prepare('SELECT * FROM users WHERE username_key = ?')
    .get(normalizeUsernameKey(username)) || null;
}

async function login(username, password) {
  const user = await findUserByUsername(username);
  const ok = verifyPassword(String(password ?? ''), user ? user.pass_hash : DUMMY_HASH);
  if (!user || !ok) return null;
  return user;
}

function attemptKey(scope, value) {
  return scope + ':' + value;
}

function loginKeys(ip, usernameKey) {
  return [
    [attemptKey('user', usernameKey), LOGIN_USER_MAX],
    [attemptKey('user-ip', usernameKey + '|' + ip), LOGIN_USER_IP_MAX],
    [attemptKey('ip', ip), LOGIN_IP_MAX]
  ];
}

async function loginBlocked(ip, usernameKey) {
  const now = Date.now();
  for (const [key, max] of loginKeys(ip, usernameKey)) {
    const entry = await db.prepare('SELECT count, reset_at FROM login_attempts WHERE attempt_key = ?').get(key);
    if (entry && new Date(entry.reset_at).getTime() > now && Number(entry.count) >= max) return true;
  }
  return false;
}

async function recordLoginFailure(ip, usernameKey) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString();
  const nowIso = now.toISOString();
  for (const [key] of loginKeys(ip, usernameKey)) {
    await db.prepare(`
      INSERT INTO login_attempts (attempt_key, count, reset_at) VALUES (?, 1, ?)
      ON CONFLICT(attempt_key) DO UPDATE SET
        count = CASE WHEN login_attempts.reset_at <= ? THEN 1 ELSE login_attempts.count + 1 END,
        reset_at = CASE WHEN login_attempts.reset_at <= ? THEN ? ELSE login_attempts.reset_at END
    `).run(key, resetAt, nowIso, nowIso, resetAt);
  }
}

async function clearLoginFailures(ip, usernameKey) {
  for (const [key] of loginKeys(ip, usernameKey)) {
    await db.prepare('DELETE FROM login_attempts WHERE attempt_key = ?').run(key);
  }
}

function requireSameOrigin(req, res, next) {
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const host = new URL(origin).host;
        if (host !== req.headers.host) {
          return res.status(403).send('Η αίτηση απορρίφθηκε για λόγους ασφαλείας.');
        }
      } catch {
        return res.status(403).send('Η αίτηση απορρίφθηκε για λόγους ασφαλείας.');
      }
    }
  }
  next();
}

module.exports = {
  createSession,
  destroySession,
  destroyUserSessions,
  cleanupSessions,
  attachUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireManager,
  requireOwner,
  isOwnerAccount,
  login,
  findUserByUsername,
  loginBlocked,
  recordLoginFailure,
  clearLoginFailures,
  requireSameOrigin,
  isUniqueError,
  SESSION_COOKIE
};
