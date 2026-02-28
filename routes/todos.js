const express = require('express');
const { getDb } = require('../db/database');
const { generateShoppingList } = require('../services/shoppingListGenerator');
const { generatePrepTasks } = require('../services/prepTaskGenerator');
const { generateAndPersistTasks, getTasks } = require('../services/taskGenerator');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

const VALID_TYPES = ['prep', 'custom'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

// ─── EXISTING ENDPOINTS (unchanged) ─────────────────────────────────────────

// GET /api/todos/menu/:id/shopping-list
router.get('/menu/:id/shopping-list', (req, res) => {
  const result = generateShoppingList(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });
  res.json(result);
});

// GET /api/todos/menu/:id/scaled-shopping-list?covers=N
router.get('/menu/:id/scaled-shopping-list', (req, res) => {
  const covers = parseInt(req.query.covers);
  if (!covers || covers < 1) {
    return res.status(400).json({ error: 'covers parameter is required and must be a positive integer' });
  }

  const result = generateShoppingList(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });

  // Calculate base covers — prefer menu's expected_covers, fall back to computed portions
  const db = getDb();
  const menu = db.prepare('SELECT expected_covers FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);

  let baseCovers;
  let baseCoversSource;
  if (menu && menu.expected_covers && menu.expected_covers > 0) {
    baseCovers = menu.expected_covers;
    baseCoversSource = 'expected';
  } else {
    const portionsRow = db.prepare(`
      SELECT COALESCE(SUM(md.servings * COALESCE(d.batch_yield, 1)), 0) AS total_portions
      FROM menu_dishes md
      JOIN dishes d ON d.id = md.dish_id
      WHERE md.menu_id = ?
    `).get(req.params.id);
    baseCovers = portionsRow.total_portions || 1;
    baseCoversSource = 'computed';
  }
  const scaleFactor = covers / baseCovers;

  // Scale all quantities and costs
  for (const group of result.groups) {
    for (const item of group.items) {
      item.total_quantity = Math.round(item.total_quantity * scaleFactor * 100) / 100;
      if (item.estimated_cost !== null) {
        item.estimated_cost = Math.round(item.estimated_cost * scaleFactor * 100) / 100;
      }
      // Re-normalize units after scaling
      if (item.unit === 'g' && item.total_quantity >= 1000) {
        item.total_quantity = Math.round(item.total_quantity / 1000 * 100) / 100;
        item.unit = 'kg';
      } else if (item.unit === 'ml' && item.total_quantity >= 1000) {
        item.total_quantity = Math.round(item.total_quantity / 1000 * 100) / 100;
        item.unit = 'L';
      }
    }
  }
  result.total_estimated_cost = Math.round(result.total_estimated_cost * scaleFactor * 100) / 100;
  result.covers = covers;
  result.base_covers = baseCovers;
  result.base_covers_source = baseCoversSource;
  result.scale_factor = Math.round(scaleFactor * 100) / 100;

  res.json(result);
});

// GET /api/todos/menu/:id/prep-tasks
router.get('/menu/:id/prep-tasks', (req, res) => {
  const result = generatePrepTasks(req.params.id);
  if (!result) return res.status(404).json({ error: 'Menu not found' });
  res.json(result);
});

// ─── NEW PERSISTENT TASK ENDPOINTS ──────────────────────────────────────────

// POST /api/todos/generate/:menuId — generate & persist tasks from menu
// Body: { week_start?: 'YYYY-MM-DD' } — when provided, generates calendar-aware tasks
router.post('/generate/:menuId', asyncHandler(async (req, res) => {
  const menuId = parseInt(req.params.menuId);
  const { week_start } = req.body || {};
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
  if (!menu) return res.status(404).json({ error: 'Menu not found' });

  if (week_start && !DATE_REGEX.test(week_start)) {
    return res.status(400).json({ error: 'week_start must be YYYY-MM-DD format' });
  }

  const result = generateAndPersistTasks(menuId, { weekStart: week_start || null });
  if (!result) return res.status(404).json({ error: 'Menu not found' });

  req.broadcast('tasks_generated', { menu_id: menuId, total: result.total }, req.headers['x-client-id']);
  res.status(201).json(result);
}));

// GET /api/todos — list tasks with filters
router.get('/', (req, res) => {
  const tasks = getTasks(req.query);
  res.json(tasks);
});

// POST /api/todos — create a custom task
router.post('/', (req, res) => {
  const { title, description, type, priority, menu_id, due_date, due_time, day_phase } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Title is required' });
  }

  if (type && !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `Type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  if (priority && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  if (due_date && !DATE_REGEX.test(due_date)) {
    return res.status(400).json({ error: 'due_date must be YYYY-MM-DD format' });
  }

  if (due_time && !TIME_REGEX.test(due_time)) {
    return res.status(400).json({ error: 'due_time must be HH:MM format' });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO tasks (title, description, type, priority, menu_id, due_date, due_time, day_phase, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(
    title.trim(),
    (description || '').trim(),
    type || 'custom',
    priority || 'medium',
    menu_id || null,
    due_date || null,
    due_time || null,
    day_phase || null
  );

  req.broadcast('task_created', { id: result.lastInsertRowid, menu_id: menu_id || null, type: type || 'custom' }, req.headers['x-client-id']);
  res.status(201).json({ id: result.lastInsertRowid });
});

// PUT /api/todos/:id — update a task
router.put('/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { title, description, priority, due_date, due_time, completed, sort_order, day_phase } = req.body;

  if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
    return res.status(400).json({ error: 'Title cannot be empty' });
  }

  if (priority !== undefined && !VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Priority must be one of: ${VALID_PRIORITIES.join(', ')}` });
  }

  if (due_date !== undefined && due_date !== null && due_date !== '' && !DATE_REGEX.test(due_date)) {
    return res.status(400).json({ error: 'due_date must be YYYY-MM-DD format' });
  }

  if (due_time !== undefined && due_time !== null && due_time !== '' && !TIME_REGEX.test(due_time)) {
    return res.status(400).json({ error: 'due_time must be HH:MM format' });
  }

  const updates = [];
  const params = [];

  if (title !== undefined) {
    updates.push('title = ?');
    params.push(title.trim());
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }
  if (priority !== undefined) {
    updates.push('priority = ?');
    params.push(priority);
  }
  if (due_date !== undefined) {
    updates.push('due_date = ?');
    params.push(due_date || null);
  }
  if (due_time !== undefined) {
    updates.push('due_time = ?');
    params.push(due_time || null);
  }
  if (sort_order !== undefined) {
    updates.push('sort_order = ?');
    params.push(sort_order);
  }
  if (day_phase !== undefined) {
    updates.push('day_phase = ?');
    params.push(day_phase || null);
  }

  if (completed !== undefined) {
    updates.push('completed = ?');
    params.push(completed ? 1 : 0);
    if (completed) {
      updates.push("completed_at = datetime('now')");
    } else {
      updates.push('completed_at = NULL');
    }
  }

  // If editing a non-completion field on an auto task, promote to manual
  const editingContent = title !== undefined || description !== undefined ||
    priority !== undefined || due_date !== undefined || due_time !== undefined ||
    day_phase !== undefined;
  if (editingContent && task.source === 'auto') {
    updates.push("source = 'manual'");
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  req.broadcast('task_updated', { id: parseInt(req.params.id), menu_id: task.menu_id }, req.headers['x-client-id']);
  res.json({ success: true });
});

// PUT /api/todos/:id/next — set a task as "do this next"
router.put('/:id/next', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Clear any existing next flag
  db.prepare('UPDATE tasks SET is_next = 0 WHERE is_next = 1').run();
  // Set this task as next
  db.prepare('UPDATE tasks SET is_next = 1 WHERE id = ?').run(req.params.id);

  req.broadcast('task_updated', { id: parseInt(req.params.id), is_next: true }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/todos/next — clear the "do this next" flag
// NOTE: must be defined before DELETE /:id to avoid `:id` matching "next"
router.delete('/next', (req, res) => {
  const db = getDb();
  db.prepare('UPDATE tasks SET is_next = 0 WHERE is_next = 1').run();

  req.broadcast('task_updated', { cleared_next: true }, req.headers['x-client-id']);
  res.json({ success: true });
});

// DELETE /api/todos/:id — delete a task
router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Task not found' });

  req.broadcast('task_deleted', { id: parseInt(req.params.id) }, req.headers['x-client-id']);
  res.json({ success: true });
});

// POST /api/todos/batch-complete — batch complete/uncomplete tasks
router.post('/batch-complete', (req, res) => {
  const { task_ids, completed } = req.body;
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    return res.status(400).json({ error: 'task_ids must be a non-empty array' });
  }

  const db = getDb();
  const placeholders = task_ids.map(() => '?').join(',');
  const completedVal = completed ? 1 : 0;

  if (completed) {
    db.prepare(`UPDATE tasks SET completed = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id IN (${placeholders})`).run(completedVal, ...task_ids);
  } else {
    db.prepare(`UPDATE tasks SET completed = ?, completed_at = NULL, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(completedVal, ...task_ids);
  }

  req.broadcast('tasks_batch_updated', { task_ids, action: 'complete' }, req.headers['x-client-id']);
  res.json({ success: true, updated: task_ids.length });
});

module.exports = router;
