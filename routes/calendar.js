const express = require('express');
const https = require('https');
const querystring = require('querystring');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// In-memory cache for Google Calendar events
let eventsCache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

// --- Helpers ---

function getSetting(key) {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const db = getDb();
  if (value === null || value === undefined || value === '') {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  } else {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }
}

function getOAuthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: getSetting('gcal_refresh_token'),
    accessToken: getSetting('gcal_access_token'),
    tokenExpiry: getSetting('gcal_token_expiry'),
    calendarId: getSetting('gcal_calendar_id'),
  };
}

// Make an HTTPS request and return parsed JSON
function httpsRequest(url, options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { timeout: 10000, ...options }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Invalid JSON response from Google'));
        }
      });
    });
    req.on('error', err => reject(new Error('Google request failed: ' + err.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Google request timed out')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// Exchange auth code for tokens
async function exchangeCodeForTokens(code, redirectUri, clientId, clientSecret) {
  const body = querystring.stringify({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const result = await httpsRequest(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (result.error) {
    throw new Error(result.error_description || result.error);
  }
  return result;
}

// Refresh the access token using the refresh token
async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const body = querystring.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });

  const result = await httpsRequest(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);

  if (result.error) {
    throw new Error(result.error_description || result.error);
  }
  return result;
}

// Get a valid access token, refreshing if needed
async function getValidAccessToken() {
  const config = getOAuthConfig();
  if (!config.refreshToken || !config.clientId || !config.clientSecret) {
    return null;
  }

  // Check if current access token is still valid (with 60s buffer)
  const now = Date.now();
  if (config.accessToken && config.tokenExpiry && (parseInt(config.tokenExpiry) - 60000) > now) {
    return config.accessToken;
  }

  // Refresh the token
  const result = await refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
  const expiry = Date.now() + (result.expires_in * 1000);
  setSetting('gcal_access_token', result.access_token);
  setSetting('gcal_token_expiry', String(expiry));
  // Google may issue a new refresh token
  if (result.refresh_token) {
    setSetting('gcal_refresh_token', result.refresh_token);
  }
  return result.access_token;
}

// Build the redirect URI from the request
function getRedirectUri(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/calendar/callback`;
}

// --- Routes ---

// GET /api/calendar/settings - Get calendar integration status
router.get('/settings', (req, res) => {
  const config = getOAuthConfig();
  res.json({
    configured: !!(config.clientId && config.clientSecret),
    calendarId: config.calendarId || '',
    connected: !!config.refreshToken,
  });
});

// POST /api/calendar/settings - Save calendar ID
router.post('/settings', (req, res) => {
  const { calendarId } = req.body;

  if (calendarId !== undefined) {
    setSetting('gcal_calendar_id', calendarId.trim());
  }

  // Invalidate cache when settings change
  eventsCache = { data: null, fetchedAt: 0 };

  res.json({ success: true });
});

// GET /api/calendar/auth-url - Generate OAuth authorization URL
router.get('/auth-url', (req, res) => {
  const config = getOAuthConfig();
  if (!config.clientId) {
    return res.status(400).json({ error: 'Google Calendar not configured on this server.' });
  }

  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  });

  res.json({ url: `${GOOGLE_AUTH_URL}?${params}` });
});

// GET /api/calendar/callback - Handle OAuth redirect from Google
router.get('/callback', asyncHandler(async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect('/#/settings?gcal=error&msg=' + encodeURIComponent(error));
  }
  if (!code) {
    return res.redirect('/#/settings?gcal=error&msg=no_code');
  }

  const config = getOAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    return res.redirect('/#/settings?gcal=error&msg=missing_credentials');
  }

  try {
    const redirectUri = getRedirectUri(req);
    const tokens = await exchangeCodeForTokens(code, redirectUri, config.clientId, config.clientSecret);

    setSetting('gcal_access_token', tokens.access_token);
    setSetting('gcal_refresh_token', tokens.refresh_token);
    setSetting('gcal_token_expiry', String(Date.now() + (tokens.expires_in * 1000)));

    // Invalidate cache
    eventsCache = { data: null, fetchedAt: 0 };

    res.redirect('/#/settings?gcal=success');
  } catch (err) {
    res.redirect('/#/settings?gcal=error&msg=' + encodeURIComponent(err.message));
  }
}));

// POST /api/calendar/disconnect - Remove stored tokens
router.post('/disconnect', (req, res) => {
  setSetting('gcal_access_token', null);
  setSetting('gcal_refresh_token', null);
  setSetting('gcal_token_expiry', null);
  eventsCache = { data: null, fetchedAt: 0 };
  res.json({ success: true });
});

// GET /api/calendar/events - Fetch Google Calendar events using OAuth
router.get('/events', asyncHandler(async (req, res) => {
  const config = getOAuthConfig();

  if (!config.refreshToken) {
    return res.json({ events: [], configured: false });
  }

  const calendarId = config.calendarId || 'primary';

  // Time range: 1 month back, 2 months ahead (rolling 3 months)
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

  // Check cache (skip if ?refresh=true)
  if (!req.query.refresh && eventsCache.data && (Date.now() - eventsCache.fetchedAt) < CACHE_TTL_MS) {
    return res.json({ events: eventsCache.data, configured: true, cached: true });
  }

  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.json({ events: [], configured: false });
    }

    const encodedCalId = encodeURIComponent(calendarId);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedCalId}/events?${params}`;
    const result = await httpsRequest(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (result.error) {
      // If token was revoked or expired, clear connection
      if (result.error.code === 401) {
        setSetting('gcal_access_token', null);
        setSetting('gcal_refresh_token', null);
        setSetting('gcal_token_expiry', null);
        return res.status(401).json({ error: 'Google Calendar authorization expired. Please reconnect in Settings.', configured: false });
      }
      throw new Error(result.error.message || 'Google Calendar API error');
    }

    const events = (result.items || []).map(item => ({
      id: item.id,
      summary: item.summary || '(No title)',
      description: item.description || '',
      location: item.location || '',
      start: item.start.dateTime || item.start.date,
      end: item.end.dateTime || item.end.date,
      allDay: !item.start.dateTime,
      htmlLink: item.htmlLink || '',
    }));

    // Update cache
    eventsCache = { data: events, fetchedAt: Date.now() };

    res.json({ events, configured: true });
  } catch (err) {
    res.status(502).json({ error: err.message, configured: true });
  }
}));

// GET /api/calendar/calendars - List user's calendars (for picker)
router.get('/calendars', asyncHandler(async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      return res.status(401).json({ error: 'Not connected to Google Calendar' });
    }

    const result = await httpsRequest('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (result.error) {
      throw new Error(result.error.message || 'Failed to list calendars');
    }

    const calendars = (result.items || []).map(cal => ({
      id: cal.id,
      summary: cal.summary,
      primary: cal.primary || false,
    }));

    res.json({ calendars });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
}));

module.exports = router;
