'use strict';
const express = require('express');
const { db, SUGGESTION_CATEGORIES } = require('./db');
const views = require('./views');
const { formatPercent, todayISO, formatDateTime, safeNextPath, pageState } = require('./utils');
const auth = require('./auth');
const { getPollResults, getPoll, getChoices } = require('./poll-data');

const router = express.Router();

async function openPollCount() {
  const row = await db.prepare(
    "SELECT COUNT(*) AS c FROM polls WHERE status = 'open' AND cancelled_at IS NULL"
  ).get();
  return Number(row.c);
}

function isCancelledPoll(poll) {
  return !!poll && (poll.status === 'cancelled' || !!poll.cancelled_at);
}

router.get('/', async (req, res) => {
  if (!req.user) {
    return res.send(views.entryPage({
      next: safeNextPath(req.query.next),
      focus: 'login'
    }));
  }
  res.send(views.home({
    user: req.user,
    openCount: await openPollCount(),
    flash: req.query.m
  }));
});

router.use(auth.requireAuth);

router.get('/protasi', (req, res) => {
  res.send(views.suggestPage({ user: req.user }));
});

router.post('/protasi', async (req, res) => {
  const category = String(req.body.category || '').trim();
  const title = String(req.body.title || '').trim();
  const description = String(req.body.description || '').trim();
  const errors = [];

  if (!SUGGESTION_CATEGORIES.includes(category)) {
    errors.push('Παρακαλώ επιλέξτε κατηγορία.');
  }
  if (title.length < 3 || title.length > 120) {
    errors.push('Ο τίτλος πρέπει να έχει από 3 έως 120 χαρακτήρες.');
  }
  if (description.length < 10 || description.length > 2000) {
    errors.push('Η περιγραφή πρέπει να έχει από 10 έως 2000 χαρακτήρες.');
  }

  if (errors.length) {
    return res.status(400).send(views.suggestPage({
      user: req.user,
      values: { category, title, description },
      errors
    }));
  }

  await db.prepare(`
    INSERT INTO suggestions (category, title, description, is_public, created_at)
    VALUES (?, ?, ?, 1, ?)
  `).run(category, title, description, new Date().toISOString());
  res.send(views.suggestSuccess({ user: req.user }));
});

router.get('/protaseis', async (req, res) => {
  const userId = req.user ? req.user.id : 0;
  const totalRow = await db.prepare('SELECT COUNT(*) AS c FROM suggestions WHERE is_public = 1').get();
  const pager = pageState(req.query.page, totalRow.c);
  const suggestions = await db.prepare(`
    SELECT s.*,
      COUNT(l.user_id) AS like_count,
      MAX(CASE WHEN l.user_id = ? THEN 1 ELSE 0 END) AS liked
    FROM suggestions s
    LEFT JOIN suggestion_likes l ON l.suggestion_id = s.id
    WHERE s.is_public = 1
    GROUP BY s.id, s.category, s.title, s.description, s.is_public, s.created_at
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ? OFFSET ?
  `).all(userId, pager.pageSize, pager.offset);
  res.send(views.suggestionBoardPage({ user: req.user, suggestions, pager }));
});

router.post('/protaseis/:id/mou-aresei', async (req, res) => {
  const id = Number(req.params.id);
  const suggestion = await db.prepare('SELECT id FROM suggestions WHERE id = ? AND is_public = 1').get(id);
  if (!suggestion) {
    return res.status(404).send(views.notFoundPage({ user: req.user }));
  }

  const removed = await db.prepare('DELETE FROM suggestion_likes WHERE suggestion_id = ? AND user_id = ?')
    .run(id, req.user.id);
  if (Number(removed.changes) === 0) {
    await db.prepare(`
      INSERT OR IGNORE INTO suggestion_likes (suggestion_id, user_id, created_at)
      VALUES (?, ?, ?)
    `).run(id, req.user.id, new Date().toISOString());
  }
  res.redirect('/protaseis#protasi-' + id);
});

router.get('/ekdiloseis', async (req, res) => {
  const today = todayISO();
  const totalRow = await db.prepare(
    'SELECT COUNT(*) AS c FROM events WHERE event_date >= ? AND cancelled_at IS NULL'
  ).get(today);
  const pager = pageState(req.query.page, totalRow.c);
  const events = await db.prepare(
    `SELECT * FROM events
     WHERE event_date >= ? AND cancelled_at IS NULL
     ORDER BY event_date ASC, event_time ASC, id ASC
     LIMIT ? OFFSET ?`
  ).all(today, pager.pageSize, pager.offset);
  res.send(views.eventsPage({ user: req.user, events, pager }));
});

router.get('/psifos', async (req, res) => {
  const totalRow = await db.prepare(
    "SELECT COUNT(*) AS c FROM polls WHERE status = 'open' AND cancelled_at IS NULL"
  ).get();
  const pager = pageState(req.query.page, totalRow.c);
  const polls = await db.prepare(
    `SELECT * FROM polls
     WHERE status = 'open' AND cancelled_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`
  ).all(pager.pageSize, pager.offset);
  res.send(views.voteListPage({ user: req.user, polls, pager }));
});

router.get('/psifos/:id', auth.requireAuth, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll || isCancelledPoll(poll)) {
    return res.status(404).send(views.notFoundPage({ user: req.user }));
  }
  const voted = !!await db.prepare('SELECT id FROM votes WHERE poll_id = ? AND user_id = ?')
    .get(poll.id, req.user.id);

  if (voted) {
    return res.send(views.pollResultsPage({
      user: req.user,
      poll,
      results: await getPollResults(poll.id),
      justVoted: req.query.ok === '1'
    }));
  }

  if (poll.status !== 'open') {
    return res.send(views.pollVotePage({
      user: req.user,
      poll,
      choices: [],
      pollClosed: true
    }));
  }

  res.send(views.pollVotePage({
    user: req.user,
    poll,
    choices: await getChoices(poll.id)
  }));
});

router.post('/psifos/:id', auth.requireAuth, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll || isCancelledPoll(poll)) {
    return res.status(404).send(views.notFoundPage({ user: req.user }));
  }
  const choices = await getChoices(poll.id);
  const choiceId = Number(req.body.choice);
  const errors = [];

  if (poll.status !== 'open') {
    return res.status(400).send(views.pollVotePage({
      user: req.user,
      poll,
      choices: [],
      pollClosed: true,
      errors: ['Η ψηφοφορία έχει κλείσει και δεν δέχεται ψήφους.']
    }));
  }

  const existing = await db.prepare('SELECT id FROM votes WHERE poll_id = ? AND user_id = ?')
    .get(poll.id, req.user.id);
  if (existing) {
    return res.redirect('/psifos/' + poll.id);
  }

  const choice = choices.find(c => Number(c.id) === choiceId);
  if (!choice) {
    errors.push('Παρακαλώ επιλέξτε μία από τις διαθέσιμες επιλογές.');
  }

  if (errors.length) {
    return res.status(400).send(views.pollVotePage({
      user: req.user,
      poll,
      choices,
      errors,
      values: { choice: choiceId }
    }));
  }

  try {
    await db.prepare(`
      INSERT INTO votes (poll_id, choice_id, user_id, code_id, created_at)
      VALUES (?, ?, ?, NULL, ?)
    `).run(poll.id, choice.id, req.user.id, new Date().toISOString());
  } catch (error) {
    if (auth.isUniqueError(error)) {
      return res.redirect('/psifos/' + poll.id);
    }
    throw error;
  }

  res.redirect('/psifos/' + poll.id + '?ok=1');
});

router.get('/psifos/:id/apotelesmata.json', auth.requireAuth, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll || isCancelledPoll(poll)) {
    return res.status(404).json({ error: 'Η ψηφοφορία δεν βρέθηκε.' });
  }
  const voted = !!await db.prepare('SELECT id FROM votes WHERE poll_id = ? AND user_id = ?')
    .get(poll.id, req.user.id);
  if (!voted) {
    return res.status(403).json({ error: 'Δεν έχετε πρόσβαση στα αποτελέσματα.' });
  }
  const results = await getPollResults(poll.id);
  res.json({
    total: results.total,
    time: formatDateTime(new Date().toISOString()),
    choices: results.rows.map(r => ({
      id: r.id,
      count: r.count,
      percent: formatPercent(r.count, results.total),
      bar: results.total ? Math.round(r.count / results.total * 1000) / 10 : 0
    }))
  });
});

module.exports = router;
