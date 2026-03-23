const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { sendPasswordResetEmail } = require('../services/emailService');
const asyncHandler = require('../middleware/asyncHandler');
const { createRateLimit } = require('../middleware/rateLimit');
// @simplewebauthn/server is ESM-only — lazy-load via dynamic import()
let _webauthn = null;
async function getWebAuthn() {
  if (!_webauthn) {
    _webauthn = await import('@simplewebauthn/server');
  }
  return _webauthn;
}

const router = express.Router();
const SALT_ROUNDS = 12;

// WebAuthn config
const RP_NAME = 'PlateStack';
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.APP_URL === 'https://platestack.app';
const RP_ID = process.env.RP_ID || (IS_PROD ? 'platestack.app' : 'localhost');
const EXPECTED_ORIGIN = process.env.APP_URL || (IS_PROD ? 'https://platestack.app' : 'http://localhost:3000');
console.log(`[WebAuthn] RP_ID=${RP_ID}, EXPECTED_ORIGIN=${EXPECTED_ORIGIN}, NODE_ENV=${process.env.NODE_ENV}`);

// Strict limit for login/forgot/reset: 10 attempts per 15 min per IP
const authRateLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please wait 15 minutes before trying again.' });

async function getSetting(db, key) {
  return await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
}

async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run(key, value);
}

// GET /api/auth/status - check if setup is complete and if user is logged in
router.get('/status', asyncHandler(async (req, res) => {
  const db = await getDb();
  const passwordRow = await getSetting(db, 'password_hash');
  const isSetup = !!passwordRow;
  const isAuthenticated = !!(req.session && req.session.authenticated);
  const passkeyCount = await db.prepare('SELECT COUNT(*) as count FROM passkey_credentials').get();
  const hasPasskeys = passkeyCount && passkeyCount.count > 0;

  res.json({ isSetup, isAuthenticated, hasPasskeys });
}));

// POST /api/auth/setup - initial password + email setup
router.post('/setup', authRateLimit, asyncHandler(async (req, res) => {
  const db = await getDb();
  const existing = await getSetting(db, 'password_hash');

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
  await setSetting(db, 'password_hash', hash);
  await setSetting(db, 'email', email);

  req.session.authenticated = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json({ success: true });
  });
}));

// POST /api/auth/login
router.post('/login', authRateLimit, asyncHandler(async (req, res) => {
  const db = await getDb();
  const passwordRow = await getSetting(db, 'password_hash');

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
router.post('/forgot', authRateLimit, asyncHandler(async (req, res) => {
  const db = await getDb();
  const emailRow = await getSetting(db, 'email');

  if (!emailRow) {
    return res.status(400).json({ error: 'No recovery email configured.' });
  }

  const { email } = req.body;

  // Don't reveal whether the email matches, but only send if it does
  if (email && email.toLowerCase() === emailRow.value.toLowerCase()) {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await setSetting(db, 'reset_token', token);
    await setSetting(db, 'reset_token_expires', expires);

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
router.post('/reset', authRateLimit, asyncHandler(async (req, res) => {
  const db = await getDb();
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const storedToken = await getSetting(db, 'reset_token');
  const storedExpires = await getSetting(db, 'reset_token_expires');

  if (!storedToken || !storedExpires) {
    return res.status(400).json({ error: 'No reset request found. Please request a new one.' });
  }

  const tokenBuf = Buffer.from(String(token));
  const storedBuf = Buffer.from(String(storedToken.value));
  if (tokenBuf.length !== storedBuf.length || !crypto.timingSafeEqual(tokenBuf, storedBuf)) {
    return res.status(400).json({ error: 'Invalid reset token.' });
  }

  if (new Date(storedExpires.value) < new Date()) {
    // Clean up expired token
    await db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run('reset_token', 'reset_token_expires');
    return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  await setSetting(db, 'password_hash', hash);

  // Clean up token
  await db.prepare('DELETE FROM settings WHERE key = ?').run('reset_token');
  await db.prepare('DELETE FROM settings WHERE key = ?').run('reset_token_expires');

  res.json({ success: true });
}));

// POST /api/auth/change-password - change password while logged in
router.post('/change-password', authRateLimit, asyncHandler(async (req, res) => {
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

  const passwordRow = await getSetting(db, 'password_hash');
  if (!passwordRow) {
    return res.status(400).json({ error: 'Password not set up yet.' });
  }
  const match = await bcrypt.compare(currentPassword, passwordRow.value);
  if (!match) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await setSetting(db, 'password_hash', hash);

  res.json({ success: true });
}));

// ── WebAuthn Passkey Routes ──────────────────────────────────────────────────

// Helper: get or create a stable user ID for WebAuthn
async function getWebAuthnUserId(db) {
  const row = await getSetting(db, 'webauthn_user_id');
  if (row) return row.value;
  const id = crypto.randomBytes(16).toString('hex');
  await setSetting(db, 'webauthn_user_id', id);
  return id;
}

// POST /api/auth/passkey/register-options (authenticated)
router.post('/passkey/register-options', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const db = await getDb();
  const userId = await getWebAuthnUserId(db);
  const existing = await db.prepare('SELECT id, transports FROM passkey_credentials').all();

  const { generateRegistrationOptions } = await getWebAuthn();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'chef',
    userID: Buffer.from(userId, 'hex'),
    excludeCredentials: existing.map(c => ({
      id: c.id,
      transports: JSON.parse(c.transports || '[]'),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge in session
  req.session.webauthnChallenge = options.challenge;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json(options);
  });
}));

// POST /api/auth/passkey/register-verify (authenticated)
router.post('/passkey/register-verify', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const expectedChallenge = req.session.webauthnChallenge;
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'No registration in progress.' });
  }

  delete req.session.webauthnChallenge;

  const { verifyRegistrationResponse } = await getWebAuthn();
  const verification = await verifyRegistrationResponse({
    response: req.body,
    expectedChallenge,
    expectedOrigin: EXPECTED_ORIGIN,
    expectedRPID: RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'Passkey registration failed.' });
  }

  const { credential } = verification.registrationInfo;
  const db = await getDb();

  await db.prepare(
    'INSERT INTO passkey_credentials (id, public_key, counter, transports) VALUES (?, ?, ?, ?)'
  ).run(
    credential.id,
    Buffer.from(credential.publicKey).toString('base64url'),
    credential.counter,
    JSON.stringify(credential.transports || [])
  );

  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json({ success: true });
  });
}));

// POST /api/auth/passkey/login-options (public)
router.post('/passkey/login-options', authRateLimit, asyncHandler(async (req, res) => {
  const db = await getDb();
  const credentials = await db.prepare('SELECT id, transports FROM passkey_credentials').all();

  if (!credentials.length) {
    return res.status(404).json({ error: 'No passkeys registered.' });
  }

  const { generateAuthenticationOptions } = await getWebAuthn();
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: credentials.map(c => ({
      id: c.id,
      transports: JSON.parse(c.transports || '[]'),
    })),
    userVerification: 'preferred',
  });

  // Store challenge in session
  req.session.webauthnChallenge = options.challenge;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json(options);
  });
}));

// POST /api/auth/passkey/login-verify (public)
router.post('/passkey/login-verify', authRateLimit, asyncHandler(async (req, res) => {
  const expectedChallenge = req.session.webauthnChallenge;
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'No login in progress.' });
  }

  delete req.session.webauthnChallenge;

  const db = await getDb();
  const credential = await db.prepare('SELECT * FROM passkey_credentials WHERE id = ?').get(req.body.id);

  if (!credential) {
    return res.status(400).json({ error: 'Unknown passkey.' });
  }

  const { verifyAuthenticationResponse } = await getWebAuthn();
  const verification = await verifyAuthenticationResponse({
    response: req.body,
    expectedChallenge,
    expectedOrigin: EXPECTED_ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: credential.id,
      publicKey: Buffer.from(credential.public_key, 'base64url'),
      counter: credential.counter,
      transports: JSON.parse(credential.transports || '[]'),
    },
  });

  if (!verification.verified) {
    return res.status(401).json({ error: 'Passkey verification failed.' });
  }

  // Update counter
  await db.prepare('UPDATE passkey_credentials SET counter = ? WHERE id = ?')
    .run(verification.authenticationInfo.newCounter, credential.id);

  req.session.authenticated = true;
  req.session.save((err) => {
    if (err) return res.status(500).json({ error: 'Session error.' });
    res.json({ success: true });
  });
}));

// GET /api/auth/passkeys (authenticated) - list registered passkeys
router.get('/passkeys', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const db = await getDb();
  const passkeys = await db.prepare('SELECT id, created_at FROM passkey_credentials ORDER BY created_at').all();
  res.json(passkeys);
}));

// DELETE /api/auth/passkeys/:id (authenticated)
router.delete('/passkeys/:id', asyncHandler(async (req, res) => {
  if (!req.session || !req.session.authenticated) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const db = await getDb();
  const result = await db.prepare('DELETE FROM passkey_credentials WHERE id = ?').run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Passkey not found.' });
  }

  res.json({ success: true });
}));

module.exports = router;
