const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');
const { createRateLimit } = require('../middleware/rateLimit');
const { processPhoto, parseSheet, executeActions } = require('../services/chefsheetService');

const router = express.Router();

const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads');

// Multer config: memory storage, 15MB limit, image filter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|heic/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = /image\/(jpeg|jpg|png|webp|heic|heif)/.test(file.mimetype);
    cb(null, ext || mime);
  },
});

const uploadRateLimit = createRateLimit({ windowMs: 60000, max: 10 });

// POST /upload — process photo, parse with Claude Vision
router.post('/upload', uploadRateLimit, upload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }

  const db = getDb();
  const sheetDate = req.body.date || new Date().toISOString().slice(0, 10);

  // Process and save photo
  const filename = await processPhoto(req.file.buffer);
  const photoPath = `/uploads/${filename}`;

  // Create chefsheet record
  const result = db.prepare(
    'INSERT INTO chefsheets (photo_path, sheet_date, status) VALUES (?, ?, ?)'
  ).run(photoPath, sheetDate, 'pending');
  const chefsheetId = result.lastInsertRowid;

  try {
    // Parse with Claude Vision
    const parseResult = await parseSheet(filename);

    // Update record with parse results
    db.prepare(
      'UPDATE chefsheets SET status = ?, raw_parse = ?, model = ?, tokens_in = ?, tokens_out = ? WHERE id = ?'
    ).run('parsed', JSON.stringify(parseResult.actions), parseResult.model, parseResult.tokensIn, parseResult.tokensOut, chefsheetId);

    const chefsheet = db.prepare('SELECT * FROM chefsheets WHERE id = ?').get(chefsheetId);
    chefsheet.raw_parse = JSON.parse(chefsheet.raw_parse);

    req.broadcast('chefsheet_parsed', chefsheet);
    res.status(201).json(chefsheet);
  } catch (err) {
    db.prepare('UPDATE chefsheets SET status = ? WHERE id = ?').run('failed', chefsheetId);
    console.error('ChefSheet parse error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse ChefSheet' });
  }
}));

// GET /:id — get chefsheet with parsed/confirmed actions
router.get('/:id', (req, res) => {
  const db = getDb();
  const sheet = db.prepare('SELECT * FROM chefsheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'ChefSheet not found' });

  if (sheet.raw_parse) sheet.raw_parse = JSON.parse(sheet.raw_parse);
  if (sheet.confirmed_actions) sheet.confirmed_actions = JSON.parse(sheet.confirmed_actions);
  if (sheet.execution_log) sheet.execution_log = JSON.parse(sheet.execution_log);

  res.json(sheet);
});

// PUT /:id/actions — save user-edited actions
router.put('/:id/actions', (req, res) => {
  const db = getDb();
  const sheet = db.prepare('SELECT * FROM chefsheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'ChefSheet not found' });
  if (sheet.status !== 'parsed') return res.status(400).json({ error: 'ChefSheet is not in parsed state' });

  const { actions } = req.body;
  if (!Array.isArray(actions)) return res.status(400).json({ error: 'actions must be an array' });

  db.prepare('UPDATE chefsheets SET raw_parse = ? WHERE id = ?').run(JSON.stringify(actions), req.params.id);
  res.json({ ok: true });
});

// POST /:id/confirm — execute confirmed actions
router.post('/:id/confirm', (req, res) => {
  const db = getDb();
  const sheet = db.prepare('SELECT * FROM chefsheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'ChefSheet not found' });
  if (sheet.status !== 'parsed') return res.status(400).json({ error: 'ChefSheet is not in parsed state' });

  const actions = JSON.parse(sheet.raw_parse || '[]');
  const broadcastFn = (type, payload) => req.broadcast(type, payload, req.headers['x-client-id']);
  const { results, summary } = executeActions(sheet.id, actions, broadcastFn);

  db.prepare(
    'UPDATE chefsheets SET status = ?, confirmed_actions = ?, execution_log = ? WHERE id = ?'
  ).run('confirmed', sheet.raw_parse, JSON.stringify(results), sheet.id);

  req.broadcast('chefsheet_confirmed', { id: sheet.id, summary }, req.headers['x-client-id']);

  res.json({ results, summary });
});

// GET / (history) — list recent chefsheets
router.get('/', (req, res) => {
  const db = getDb();
  const sheets = db.prepare('SELECT id, photo_path, sheet_date, status, tokens_in, tokens_out, created_at FROM chefsheets ORDER BY created_at DESC LIMIT 20').all();
  res.json(sheets);
});

// DELETE /:id — delete chefsheet + photo file
router.delete('/:id', (req, res) => {
  const db = getDb();
  const sheet = db.prepare('SELECT * FROM chefsheets WHERE id = ?').get(req.params.id);
  if (!sheet) return res.status(404).json({ error: 'ChefSheet not found' });

  // Delete photo file
  if (sheet.photo_path) {
    const filePath = path.join(UPLOADS_DIR, path.basename(sheet.photo_path));
    try { fs.unlinkSync(filePath); } catch {}
  }

  db.prepare('DELETE FROM chefsheets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
