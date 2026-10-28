'use strict';
const express = require('express');
const multer = require('multer');
const { db } = require('./db');
const views = require('./views');
const storage = require('./storage');
const { todayISO, pageState } = require('./utils');
const auth = require('./auth');
const { getPollResults, getPoll } = require('./poll-data');

const router = express.Router();

const IMAGE_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    cb(new Error('bad-image-type'));
  }
});

function checkUploadSize(req, res, next) {
  const length = Number(req.headers['content-length'] || 0);
  if (length > MAX_UPLOAD_BYTES) {
    return res.status(413).send(views.errorPage({
      title: 'Σφάλμα μεταφόρτωσης',
      message: 'Το σύνολο των εικόνων είναι πολύ μεγάλο. Το όριο είναι 4MB ανά αποστολή.',
      user: req.user
    }));
  }
  next();
}

async function storeUploads(req, res, next) {
  try {
    const files = [req.file, ...(req.files || [])].filter(Boolean);
    for (const file of files) {
      const saved = await storage.saveImage(file);
      file.filename = saved.name;
    }
    next();
  } catch (error) {
    next(error);
  }
}

async function removeUpload(file) {
  if (!file || !file.filename) return;
  await storage.removeImage(file.filename);
}

async function removeUploadByName(name) {
  if (!name) return;
  await storage.removeImage(name);
}

function handleUploadErrors(err, req, res, next) {
  if (!err) return next();
  const message = err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT'
    ? 'Η εικόνα είναι πολύ μεγάλη. Το όριο είναι 3MB ανά εικόνα.'
    : 'Το αρχείο δεν είναι έγκυρη εικόνα. Αποδεκτά: JPG, PNG, WEBP, GIF.';
  res.status(400).send(views.errorPage({
    title: 'Σφάλμα μεταφόρτωσης',
    message,
    user: req.user
  }));
}

router.get('/', auth.requireOwner, async (req, res) => {
  const eventCount = await db.prepare(
    'SELECT COUNT(*) AS c FROM events WHERE event_date >= ? AND cancelled_at IS NULL'
  ).get(todayISO());
  const pollCount = await db.prepare("SELECT COUNT(*) AS c FROM polls WHERE status != 'cancelled' AND cancelled_at IS NULL").get();
  const openCount = await db.prepare("SELECT COUNT(*) AS c FROM polls WHERE status = 'open' AND cancelled_at IS NULL").get();
  const counts = {
    events: Number(eventCount.c),
    polls: Number(pollCount.c),
    openPolls: Number(openCount.c)
  };
  res.send(views.dashboardPage({ user: req.user, counts, flash: req.query.m }));
});

router.get('/ekdiloseis', auth.requireManager, async (req, res) => {
  const today = todayISO();
  const totalRow = await db.prepare('SELECT COUNT(*) AS c FROM events WHERE cancelled_at IS NULL').get();
  const pager = pageState(req.query.page, totalRow.c);
  const events = await db.prepare(
    `SELECT * FROM events
     WHERE cancelled_at IS NULL
     ORDER BY (event_date >= ?) DESC, event_date ASC, event_time ASC, id ASC
     LIMIT ? OFFSET ?`
  ).all(today, pager.pageSize, pager.offset);
  res.send(views.eventsAdminPage({ user: req.user, events, pager, flash: req.query.m }));
});

router.get('/ekdiloseis/nea', auth.requireManager, async (req, res) => {
  res.send(views.eventFormPage({ user: req.user, event: {}, mode: 'new' }));
});

function validateEvent(body) {
  const title = String(body.title || '').trim();
  const event_date = String(body.event_date || '').trim();
  const event_time = String(body.event_time || '').trim();
  const location = String(body.location || '').trim();
  const description = String(body.description || '').trim();
  const errors = [];

  if (title.length < 3 || title.length > 150) {
    errors.push('Ο τίτλος πρέπει να έχει από 3 έως 150 χαρακτήρες.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event_date) || Number.isNaN(new Date(event_date + 'T00:00:00Z').getTime())) {
    errors.push('Παρακαλώ δώστε έγκυρη ημερομηνία.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event_time)) {
    errors.push('Παρακαλώ δώστε έγκυρη ώρα.');
  }
  if (location.length < 2 || location.length > 150) {
    errors.push('Η τοποθεσία πρέπει να έχει από 2 έως 150 χαρακτήρες.');
  }
  if (description.length < 3 || description.length > 2000) {
    errors.push('Η περιγραφή πρέπει να έχει από 3 έως 2000 χαρακτήρες.');
  }
  return { values: { title, event_date, event_time, location, description }, errors };
}

router.post('/ekdiloseis', auth.requireManager, checkUploadSize, upload.single('image'), handleUploadErrors, storeUploads, async (req, res) => {
  const { values, errors } = validateEvent(req.body);
  if (errors.length) {
    await removeUpload(req.file);
    return res.status(400).send(views.eventFormPage({
      user: req.user,
      event: { ...values, id: null },
      errors,
      mode: 'new'
    }));
  }
  await db.prepare(`
    INSERT INTO events (title, event_date, event_time, location, description, image_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(values.title, values.event_date, values.event_time, values.location, values.description,
    req.file ? req.file.filename : null, new Date().toISOString());
  res.redirect('/symvoulio/ekdiloseis?m=apothikeutike');
});

router.get('/ekdiloseis/:id', auth.requireManager, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η εκδήλωση δεν βρέθηκε.', user: req.user }));
  }
  res.send(views.eventDetailPage({ user: req.user, event, flash: req.query.m }));
});

router.get('/ekdiloseis/:id/epexergasia', auth.requireManager, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η εκδήλωση δεν βρέθηκε.', user: req.user }));
  }
  res.send(views.eventFormPage({ user: req.user, event, mode: 'edit' }));
});

router.post('/ekdiloseis/:id', auth.requireManager, checkUploadSize, upload.single('image'), handleUploadErrors, storeUploads, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) {
    await removeUpload(req.file);
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η εκδήλωση δεν βρέθηκε.', user: req.user }));
  }
  const { values, errors } = validateEvent(req.body);
  if (errors.length) {
    await removeUpload(req.file);
    return res.status(400).send(views.eventFormPage({
      user: req.user,
      event: { ...event, ...values },
      errors,
      mode: 'edit'
    }));
  }
  let imagePath = event.image_path;
  if (req.file) {
    if (event.image_path) await removeUploadByName(event.image_path);
    imagePath = req.file.filename;
  } else if (req.body.remove_image === '1' && event.image_path) {
    await removeUploadByName(event.image_path);
    imagePath = null;
  }
  await db.prepare(`
    UPDATE events SET title = ?, event_date = ?, event_time = ?, location = ?, description = ?, image_path = ?
    WHERE id = ?
  `).run(values.title, values.event_date, values.event_time, values.location, values.description, imagePath, event.id);
  res.redirect('/symvoulio/ekdiloseis?m=apothikeutike');
});

router.post('/ekdiloseis/:id/akyrosi', auth.requireOwner, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (!event) {
    return res.status(404).send(views.errorPage({
      title: 'Δεν βρέθηκε',
      message: 'Η εκδήλωση δεν βρέθηκε.',
      user: req.user
    }));
  }
  if (!event.cancelled_at) {
    await db.prepare('UPDATE events SET cancelled_at = ? WHERE id = ? AND cancelled_at IS NULL')
      .run(new Date().toISOString(), event.id);
  }
  res.redirect('/symvoulio/ekdiloseis?m=akyrosi_ekdilosis');
});

router.post('/ekdiloseis/:id/diagrafi', auth.requireManager, async (req, res) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').get(Number(req.params.id));
  if (event) {
    if (event.image_path) await removeUploadByName(event.image_path);
    await db.prepare('DELETE FROM events WHERE id = ?').run(event.id);
  }
  res.redirect('/symvoulio/ekdiloseis?m=diagrafike');
});

router.get('/psifismata', auth.requireManager, async (req, res) => {
  const totalRow = await db.prepare(
    "SELECT COUNT(*) AS c FROM polls WHERE status != 'cancelled' AND cancelled_at IS NULL"
  ).get();
  const pager = pageState(req.query.page, totalRow.c);
  const polls = await db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM choices ch WHERE ch.poll_id = p.id) AS choices_count,
      (SELECT COUNT(*) FROM votes v WHERE v.poll_id = p.id) AS votes_count
    FROM polls p
    WHERE p.status != 'cancelled' AND p.cancelled_at IS NULL
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `).all(pager.pageSize, pager.offset);
  res.send(views.pollsAdminPage({ user: req.user, polls, pager, flash: req.query.m }));
});

router.get('/psifismata/nea', auth.requireManager, async (req, res) => {
  res.send(views.pollFormPage({ user: req.user }));
});

function collectChoiceInputs(req) {
  const texts = {};
  for (const key of Object.keys(req.body)) {
    const m = /^choice_text_(\d+)$/.exec(key);
    if (m) texts[m[1]] = String(req.body[key] || '').trim();
  }
  const files = {};
  for (const f of req.files || []) {
    const m = /^choice_image_(\d+)$/.exec(f.fieldname);
    if (m) files[m[1]] = f;
  }
  const indexes = [...new Set([...Object.keys(texts), ...Object.keys(files)])]
    .map(Number)
    .sort((a, b) => a - b);
  return indexes.map(i => ({ index: i, text: texts[i] || '', file: files[i] || null }));
}

router.post('/psifismata', auth.requireManager, checkUploadSize, upload.any(), handleUploadErrors, storeUploads, async (req, res) => {
  const question = String(req.body.question || '').trim();
  const rows = collectChoiceInputs(req);
  const errors = [];

  if (question.length < 3 || question.length > 300) {
    errors.push('Η ερώτηση πρέπει να έχει από 3 έως 300 χαρακτήρες.');
  }

  const filled = rows.filter(r => r.text.length > 0 || r.file);
  if (filled.length < 2) {
    errors.push('Χρειάζονται τουλάχιστον 2 επιλογές.');
  }
  if (filled.length > 10) {
    errors.push('Το πολύ 10 επιλογές.');
  }
  if (filled.some(r => r.text.length > 150)) {
    errors.push('Το κείμενο της επιλογής δεν μπορεί να ξεπερνά τους 150 χαρακτήρες.');
  }

  if (errors.length) {
    for (const r of rows) await removeUpload(r.file);
    return res.status(400).send(views.pollFormPage({
      user: req.user,
      errors,
      values: {
        question,
        choice_texts: rows.map(r => r.text)
      }
    }));
  }

  const pollInfo = await db.prepare('INSERT INTO polls (question, status, created_at) VALUES (?, ?, ?)')
    .run(question, 'closed', new Date().toISOString());
  const pollId = Number(pollInfo.lastInsertRowid);
  const insertChoice = await db.prepare('INSERT INTO choices (poll_id, text, image_path, position) VALUES (?, ?, ?, ?)');
  let position = 0;
  for (const r of filled) {
    await insertChoice.run(pollId, r.text || null, r.file ? r.file.filename : null, position++);
  }
  res.redirect('/symvoulio/psifismata/' + pollId + '?m=dimiourgithike');
});

router.get('/psifismata/:id', auth.requireManager, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η ψηφοφορία δεν βρέθηκε.', user: req.user }));
  }
  const results = await getPollResults(poll.id);
  res.send(views.pollAdminPage({ user: req.user, poll, results, flash: req.query.m }));
});

router.post('/psifismata/:id/akyrosi', auth.requireOwner, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η ψηφοφορία δεν βρέθηκε.', user: req.user }));
  }
  if (poll.status !== 'cancelled') {
    const now = new Date().toISOString();
    await db.prepare("UPDATE polls SET status = 'cancelled', cancelled_at = ?, closed_at = COALESCE(closed_at, ?) WHERE id = ?")
      .run(now, now, poll.id);
  }
  res.redirect('/symvoulio/psifismata?m=akyrosi_psifismatos');
});

router.post('/psifismata/:id/anoigma', auth.requireManager, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η ψηφοφορία δεν βρέθηκε.', user: req.user }));
  }
  if (poll.status === 'cancelled') {
    return res.status(400).send(views.errorPage({
      title: 'Η ψηφοφορία έχει ακυρωθεί',
      message: 'Δεν είναι δυνατό το άνοιγμα μιας ακυρωμένης ψηφοφορίας.',
      user: req.user
    }));
  }
  const choicesRow = await db.prepare('SELECT COUNT(*) AS c FROM choices WHERE poll_id = ?').get(poll.id);
  const choices = Number(choicesRow.c);
  if (choices < 2) {
    return res.status(400).send(views.errorPage({
      title: 'Δεν είναι δυνατό το άνοιγμα',
      message: 'Η ψηφοφορία χρειάζεται τουλάχιστον 2 επιλογές για να ανοίξει.',
      user: req.user
    }));
  }
  await db.prepare("UPDATE polls SET status = 'open', closed_at = NULL WHERE id = ?").run(poll.id);
  res.redirect('/symvoulio/psifismata/' + poll.id + '?m=anoixe');
});

router.post('/psifismata/:id/kleisimo', auth.requireManager, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (!poll) {
    return res.status(404).send(views.errorPage({ title: 'Δεν βρέθηκε', message: 'Η ψηφοφορία δεν βρέθηκε.', user: req.user }));
  }
  if (poll.status !== 'cancelled') {
    await db.prepare("UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ?")
      .run(new Date().toISOString(), poll.id);
  }
  res.redirect('/symvoulio/psifismata/' + poll.id + '?m=ekleise');
});

router.post('/psifismata/:id/diagrafi', auth.requireManager, async (req, res) => {
  const poll = await getPoll(Number(req.params.id));
  if (poll) {
    const images = await db.prepare('SELECT image_path FROM choices WHERE poll_id = ? AND image_path IS NOT NULL').all(poll.id);
    for (const img of images) await removeUploadByName(img.image_path);
    await db.prepare('DELETE FROM polls WHERE id = ?').run(poll.id);
  }
  res.redirect('/symvoulio/psifismata?m=diagrafike');
});

async function accessData(search) {
  const usersRow = await db.prepare('SELECT COUNT(*) AS c FROM users').get();
  const usersCount = Number(usersRow.c);
  const managerRows = await db.prepare(`
    SELECT id FROM users WHERE role = 'manager' ORDER BY id ASC
  `).all();
  const managers = managerRows.map(row => ({ id: Number(row.id), role: 'manager' }));
  const found = search
    ? await db.prepare('SELECT id, role FROM users WHERE username = ?').get(search) || null
    : null;
  return { usersCount, managers, found: found ? {
    id: Number(found.id),
    role: found.role
  } : null };
}

async function renderAccess(req, res, options = {}) {
  const search = String(options.search ?? '').trim();
  const data = await accessData(search);
  res.status(options.status || 200).send(views.accessPage({
    user: req.user,
    usersCount: data.usersCount,
    managers: data.managers,
    search,
    found: data.found,
    errors: options.errors || [],
    flash: options.flash
  }));
}

router.get('/prosvasi', auth.requireOwner, async (req, res) => {
  await renderAccess(req, res, { flash: req.query.m });
});

router.post('/prosvasi', auth.requireOwner, async (req, res) => {
  await renderAccess(req, res, { search: req.body.username || '' });
});

router.post('/prosvasi/parachorisi', auth.requireOwner, async (req, res) => {
  const target = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(Number(req.body.user_id));
  if (!target) {
    return await renderAccess(req, res, {
      status: 400,
      errors: ['Ο λογαριασμός δεν βρέθηκε.']
    });
  }
  if (target.role === 'owner') {
    return await renderAccess(req, res, {
      status: 400,
      errors: ['Ο λογαριασμός ιδιοκτήτη δεν μπορεί να αλλάξει από αυτή τη σελίδα.']
    });
  }
  await db.prepare("UPDATE users SET role = 'manager', is_admin = 1 WHERE id = ?").run(target.id);
  res.redirect('/symvoulio/prosvasi?m=parachorisi');
});

router.post('/prosvasi/afairesi', auth.requireOwner, async (req, res) => {
  const target = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(Number(req.body.user_id));
  if (!target) {
    return await renderAccess(req, res, {
      status: 400,
      errors: ['Ο λογαριασμός δεν βρέθηκε.']
    });
  }
  if (target.role === 'owner') {
    return await renderAccess(req, res, {
      status: 400,
      errors: ['Ο λογαριασμός ιδιοκτήτη δεν μπορεί να αλλάξει από αυτή τη σελίδα.']
    });
  }
  await db.prepare("UPDATE users SET role = 'user', is_admin = 0 WHERE id = ?").run(target.id);
  res.redirect('/symvoulio/prosvasi?m=afairesi');
});

module.exports = router;
