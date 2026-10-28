'use strict';
const express = require('express');
const { db } = require('./db');
const views = require('./views');
const auth = require('./auth');
const { hashPassword, verifyPassword } = require('./passwords');
const { normalizeUsernameKey, validateNickname, isReservedNickname, safeNextPath } = require('./utils');

const router = express.Router();

function loginTarget(user, requested) {
  const next = safeNextPath(requested);
  const isManagementPath = next === '/symvoulio' || next.startsWith('/symvoulio/');
  const toolHome = '/symvoulio/ekdiloseis';
  if (isManagementPath) {
    if (!user.can_manage) return '/';
    if (next === '/symvoulio' || next === '/symvoulio/') return user.is_owner ? '/symvoulio' : toolHome;
    if (next.startsWith('/symvoulio/prosvasi') && !user.is_owner) return toolHome;
    return next;
  }
  if (next !== '/') return next;
  return user.is_owner ? '/symvoulio' : user.can_manage ? toolHome : '/';
}

function renderEntry(req, res, options = {}) {
  res.status(options.status || 200).send(views.entryPage({
    loginError: options.loginError || '',
    next: safeNextPath(options.next || req.query.next || '/'),
    registerErrors: options.registerErrors || [],
    focus: options.focus || 'login'
  }));
}

router.get(['/syndesi', '/symvoulio/syndesi'], (req, res) => {
  if (req.user) return res.redirect('/');
  renderEntry(req, res, {
    next: req.query.next,
    focus: 'login'
  });
});

router.post(['/syndesi', '/symvoulio/syndesi'], async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const usernameKey = normalizeUsernameKey(username);
  const next = safeNextPath(req.body.next || '/');
  const ip = req.ip || 'unknown';

  if (await auth.loginBlocked(ip, usernameKey)) {
    return renderEntry(req, res, {
      status: 429,
      next,
      loginError: 'Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά σε λίγα λεπτά.'
    });
  }

  if (!usernameKey || username.length > 30 || password.length > 200) {
    await auth.recordLoginFailure(ip, usernameKey);
    return renderEntry(req, res, {
      status: 401,
      next,
      loginError: 'Λάθος όνομα χρήστη ή κωδικός πρόσβασης.'
    });
  }

  const user = await auth.login(username, password);
  if (!user) {
    await auth.recordLoginFailure(ip, usernameKey);
    return renderEntry(req, res, {
      status: 401,
      next,
      loginError: 'Λάθος όνομα χρήστη ή κωδικός πρόσβασης.'
    });
  }

  await auth.clearLoginFailures(ip, usernameKey);
  const session = await auth.createSession(user.id);
  auth.setSessionCookie(res, session.token, session.maxAge);
  res.redirect(loginTarget({
    can_manage: user.role === 'owner' || user.role === 'manager',
    is_owner: user.role === 'owner'
  }, next));
});

router.get('/eggrafi', (req, res) => {
  if (req.user) return res.redirect('/');
  renderEntry(req, res, {
    next: req.query.next,
    focus: 'register'
  });
});

router.post('/eggrafi', async (req, res) => {
  const { username, error: usernameError } = validateNickname(req.body.username);
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');
  const errors = [];

  if (usernameError) errors.push(usernameError);
  if (password.length < 8 || password.length > 128) {
    errors.push('Ο κωδικός πρόσβασης πρέπει να έχει από 8 έως 128 χαρακτήρες.');
  }
  if (password !== confirm) {
    errors.push('Οι δύο κωδικοί πρόσβασης δεν ταιριάζουν.');
  }

  const usernameKey = normalizeUsernameKey(username);
  if (!usernameError && isReservedNickname(username)) {
    errors.push('Το όνομα χρήστη δεν είναι διαθέσιμο.');
  } else if (!usernameError && await db.prepare('SELECT id FROM users WHERE username_key = ?').get(usernameKey)) {
    errors.push('Το όνομα χρήστη χρησιμοποιείται ήδη.');
  }

  if (errors.length) {
    return renderEntry(req, res, {
      status: 400,
      next: req.query.next,
      registerErrors: errors,
      focus: 'register'
    });
  }

  let userId;
  try {
    const info = await db.prepare(`
      INSERT INTO users (username, username_key, pass_hash, role, is_admin, created_at)
      VALUES (?, ?, ?, 'user', 0, ?)
    `).run(username, usernameKey, hashPassword(password), new Date().toISOString());
    userId = Number(info.lastInsertRowid);
  } catch (error) {
    if (auth.isUniqueError(error)) {
      return renderEntry(req, res, {
        status: 400,
        next: req.query.next,
        registerErrors: ['Το όνομα χρήστη δεν είναι διαθέσιμο.'],
        focus: 'register'
      });
    }
    throw error;
  }

  const session = await auth.createSession(userId);
  auth.setSessionCookie(res, session.token, session.maxAge);
  res.redirect('/?m=eggrafi');
});

router.post(['/aposyndesi', '/symvoulio/aposyndesi'], async (req, res) => {
  await auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.redirect('/');
});

router.get('/logariasmos', auth.requireAuth, (req, res) => {
  res.send(views.accountPage({
    user: req.user,
    flash: req.query.m
  }));
});

router.get('/symvoulio/profil', auth.requireAuth, (req, res) => {
  res.redirect('/logariasmos');
});

router.post('/logariasmos/kodikos', auth.requireAuth, async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  const confirm = String(req.body.confirm || '');
  const errors = [];

  const me = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!me || !verifyPassword(current, me.pass_hash)) {
    errors.push('Ο τρέχων κωδικός πρόσβασης δεν είναι σωστός.');
  }
  if (next.length < 8 || next.length > 128) {
    errors.push('Ο νέος κωδικός πρόσβασης πρέπει να έχει από 8 έως 128 χαρακτήρες.');
  }
  if (next !== confirm) {
    errors.push('Οι δύο νέοι κωδικοί πρόσβασης δεν ταιριάζουν.');
  }

  if (errors.length) {
    return res.status(400).send(views.accountPage({
      user: req.user,
      errors
    }));
  }

  await db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  await auth.destroyUserSessions(req.user.id);
  const session = await auth.createSession(req.user.id);
  auth.setSessionCookie(res, session.token, session.maxAge);
  res.redirect('/logariasmos?m=kodikos');
});

module.exports = router;
