const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/asyncHandler');
const { getDb } = require('../db/database');
const { syncEvents, getCachedEvents, getCalendarSettings, saveCalendarSettings } = require('../services/googleCalendar');

// GET /api/google-calendar/events?month=YYYY-MM
router.get('/events', asyncHandler(async (req, res) => {
  const db = getDb();
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'month query param required (YYYY-MM)' });
  }

  const events = getCachedEvents(db, month);
  res.json(events);
}));

// POST /api/google-calendar/sync
router.post('/sync', asyncHandler(async (req, res) => {
  const db = getDb();
  const result = await syncEvents(db);
  const settings = getCalendarSettings(db);
  req.broadcast('gcal_synced', result, req.headers['x-client-id']);
  res.json({ ...result, lastSync: settings.lastSync });
}));

// GET /api/google-calendar/settings
router.get('/settings', (req, res) => {
  const db = getDb();
  const settings = getCalendarSettings(db);
  res.json(settings);
});

// PUT /api/google-calendar/settings
router.put('/settings', asyncHandler(async (req, res) => {
  const db = getDb();
  const { apiKey, calendarId, syncEnabled, syncInterval } = req.body;

  if (apiKey !== undefined && typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey must be a string' });
  }
  if (calendarId !== undefined && typeof calendarId !== 'string') {
    return res.status(400).json({ error: 'calendarId must be a string' });
  }
  if (syncInterval !== undefined) {
    const parsed = parseInt(syncInterval, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 60) {
      return res.status(400).json({ error: 'syncInterval must be between 1 and 60 minutes' });
    }
  }

  saveCalendarSettings(db, { apiKey, calendarId, syncEnabled, syncInterval });

  // Notify server to restart background sync timer
  if (req.restartGcalSync) {
    req.restartGcalSync();
  }

  const updated = getCalendarSettings(db);
  res.json(updated);
}));

// POST /api/google-calendar/events/:eventId/create-menu
router.post('/events/:eventId/create-menu', asyncHandler(async (req, res) => {
  const db = getDb();
  const { eventId } = req.params;

  const event = db.prepare('SELECT * FROM google_calendar_events WHERE id = ?').get(eventId);
  if (!event) {
    return res.status(404).json({ error: 'Google Calendar event not found' });
  }

  if (event.menu_id) {
    // Already linked — just return the existing menu
    const existingMenu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(event.menu_id);
    if (existingMenu) {
      return res.json({ menuId: existingMenu.id, existing: true });
    }
    // Menu was deleted — clear the link and create a new one
    db.prepare('UPDATE google_calendar_events SET menu_id = NULL WHERE id = ?').run(eventId);
  }

  // Create menu from event data
  const result = db.prepare(`
    INSERT INTO menus (name, description, event_date, menu_type)
    VALUES (?, ?, ?, 'event')
  `).run(event.summary, event.description || '', event.start_date);

  const menuId = result.lastInsertRowid;

  // Link event to menu
  db.prepare('UPDATE google_calendar_events SET menu_id = ? WHERE id = ?').run(menuId, eventId);

  req.broadcast('menu_created', { id: menuId }, req.headers['x-client-id']);
  req.broadcast('gcal_menu_linked', { eventId, menuId }, req.headers['x-client-id']);

  res.status(201).json({ menuId });
}));

module.exports = router;
