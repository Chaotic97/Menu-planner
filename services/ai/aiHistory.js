/**
 * AI History — snapshot system for undo.
 * Saves entity state before AI mutations, restores on undo.
 */

const { getDb } = require('../../db/database');

/**
 * Save a snapshot of entity state before mutation.
 * @param {string} entityType - 'dish', 'menu', 'task', 'service_note'
 * @param {number} entityId - the entity's primary key
 * @param {string} actionType - 'create', 'update', 'delete'
 * @param {Object|null} previousData - full entity data before the change (null for creates)
 * @returns {number} history ID for undo reference
 */
function saveSnapshot(entityType, entityId, actionType, previousData) {
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO ai_history (entity_type, entity_id, action_type, previous_data) VALUES (?, ?, ?, ?)'
  ).run(entityType, entityId, actionType, previousData ? JSON.stringify(previousData) : null);
  return result.lastInsertRowid;
}

/**
 * Get a snapshot by ID
 */
function getSnapshot(historyId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_history WHERE id = ?').get(historyId);
  if (!row) return null;
  if (row.previous_data) {
    row.previous_data = JSON.parse(row.previous_data);
  }
  return row;
}

/**
 * Restore from a snapshot (undo an AI action).
 * Returns { success, message }
 */
function restoreSnapshot(historyId, broadcast) {
  const db = getDb();
  const snapshot = getSnapshot(historyId);
  if (!snapshot) {
    return { success: false, message: 'Undo history not found' };
  }

  const { entity_type, entity_id, action_type, previous_data } = snapshot;

  if (action_type === 'create') {
    // Undo a create = delete the entity
    if (entity_type === 'dish') {
      db.prepare("UPDATE dishes SET deleted_at = datetime('now') WHERE id = ?").run(entity_id);
      if (broadcast) broadcast('dish_deleted', { id: entity_id });
    } else if (entity_type === 'menu') {
      db.prepare("UPDATE menus SET deleted_at = datetime('now') WHERE id = ?").run(entity_id);
      if (broadcast) broadcast('menu_deleted', { id: entity_id });
    } else if (entity_type === 'task') {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(entity_id);
      if (broadcast) broadcast('task_deleted', { id: entity_id });
    } else if (entity_type === 'service_note') {
      db.prepare('DELETE FROM service_notes WHERE id = ?').run(entity_id);
      if (broadcast) broadcast('service_note_deleted', { id: entity_id });
    }
    return { success: true, message: `Undone: ${entity_type} removed` };
  }

  if (action_type === 'update' && previous_data) {
    // Undo an update = restore previous data
    if (entity_type === 'dish') {
      restoreDish(entity_id, previous_data);
      if (broadcast) broadcast('dish_updated', { id: entity_id });
    } else if (entity_type === 'menu') {
      restoreMenu(entity_id, previous_data);
      if (broadcast) broadcast('menu_updated', { id: entity_id });
    } else if (entity_type === 'task') {
      restoreTask(entity_id, previous_data);
      if (broadcast) broadcast('task_updated', { id: entity_id });
    }
    return { success: true, message: `Undone: ${entity_type} restored to previous state` };
  }

  return { success: false, message: 'Cannot undo this action' };
}

/**
 * Restore a dish to previous state (directions, ingredients, etc.)
 */
function restoreDish(dishId, data) {
  const db = getDb();

  // Restore basic fields if present
  if (data.name !== undefined) {
    db.prepare('UPDATE dishes SET name = ?, description = ?, category = ?, chefs_notes = ? WHERE id = ?')
      .run(data.name, data.description || '', data.category || '', data.chefs_notes || '', dishId);
  }

  // Restore directions if present
  if (data.directions) {
    db.prepare('DELETE FROM dish_directions WHERE dish_id = ?').run(dishId);
    for (const dir of data.directions) {
      db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)')
        .run(dishId, dir.type, dir.text, dir.sort_order);
    }
  }
}

/**
 * Restore a menu to previous state
 */
function restoreMenu(menuId, data) {
  const db = getDb();
  if (data.name !== undefined) {
    db.prepare('UPDATE menus SET name = ?, description = ? WHERE id = ?')
      .run(data.name, data.description || '', menuId);
  }
}

/**
 * Restore a task to previous state
 */
function restoreTask(taskId, data) {
  const db = getDb();
  if (data.title !== undefined) {
    db.prepare(
      'UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, due_time = ? WHERE id = ?'
    ).run(data.title, data.description || '', data.priority || 'medium', data.due_date || null, data.due_time || null, taskId);
  }
}

/**
 * Clean up old snapshots (> 24 hours)
 */
function cleanupOldSnapshots() {
  const db = getDb();
  const result = db.prepare(
    "DELETE FROM ai_history WHERE created_at < datetime('now', '-1 day')"
  ).run();
  return result.changes;
}

module.exports = {
  saveSnapshot,
  getSnapshot,
  restoreSnapshot,
  cleanupOldSnapshots,
};
