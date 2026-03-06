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

  if (action_type === 'delete' && previous_data) {
    // Undo a delete = restore the entity from snapshot
    if (entity_type === 'dish') {
      db.prepare('UPDATE dishes SET deleted_at = NULL WHERE id = ?').run(entity_id);
      if (broadcast) broadcast('dish_created', { id: entity_id });
    } else if (entity_type === 'menu') {
      db.prepare('UPDATE menus SET deleted_at = NULL WHERE id = ?').run(entity_id);
      if (broadcast) broadcast('menu_created', { id: entity_id });
    } else if (entity_type === 'task') {
      // Task was hard-deleted, re-insert from snapshot
      db.prepare(
        'INSERT INTO tasks (id, menu_id, source_dish_id, type, title, description, priority, due_date, due_time, completed, completed_at, source, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        previous_data.id, previous_data.menu_id || null, previous_data.source_dish_id || null,
        previous_data.type || 'custom', previous_data.title, previous_data.description || '',
        previous_data.priority || 'medium', previous_data.due_date || null, previous_data.due_time || null,
        previous_data.completed || 0, previous_data.completed_at || null,
        previous_data.source || 'manual', previous_data.sort_order || 0
      );
      if (broadcast) broadcast('task_created', { id: entity_id });
    } else if (entity_type === 'service_note') {
      db.prepare(
        'INSERT INTO service_notes (id, date, shift, title, content) VALUES (?, ?, ?, ?, ?)'
      ).run(
        previous_data.id, previous_data.date, previous_data.shift || 'all',
        previous_data.title, previous_data.content || ''
      );
      if (broadcast) broadcast('service_note_created', { id: entity_id });
    }
    return { success: true, message: `Undone: ${entity_type} restored` };
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
 * Restore a dish to previous state (all saved fields + directions)
 */
function restoreDish(dishId, data) {
  const db = getDb();

  // Restore all snapshotted fields
  if (data.name !== undefined) {
    db.prepare(
      'UPDATE dishes SET name = ?, description = ?, category = ?, chefs_notes = ?, suggested_price = ?, batch_yield = ?, is_favorite = ? WHERE id = ?'
    ).run(
      data.name, data.description || '', data.category || '', data.chefs_notes || '',
      data.suggested_price ?? null, data.batch_yield ?? 1, data.is_favorite ?? 0, dishId
    );
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
 * Restore a menu to previous state (all saved fields)
 */
function restoreMenu(menuId, data) {
  const db = getDb();
  if (data.name !== undefined) {
    db.prepare(
      'UPDATE menus SET name = ?, description = ?, sell_price = ?, expected_covers = ?, guest_allergies = ?, menu_type = ?, event_date = ? WHERE id = ?'
    ).run(
      data.name, data.description || '', data.sell_price ?? null,
      data.expected_covers ?? null, data.guest_allergies || '',
      data.menu_type || 'event', data.event_date || null, menuId
    );
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
