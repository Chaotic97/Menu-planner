'use strict';

const { getDb } = require('../db/database');
const { generatePrepTasks } = require('./prepTaskGenerator');

/**
 * Map timing_bucket to a day offset relative to the service date.
 * Negative means before, 0 means same day.
 */
const TIMING_DAY_OFFSET = {
  day_before: -1,
  morning_of: 0,
  '1_2_hours_before': 0,
  during_service: 0,
  last_minute: 0,
};

/**
 * Add days to a YYYY-MM-DD date string and return YYYY-MM-DD.
 */
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toUTCString().length ? d.toISOString().slice(0, 10) : dateStr;
}

/**
 * Given a week_start (Monday YYYY-MM-DD) and a target day number (0=Sun..6=Sat),
 * return the YYYY-MM-DD for that day within the week.
 * Week runs Mon(1)..Sun(0). Monday is offset 0, Sunday is offset 6.
 */
function getDateForDay(weekStart, dayNum) {
  // weekStart is a Monday. dayNum: 0=Sun,1=Mon,...,6=Sat
  // Mon=0 offset, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
  const offsets = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
  return addDays(weekStart, offsets[dayNum]);
}

/**
 * Transform prep tasks result into task row objects (pure function).
 */
function buildPrepTaskRows(prepResult, menuId) {
  const db = getDb();
  const rows = [];
  for (const group of prepResult.task_groups) {
    for (const task of group.tasks) {
      // Look up dish id for source tracking
      let dishId = null;
      if (task.dish) {
        const dish = db.prepare(
          'SELECT id FROM dishes WHERE name = ? AND deleted_at IS NULL'
        ).get(task.dish);
        if (dish) dishId = dish.id;
      }
      rows.push({
        menu_id: menuId,
        source_dish_id: dishId,
        type: 'prep',
        title: task.task,
        description: task.dish || '',
        category: '',
        quantity: null,
        unit: '',
        timing_bucket: task.timing || group.timing,
        priority: 'medium',
        source: 'auto',
      });
    }
  }
  return rows;
}

/**
 * Build calendar-aware task rows using the menu's schedule_days and per-dish active_days.
 * Each task gets a due_date based on the first service day + timing_bucket offset.
 */
function buildWeeklyTaskRows(prepResult, menuId, weekStart) {
  const db = getDb();

  // Get menu schedule
  const menu = db.prepare('SELECT schedule_days FROM menus WHERE id = ?').get(menuId);
  let scheduleDays = [];
  try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch {}
  if (!scheduleDays.length) {
    // No schedule configured — fall back to non-weekly behaviour
    return buildPrepTaskRows(prepResult, menuId);
  }

  // Get per-dish active_days
  const dishDays = {};
  const menuDishes = db.prepare('SELECT dish_id, active_days FROM menu_dishes WHERE menu_id = ?').all(menuId);
  for (const md of menuDishes) {
    let days = null;
    try { days = md.active_days ? JSON.parse(md.active_days) : null; } catch {}
    dishDays[md.dish_id] = days; // null means all schedule days
  }

  // Sort schedule days chronologically within the week
  const dayOrder = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
  const sortedDays = [...scheduleDays].sort((a, b) => dayOrder[a] - dayOrder[b]);

  const rows = [];

  for (const group of prepResult.task_groups) {
    for (const task of group.tasks) {
      // Look up dish id
      let dishId = null;
      if (task.dish) {
        const dish = db.prepare(
          'SELECT id FROM dishes WHERE name = ? AND deleted_at IS NULL'
        ).get(task.dish);
        if (dish) dishId = dish.id;
      }

      // Determine which days this dish runs
      const activeDays = dishId && dishDays[dishId] ? dishDays[dishId] : sortedDays;

      // Find the first service date for this dish
      const dishFirstDay = activeDays
        .slice()
        .sort((a, b) => dayOrder[a] - dayOrder[b])[0];
      const dishFirstDate = getDateForDay(weekStart, dishFirstDay);

      // Calculate due_date from timing bucket
      const timingBucket = task.timing || group.timing;
      const offset = TIMING_DAY_OFFSET[timingBucket] !== undefined ? TIMING_DAY_OFFSET[timingBucket] : 0;
      const dueDate = addDays(dishFirstDate, offset);

      rows.push({
        menu_id: menuId,
        source_dish_id: dishId,
        type: 'prep',
        title: task.task,
        description: task.dish || '',
        category: '',
        quantity: null,
        unit: '',
        timing_bucket: timingBucket,
        priority: 'medium',
        source: 'auto',
        due_date: dueDate,
      });
    }
  }
  return rows;
}

/**
 * Generate and persist prep tasks from a menu.
 * Deletes existing auto-generated tasks for this menu, then re-inserts.
 * Manually edited tasks (source='manual') are preserved.
 *
 * Options:
 *   weekStart (string|null) — YYYY-MM-DD Monday of the target week.
 *     When provided, tasks get calendar-aware due_dates based on the
 *     menu's schedule_days and each dish's active_days.
 *
 * NOTE: Shopping/purchasing is handled separately via the shopping list page,
 * not as tasks. Only prep and custom tasks live in the tasks table.
 */
function generateAndPersistTasks(menuId, options = {}) {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
  if (!menu) return null;

  const prepResult = generatePrepTasks(menuId);

  // Delete existing auto-generated tasks for this menu
  db.prepare('DELETE FROM tasks WHERE menu_id = ? AND source = ?').run(menuId, 'auto');

  let prepRows = [];
  if (prepResult) {
    if (options.weekStart) {
      prepRows = buildWeeklyTaskRows(prepResult, menuId, options.weekStart);
    } else {
      prepRows = buildPrepTaskRows(prepResult, menuId);
    }
  }

  const insertStmt = db.prepare(`
    INSERT INTO tasks (menu_id, source_dish_id, type, title, description, category, quantity, unit, timing_bucket, priority, source, sort_order, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < prepRows.length; i++) {
    const r = prepRows[i];
    insertStmt.run(
      r.menu_id, r.source_dish_id, r.type, r.title, r.description,
      r.category, r.quantity, r.unit, r.timing_bucket, r.priority,
      r.source, i, r.due_date || null
    );
  }

  return {
    menu_id: menuId,
    prep_count: prepRows.length,
    total: prepRows.length,
    week_start: options.weekStart || null,
  };
}

/**
 * Get all tasks with optional filters.
 */
function getTasks(filters = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (filters.menu_id !== undefined) {
    if (filters.menu_id === 'none') {
      conditions.push('t.menu_id IS NULL');
    } else {
      conditions.push('t.menu_id = ?');
      params.push(filters.menu_id);
    }
  }

  if (filters.type) {
    conditions.push('t.type = ?');
    params.push(filters.type);
  }

  if (filters.completed !== undefined) {
    conditions.push('t.completed = ?');
    params.push(parseInt(filters.completed));
  }

  if (filters.priority) {
    conditions.push('t.priority = ?');
    params.push(filters.priority);
  }

  if (filters.due_date_from) {
    conditions.push('t.due_date >= ?');
    params.push(filters.due_date_from);
  }

  if (filters.due_date_to) {
    conditions.push('t.due_date <= ?');
    params.push(filters.due_date_to);
  }

  if (filters.overdue === '1' || filters.overdue === true) {
    conditions.push("t.due_date < date('now') AND t.completed = 0");
  }

  if (filters.search) {
    conditions.push('t.title LIKE ?');
    params.push(`%${filters.search}%`);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const sql = `
    SELECT t.*, m.name AS menu_name
    FROM tasks t
    LEFT JOIN menus m ON m.id = t.menu_id
    ${where}
    ORDER BY
      t.completed ASC,
      CASE WHEN t.priority = 'high' THEN 0 WHEN t.priority = 'medium' THEN 1 ELSE 2 END,
      CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
      t.due_date ASC,
      t.sort_order ASC,
      t.created_at DESC
  `;

  return db.prepare(sql).all(...params);
}

module.exports = {
  generateAndPersistTasks,
  getTasks,
  buildPrepTaskRows,
  buildWeeklyTaskRows,
  addDays,
  getDateForDay,
};
