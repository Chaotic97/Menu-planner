const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');

const router = express.Router();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'menu-planner.db');

// GET /api/settings/backup — download the raw SQLite database file
router.get('/backup', (req, res) => {
  const db = getDb();
  // Export current in-memory DB (authoritative) to a buffer
  const data = db._db.export();
  const buf = Buffer.from(data);

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `platestack-backup-${timestamp}.db`;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

// POST /api/settings/restore — upload a .db backup to replace current database
router.post('/restore', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
  if (!req.body || !req.body.length) {
    return res.status(400).json({ error: 'No backup file provided' });
  }

  // Validate it's a SQLite database by checking the magic header
  const SQLITE_MAGIC = 'SQLite format 3\x00';
  const header = req.body.slice(0, 16).toString('ascii');
  if (header !== SQLITE_MAGIC) {
    return res.status(400).json({ error: 'Invalid backup file — not a valid SQLite database' });
  }

  try {
    // Write the uploaded DB to disk, replacing the existing one
    const tmpPath = DB_PATH + '.restore.tmp';
    fs.writeFileSync(tmpPath, req.body);
    fs.renameSync(tmpPath, DB_PATH);

    res.json({ success: true, message: 'Backup restored. Restart the server for changes to take effect.' });
  } catch (err) {
    console.error('Restore failed:', err);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

module.exports = router;
