const https = require('https');

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

/**
 * Fetch events from the Google Calendar API v3.
 * Uses only an API key (no OAuth) — calendar must be public or unlisted.
 */
function fetchEvents(apiKey, calendarId, timeMin, timeMax) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      key: apiKey,
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`;

    const allEvents = [];

    function fetchPage(pageUrl) {
      https.get(pageUrl, { timeout: 15000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            let msg = `Google Calendar API error (${res.statusCode})`;
            try {
              const parsed = JSON.parse(body);
              if (parsed.error && parsed.error.message) {
                msg = parsed.error.message;
              }
            } catch {}
            return reject(new Error(msg));
          }

          let data;
          try {
            data = JSON.parse(body);
          } catch {
            return reject(new Error('Invalid response from Google Calendar API'));
          }

          const events = (data.items || [])
            .filter(e => e.start && (e.start.date || e.start.dateTime))
            .map(normalizeEvent);

          allEvents.push(...events);

          if (data.nextPageToken) {
            const nextUrl = `${url}&pageToken=${data.nextPageToken}`;
            fetchPage(nextUrl);
          } else {
            resolve(allEvents);
          }
        });
      }).on('error', (err) => {
        reject(new Error(`Failed to reach Google Calendar API: ${err.message}`));
      }).on('timeout', function () {
        this.destroy();
        reject(new Error('Google Calendar API request timed out'));
      });
    }

    fetchPage(url);
  });
}

/**
 * Normalize a Google Calendar event into our storage format.
 */
function normalizeEvent(event) {
  // All-day events use .date, timed events use .dateTime
  const startDate = event.start.date || event.start.dateTime.slice(0, 10);
  const endDate = event.end
    ? (event.end.date || event.end.dateTime.slice(0, 10))
    : startDate;

  return {
    id: event.id,
    summary: event.summary || '(No title)',
    description: event.description || '',
    start_date: startDate,
    end_date: endDate,
    location: event.location || '',
    raw_json: JSON.stringify(event),
  };
}

/**
 * Sync events from Google Calendar into the local DB cache.
 * Fetches ±3 months from now. Upserts new/changed events, removes deleted ones.
 */
function syncEvents(db) {
  const apiKey = getSetting(db, 'google_calendar_api_key');
  const calendarId = getSetting(db, 'google_calendar_id');

  if (!apiKey || !calendarId) {
    throw new Error('Google Calendar is not configured. Add your API key and Calendar ID in Settings.');
  }

  const now = new Date();
  const timeMin = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
  const timeMax = new Date(now.getFullYear(), now.getMonth() + 4, 0).toISOString();

  return fetchEvents(apiKey, calendarId, timeMin, timeMax).then((events) => {
    const existingIds = new Set(
      db.prepare('SELECT id FROM google_calendar_events').all().map(r => r.id)
    );

    const fetchedIds = new Set();
    let added = 0;
    let updated = 0;

    for (const event of events) {
      fetchedIds.add(event.id);

      if (existingIds.has(event.id)) {
        db.prepare(`
          UPDATE google_calendar_events
          SET summary = ?, description = ?, start_date = ?, end_date = ?, location = ?, raw_json = ?, synced_at = datetime('now')
          WHERE id = ?
        `).run(event.summary, event.description, event.start_date, event.end_date, event.location, event.raw_json, event.id);
        updated++;
      } else {
        db.prepare(`
          INSERT INTO google_calendar_events (id, summary, description, start_date, end_date, location, raw_json, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(event.id, event.summary, event.description, event.start_date, event.end_date, event.location, event.raw_json);
        added++;
      }
    }

    // Remove events that no longer exist in Google
    let removed = 0;
    for (const existingId of existingIds) {
      if (!fetchedIds.has(existingId)) {
        db.prepare('DELETE FROM google_calendar_events WHERE id = ?').run(existingId);
        removed++;
      }
    }

    // Update last sync timestamp
    setSetting(db, 'google_calendar_last_sync', new Date().toISOString());

    return { added, updated, removed };
  });
}

/**
 * Get cached events for a specific month.
 */
function getCachedEvents(db, yearMonth) {
  // yearMonth is "YYYY-MM"
  const startDate = `${yearMonth}-01`;
  // End date: first day of next month
  const [y, m] = yearMonth.split('-').map(Number);
  const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const endDate = `${nextMonth}-01`;

  return db.prepare(`
    SELECT gce.*, gce.menu_id,
      CASE WHEN gce.menu_id IS NOT NULL THEN m.name ELSE NULL END AS menu_name
    FROM google_calendar_events gce
    LEFT JOIN menus m ON gce.menu_id = m.id AND m.deleted_at IS NULL
    WHERE gce.start_date >= ? AND gce.start_date < ?
    ORDER BY gce.start_date ASC
  `).all(startDate, endDate);
}

/**
 * Read a single setting from the settings table.
 */
function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Write a setting to the settings table (upsert).
 */
function setSetting(db, key, value) {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, key);
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

/**
 * Get all Google Calendar settings.
 */
function getCalendarSettings(db) {
  const apiKey = getSetting(db, 'google_calendar_api_key') || '';
  const calendarId = getSetting(db, 'google_calendar_id') || '';
  const syncEnabled = getSetting(db, 'google_calendar_sync_enabled') === '1';
  const syncInterval = parseInt(getSetting(db, 'google_calendar_sync_interval') || '15', 10);
  const lastSync = getSetting(db, 'google_calendar_last_sync') || null;

  return {
    hasApiKey: !!apiKey,
    apiKey: apiKey ? apiKey.slice(0, 6) + '...' + apiKey.slice(-4) : '',
    calendarId,
    syncEnabled,
    syncInterval,
    lastSync,
  };
}

/**
 * Save Google Calendar settings.
 */
function saveCalendarSettings(db, settings) {
  if (settings.apiKey !== undefined) {
    setSetting(db, 'google_calendar_api_key', settings.apiKey);
  }
  if (settings.calendarId !== undefined) {
    setSetting(db, 'google_calendar_id', settings.calendarId);
  }
  if (settings.syncEnabled !== undefined) {
    setSetting(db, 'google_calendar_sync_enabled', settings.syncEnabled ? '1' : '0');
  }
  if (settings.syncInterval !== undefined) {
    const interval = Math.max(1, Math.min(60, parseInt(settings.syncInterval, 10) || 15));
    setSetting(db, 'google_calendar_sync_interval', String(interval));
  }
}

module.exports = {
  fetchEvents,
  syncEvents,
  getCachedEvents,
  getCalendarSettings,
  saveCalendarSettings,
  getSetting,
  setSetting,
};
