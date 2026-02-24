const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { sendPasswordResetEmail } = require('../services/emailService');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
const SALT_ROUNDS = 12;

function getSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
}

function setSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// GET /api/auth/status - check if setup is complete and if user is logged in
router.get('/status', asyncHandler(async (req, res) => {
  const db = await getDb();
  const passwordRow = getSetting(db, 'password_hash');
  const isSetup = !!passwordRow;
  const isAuthenticated = !!(req.session && req.session.authenticated);

  res.json({ isSetup, isAuthenticated });
}));

// POST /api/auth/setup - initial password + email setup
router.post('/setup', asyncHandler(async (req, res) => {
  const db = await getDb();
  const existing = getSetting(db, 'password_hash');

  if (existing) {
    return res.status(400).json({ error: 'Password already configured. Use change-password instead.' });
  }

  const { password, email } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid recovery email is required.' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  setSetting(db, 'password_hash', hash);
  setSetting(db, 'email', email);

  req.session.authenticated = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json({ success: true });
  });
}));

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const db = await getDb();
  const passwordRow = getSetting(db, 'password_hash');

  if (!passwordRow) {
    return res.status(400).json({ error: 'Password not set up yet.' });
  }

  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  const match = await bcrypt.compare(password, passwordRow.value);
  if (!match) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  req.session.authenticated = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json({ success: true });
  });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// POST /api/auth/forgot - send reset email
router.post('/forgot', asyncHandler(async (req, res) => {
  const db = await getDb();
  const emailRow = getSetting(db, 'email');

  if (!emailRow) {
    return res.status(400).json({ error: 'No recovery email configured.' });
  }

  const { email } = req.body;

  // Don't reveal whether the email matches, but only send if it does
  if (email && email.toLowerCase() === emailRow.value.toLowerCase()) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    setSetting(db, 'reset_token', token);
    setSetting(db, 'reset_token_expires', expires);

    try {
      await sendPasswordResetEmail(emailRow.value, token);
    } catch (err) {
      console.error('Failed to send reset email:', err.message);
      return res.status(500).json({ error: 'Failed to send reset email. Check email configuration.' });
    }
  }

  res.json({ success: true, message: 'If that email matches, a reset link has been sent.' });
}));

// POST /api/auth/reset - reset password using token
router.post('/reset', asyncHandler(async (req, res) => {
  const db = await getDb();
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const storedToken = getSetting(db, 'reset_token');
  const storedExpires = getSetting(db, 'reset_token_expires');

  if (!storedToken || !storedExpires) {
    return res.status(400).json({ error: 'No reset request found. Please request a new one.' });
  }

  if (storedToken.value !== token) {
    return res.status(400).json({ error: 'Invalid reset token.' });
  }

  if (new Date(storedExpires.value) < new Date()) {
    // Clean up expired token
    db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run('reset_token', 'reset_token_expires');
    return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  setSetting(db, 'password_hash', hash);

  // Clean up token
  db.prepare('DELETE FROM settings WHERE key = ?').run('reset_token');
  db.prepare('DELETE FROM settings WHERE key = ?').run('reset_token_expires');

  res.json({ success: true });
}));

// POST /api/auth/change-password - change password while logged in
router.post('/change-password', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const db = await getDb();
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const passwordRow = getSetting(db, 'password_hash');
  const match = await bcrypt.compare(currentPassword, passwordRow.value);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  setSetting(db, 'password_hash', hash);

  res.json({ success: true });
}));

module.exports = router;
