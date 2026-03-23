const express = require('express');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const DEFAULT_DAY_PHASES = [
  { id: 'admin', name: 'Admin & Planning', start: '12:00', end: '14:30' },
  { id: 'prep', name: 'Prep', start: '14:30', end: '17:00' },
  { id: 'service', name: 'Service', start: '17:00', end: '21:00' },
  { id: 'wrapup', name: 'Wrap-up', start: '21:00', end: '22:30' },
];

async function getDayPhases() {
  const db = await getDb();
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'day_phases'").get();
  if (row) {
    try { return JSON.parse(row.value); } catch { /* fall through */ }
  }
  return DEFAULT_DAY_PHASES;
}

// GET /api/today — today's tasks grouped by phase
router.get('/', asyncHandler(async (req, res) => {
  const db = await getDb();
  const today = req.query.date || new Date().toISOString().slice(0, 10);
  const phases = await getDayPhases();

  // Get today's tasks
  const todayTasks = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date = ?
    ORDER BY
      t.completed ASC,
      t.is_next DESC,
      CASE WHEN t.priority = 'high' THEN 0 WHEN t.priority = 'medium' THEN 1 ELSE 2 END,
      t.sort_order ASC,
      t.created_at DESC
  `).all(today);

  // Get overdue tasks (before today, not completed)
  const overdue = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date < ? AND t.completed = 0
    ORDER BY
      t.due_date ASC,
      CASE WHEN t.priority = 'high' THEN 0 WHEN t.priority = 'medium' THEN 1 ELSE 2 END,
      t.sort_order ASC
  `).all(today);

  // Find the "next" task (could be today or overdue)
  const nextTask = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.is_next = 1 AND t.completed = 0
  `).get() || null;

  // Group today's tasks by phase
  const phaseGroups = phases.map(p => ({
    ...p,
    tasks: todayTasks.filter(t => t.day_phase === p.id),
  }));

  // Unscheduled = today's tasks with no phase
  const unscheduled = todayTasks.filter(t => !t.day_phase);

  // Progress
  const total = todayTasks.length;
  const completed = todayTasks.filter(t => t.completed).length;

  res.json({
    date: today,
    phases: phaseGroups,
    unscheduled,
    overdue,
    next_task: nextTask,
    progress: { total, completed },
  });
}));

// GET /api/today/summary — end-of-day summary
router.get('/summary', asyncHandler(async (req, res) => {
  const db = await getDb();
  const today = req.query.date || new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(today + 'T12:00:00');
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  // Completed today (completed_at is today)
  const completedToday = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE date(t.completed_at) = ?
    ORDER BY t.completed_at ASC
  `).all(today);

  // Added today (created_at is today)
  const addedToday = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE date(t.created_at) = ?
    ORDER BY t.created_at ASC
  `).all(today);

  // Incomplete today (due today or overdue, not completed)
  const incomplete = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date <= ? AND t.completed = 0
    ORDER BY
      t.due_date ASC,
      CASE WHEN t.priority = 'high' THEN 0 WHEN t.priority = 'medium' THEN 1 ELSE 2 END
  `).all(today);

  // Tomorrow's tasks
  const tomorrowTasks = await db.prepare(`
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    WHERE t.due_date = ?
    ORDER BY
      CASE WHEN t.priority = 'high' THEN 0 WHEN t.priority = 'medium' THEN 1 ELSE 2 END,
      t.sort_order ASC
  `).all(tomorrowStr);

  res.json({
    date: today,
    completed: completedToday,
    added: addedToday,
    incomplete,
    tomorrow: {
      date: tomorrowStr,
      task_count: tomorrowTasks.length,
      tasks: tomorrowTasks,
    },
  });
}));

// GET /api/today/day-phases — get configured day phases
router.get('/day-phases', asyncHandler(async (req, res) => {
  res.json(await getDayPhases());
}));

// PUT /api/today/day-phases — update day phases
router.put('/day-phases', asyncHandler(async (req, res) => {
  const { phases } = req.body;

  if (!Array.isArray(phases)) {
    return res.status(400).json({ error: 'phases must be an array' });
  }

  for (const p of phases) {
    if (!p.id || !p.name || !p.start || !p.end) {
      return res.status(400).json({ error: 'Each phase requires id, name, start, and end' });
    }
    if (!/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end)) {
      return res.status(400).json({ error: 'start and end must be HH:MM format' });
    }
  }

  const db = await getDb();
  const json = JSON.stringify(phases);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('day_phases', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").run(json);

  req.broadcast('day_phases_updated', { phases }, req.headers['x-client-id']);
  res.json(phases);
}));

module.exports = router;
