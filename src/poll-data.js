'use strict';
const { db } = require('./db');

async function getPollResults(pollId) {
  const rows = await db.prepare(`
    SELECT ch.id AS id, ch.text AS text, ch.image_path AS image_path, COUNT(v.id) AS count
    FROM choices ch
    LEFT JOIN votes v ON v.choice_id = ch.id
    WHERE ch.poll_id = ?
    GROUP BY ch.id, ch.text, ch.image_path, ch.position
    ORDER BY ch.position ASC, ch.id ASC
  `).all(pollId);
  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);
  return {
    total,
    rows: rows.map(r => ({
      id: Number(r.id),
      text: r.text,
      image_path: r.image_path,
      count: Number(r.count)
    }))
  };
}

async function getPoll(id) {
  if (!Number.isInteger(id) || id <= 0) return null;
  return await db.prepare('SELECT * FROM polls WHERE id = ?').get(id) || null;
}

async function getChoices(pollId) {
  return await db.prepare('SELECT * FROM choices WHERE poll_id = ? ORDER BY position ASC, id ASC').all(pollId);
}

module.exports = { getPollResults, getPoll, getChoices };
