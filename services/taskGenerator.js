'use strict';

const { getDb } = require('../db/database');
const { generatePrepTasks } = require('./prepTaskGenerator');

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
 * Generate and persist prep tasks from a menu.
 * Deletes existing auto-generated tasks for this menu, then re-inserts.
 * Manually edited tasks (source='manual') are preserved.
 *
 * NOTE: Shopping/purchasing is handled separately via the shopping list page,
 * not as tasks. Only prep and custom tasks live in the tasks table.
 */
function generateAndPersistTasks(menuId) {
  const db = getDb();
  const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
  if (!menu) return null;

  const prepResult = generatePrepTasks(menuId);

  // Delete existing auto-generated tasks for this menu
  db.prepare('DELETE FROM tasks WHERE menu_id = ? AND source = ?').run(menuId, 'auto');

  const prepRows = prepResult ? buildPrepTaskRows(prepResult, menuId) : [];

  const insertStmt = db.prepare(`
    INSERT INTO tasks (menu_id, source_dish_id, type, title, description, category, quantity, unit, timing_bucket, priority, source, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < prepRows.length; i++) {
    const r = prepRows[i];
    insertStmt.run(
      r.menu_id, r.source_dish_id, r.type, r.title, r.description,
      r.category, r.quantity, r.unit, r.timing_bucket, r.priority,
      r.source, i
    );
  }

  return {
    menu_id: menuId,
    prep_count: prepRows.length,
    total: prepRows.length,
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
};
