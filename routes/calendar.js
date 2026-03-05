const express = require('express');
const https = require('https');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// In-memory cache for Google Calendar events
let eventsCache = { data: null, fetchedAt: 0, calendarId: null, apiKey: null };
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCalendarSettings() {
  const db = getDb();
  const apiKeyRow = db.prepare("SELECT value FROM settings WHERE key = 'gcal_api_key'").get();
  const calIdRow = db.prepare("SELECT value FROM settings WHERE key = 'gcal_calendar_id'").get();
  return {
    apiKey: apiKeyRow ? apiKeyRow.value : null,
    calendarId: calIdRow ? calIdRow.value : null,
  };
}

// GET /api/calendar/settings - Get Google Calendar config (masked key)
router.get('/settings', (req, res) => {
  const { apiKey, calendarId } = getCalendarSettings();
  res.json({
    hasApiKey: !!apiKey,
    apiKey: apiKey ? apiKey.slice(0, 8) + '...' + apiKey.slice(-4) : null,
    calendarId: calendarId || '',
  });
});

// POST /api/calendar/settings - Save Google Calendar config
router.post('/settings', (req, res) => {
  const db = getDb();
  const { apiKey, calendarId } = req.body;

  if (apiKey !== undefined) {
    if (apiKey === '') {
      // Clear the key
      db.prepare("DELETE FROM settings WHERE key = 'gcal_api_key'").run();
    } else {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_api_key', ?)").run(apiKey.trim());
    }
  }

  if (calendarId !== undefined) {
    if (calendarId === '') {
      db.prepare("DELETE FROM settings WHERE key = 'gcal_calendar_id'").run();
    } else {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('gcal_calendar_id', ?)").run(calendarId.trim());
    }
  }

  // Invalidate cache
  eventsCache = { data: null, fetchedAt: 0, calendarId: null, apiKey: null };

  res.json({ success: true });
});

// Fetch events from Google Calendar API
function fetchGoogleEvents(apiKey, calendarId, timeMin, timeMax) {
  return new Promise((resolve, reject) => {
    const encodedCalId = encodeURIComponent(calendarId);
    const params = new URLSearchParams({
      key: apiKey,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedCalId}/events?${params}`;

    https.get(url, { timeout: 10000 }, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message || 'Google Calendar API error'));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error('Invalid response from Google Calendar'));
        }
      });
    }).on('error', (err) => {
      reject(new Error('Failed to reach Google Calendar: ' + err.message));
    }).on('timeout', function() {
      this.destroy();
      reject(new Error('Google Calendar request timed out'));
    });
  });
}

// GET /api/calendar/events - Fetch Google Calendar events
router.get('/events', asyncHandler(async (req, res) => {
  const { apiKey, calendarId } = getCalendarSettings();

  if (!apiKey || !calendarId) {
    return res.json({ events: [], configured: false });
  }

  // Time range: 1 month back, 2 months ahead (rolling 3 months)
  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 0).toISOString();

  // Check cache
  const cacheValid = eventsCache.data
    && (Date.now() - eventsCache.fetchedAt) < CACHE_TTL_MS
    && eventsCache.calendarId === calendarId
    && eventsCache.apiKey === apiKey;

  if (cacheValid) {
    return res.json({ events: eventsCache.data, configured: true, cached: true });
  }

  try {
    const result = await fetchGoogleEvents(apiKey, calendarId, timeMin, timeMax);

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
    eventsCache = { data: events, fetchedAt: Date.now(), calendarId, apiKey };

    res.json({ events, configured: true });
  } catch (err) {
    res.status(502).json({ error: err.message, configured: true });
  }
}));

module.exports = router;
