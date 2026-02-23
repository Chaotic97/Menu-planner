const { getDb } = require('../db/database');

const PUBLIC_PATHS = [
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/forgot',
  '/api/auth/reset',
];

function authMiddleware(req, res, next) {
  // Skip auth for non-API routes (static files, index.html)
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  // Skip auth for public auth endpoints
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }

  // Check session
  if (req.session && req.session.authenticated) {
    return next();
  }

  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = authMiddleware;
