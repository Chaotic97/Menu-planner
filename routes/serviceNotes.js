const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

const VALID_SHIFTS = ['all', 'am', 'lunch', 'pm', 'prep'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/service-notes?date=YYYY-MM-DD&month=YYYY-MM
router.get('/', (req, res) => {
  const db = getDb();
  const { date, month } = req.query;

  let notes;
  if (date) {
    notes = db.prepare('SELECT * FROM service_notes WHERE date = ? ORDER BY shift, created_at DESC').all(date);
  } else if (month) {
    notes = db.prepare("SELECT * FROM service_notes WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC, shift, created_at DESC").all(month);
  } else {
    // Return last 30 days
    notes = db.prepare("SELECT * FROM service_notes WHERE date >= date('now', '-30 days') ORDER BY date DESC, shift, created_at DESC").all();
  }

  res.json(notes);
});

// GET /api/service-notes/dates?month=YYYY-MM — returns just dates that have notes
router.get('/dates', (req, res) => {
  const db = getDb();
  const { month } = req.query;
  let rows;
  if (month) {
    rows = db.prepare("SELECT DISTINCT date FROM service_notes WHERE strftime('%Y-%m', date) = ? ORDER BY date").all(month);
  } else {
    rows = db.prepare("SELECT DISTINCT date FROM service_notes ORDER BY date DESC LIMIT 60").all();
  }
  res.json(rows.map(r => r.date));
});

// POST /api/service-notes
router.post('/', (req, res) => {
  const db = getDb();
  const { date, shift, title, content } = req.body;

  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!DATE_REGEX.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });
  if (shift && !VALID_SHIFTS.includes(shift)) return res.status(400).json({ error: `shift must be one of: ${VALID_SHIFTS.join(', ')}` });
  if (!content && !title) return res.status(400).json({ error: 'title or content is required' });

  const result = db.prepare(
    'INSERT INTO service_notes (date, shift, title, content) VALUES (?, ?, ?, ?)'
  ).run(date, shift || 'all', title || '', content || '');

  req.broadcast('service_note_created', { id: result.lastInsertRowid, date }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/service-notes/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { date, shift, title, content } = req.body;

  if (date !== undefined && !DATE_REGEX.test(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD format' });
  if (shift !== undefined && !VALID_SHIFTS.includes(shift)) return res.status(400).json({ error: `shift must be one of: ${VALID_SHIFTS.join(', ')}` });

  const updates = [];
  const params = [];
  if (date !== undefined) { updates.push('date = ?'); params.push(date); }
  if (shift !== undefined) { updates.push('shift = ?'); params.push(shift); }
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (content !== undefined) { updates.push('content = ?'); params.push(content); }
  updates.push("updated_at = datetime('now')");

  if (updates.length === 1) return res.status(400).json({ error: 'Nothing to update' });

  params.push(req.params.id);
  db.prepare(`UPDATE service_notes SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  req.broadcast('service_note_updated', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/service-notes/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM service_notes WHERE id = ?').run(req.params.id);
  req.broadcast('service_note_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

module.exports = router;
