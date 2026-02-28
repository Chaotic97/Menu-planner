'use strict';

const express = require('express');
const { getDb } = require('../db/database');

const router = express.Router();

const DEFAULTS = {
  enabled: false,
  prep_reminders: true,
  prep_lead_minutes: 15,
  task_due_reminders: true,
  task_lead_minutes: 10,
  overdue_alerts: true,
  overdue_interval_minutes: 30,
  daily_briefing: true,
  daily_briefing_time: '08:00',
  specials_expiring: true,
};

const VALID_KEYS = Object.keys(DEFAULTS);

// GET /api/notifications/preferences
router.get('/preferences', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'notification_preferences'").get();
  if (row) {
    try {
      const prefs = JSON.parse(row.value);
      res.json({ ...DEFAULTS, ...prefs });
      return;
    } catch { /* fall through */ }
  }
  res.json(DEFAULTS);
});

// PUT /api/notifications/preferences
router.put('/preferences', (req, res) => {
  const db = getDb();
  const body = req.body;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be an object' });
  }

  // Validate numeric fields
  const numericFields = ['prep_lead_minutes', 'task_lead_minutes', 'overdue_interval_minutes'];
  for (const field of numericFields) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'number' || isNaN(body[field]) || body[field] < 1 || body[field] > 120) {
        return res.status(400).json({ error: `${field} must be a number between 1 and 120` });
      }
    }
  }

  // Validate time format
  if (body.daily_briefing_time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(body.daily_briefing_time)) {
      return res.status(400).json({ error: 'daily_briefing_time must be HH:MM format' });
    }
  }

  // Build merged preferences — only keep known keys
  const current = {};
  const existingRow = db.prepare("SELECT value FROM settings WHERE key = 'notification_preferences'").get();
  if (existingRow) {
    try { Object.assign(current, JSON.parse(existingRow.value)); } catch { /* ignore */ }
  }

  const merged = { ...DEFAULTS, ...current };
  for (const key of VALID_KEYS) {
    if (body[key] !== undefined) {
      merged[key] = body[key];
    }
  }

  const json = JSON.stringify(merged);
  if (existingRow) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'notification_preferences'").run(json);
  } else {
    db.prepare("INSERT INTO settings (key, value) VALUES ('notification_preferences', ?)").run(json);
  }

  res.json(merged);
});

// GET /api/notifications/pending — items needing notification right now
router.get('/pending', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const nowHHMM = now.toTimeString().slice(0, 5);

  // Overdue tasks
  const overdue = db.prepare(`
    SELECT t.id, t.title, t.priority, t.due_date, t.due_time, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date < ? AND t.completed = 0
    ORDER BY t.due_date ASC
    LIMIT 20
  `).all(today);

  // Tasks due today with a due_time (for reminders)
  const upcomingToday = db.prepare(`
    SELECT t.id, t.title, t.priority, t.due_date, t.due_time, t.day_phase, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date = ? AND t.completed = 0 AND t.due_time IS NOT NULL AND t.due_time >= ?
    ORDER BY t.due_time ASC
    LIMIT 20
  `).all(today, nowHHMM);

  // Today's task count for daily briefing
  const todayCount = db.prepare(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
    FROM tasks WHERE due_date = ?
  `).get(today);

  // Expiring specials (ending within 2 days)
  const twoDaysOut = new Date(now);
  twoDaysOut.setDate(twoDaysOut.getDate() + 2);
  const twoDaysStr = twoDaysOut.toISOString().slice(0, 10);

  const expiringSpecials = db.prepare(`
    SELECT ws.id, ws.week_end, ws.notes, d.name AS dish_name
    FROM weekly_specials ws
    JOIN dishes d ON d.id = ws.dish_id
    WHERE ws.is_active = 1 AND ws.week_end <= ? AND ws.week_end >= ?
    ORDER BY ws.week_end ASC
  `).all(twoDaysStr, today);

  // Day phases (for phase transition reminders)
  const phaseRow = db.prepare("SELECT value FROM settings WHERE key = 'day_phases'").get();
  let phases = [];
  if (phaseRow) {
    try { phases = JSON.parse(phaseRow.value); } catch { /* ignore */ }
  }

  res.json({
    date: today,
    now: nowHHMM,
    overdue,
    upcoming_today: upcomingToday,
    today_summary: todayCount || { total: 0, completed: 0 },
    expiring_specials: expiringSpecials,
    phases,
  });
});

module.exports = router;
