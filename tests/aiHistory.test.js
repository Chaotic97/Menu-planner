'use strict';

/**
 * Unit tests for services/ai/aiHistory.js
 * Tests snapshot save/restore/cleanup logic.
 */

const { createTestApp } = require('./helpers/setupTestApp');

let db, cleanup;

beforeAll(async () => {
  // Clear cached modules
  try { delete require.cache[require.resolve('../services/ai/aiHistory')]; } catch {}

  const ctx = await createTestApp();
  db = ctx.db;
  cleanup = ctx.cleanup;
});

afterAll(async () => await cleanup());

// Re-require after DB is patched
function getHistory() {
  delete require.cache[require.resolve('../services/ai/aiHistory')];
  return require('../services/ai/aiHistory');
}

describe('saveSnapshot', () => {
  test('saves a create snapshot and returns history ID', async () => {
    const { saveSnapshot } = getHistory();
    const id = await saveSnapshot('menu', 1, 'create', null);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  test('saves an update snapshot with previous data', async () => {
    const { saveSnapshot } = getHistory();
    const previousData = { name: 'Old Menu', description: 'Old description' };
    const id = await saveSnapshot('menu', 1, 'update', previousData);
    expect(id).toBeGreaterThan(0);

    // Verify data was serialized
    const row = await db.prepare('SELECT * FROM ai_history WHERE id = ?').get(id);
    expect(row.previous_data).toBe(JSON.stringify(previousData));
  });
});

describe('getSnapshot', () => {
  test('returns snapshot by ID with parsed previous_data', async () => {
    const { saveSnapshot, getSnapshot } = getHistory();
    const data = { name: 'Test', directions: [{ type: 'step', text: 'Do something' }] };
    const id = await saveSnapshot('dish', 42, 'update', data);

    const snapshot = await getSnapshot(id);
    expect(snapshot).toBeDefined();
    expect(snapshot.entity_type).toBe('dish');
    expect(snapshot.entity_id).toBe(42);
    expect(snapshot.previous_data).toEqual(data);
  });

  test('returns null for nonexistent ID', async () => {
    const { getSnapshot } = getHistory();
    expect(await getSnapshot(99999)).toBeNull();
  });
});

describe('restoreSnapshot', () => {
  test('undoes a menu create by soft-deleting', async () => {
    const { saveSnapshot, restoreSnapshot } = getHistory();

    // Create a menu
    const menuResult = await db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run('Undo Me', '');
    const menuId = menuResult.lastInsertRowid;

    const undoId = await saveSnapshot('menu', menuId, 'create', null);

    const broadcastCalls = [];
    const broadcast = (type, payload) => broadcastCalls.push({ type, payload });

    const result = await restoreSnapshot(undoId, broadcast);
    expect(result.success).toBe(true);

    // Menu should be soft-deleted
    const menu = await db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
    expect(menu).toBeUndefined();

    expect(broadcastCalls.some(b => b.type === 'menu_deleted')).toBe(true);
  });

  test('undoes a task create by hard-deleting', async () => {
    const { saveSnapshot, restoreSnapshot } = getHistory();

    const taskResult = await db.prepare(
      "INSERT INTO tasks (title, type, priority, source) VALUES (?, ?, ?, ?)"
    ).run('Delete Me', 'custom', 'medium', 'manual');
    const taskId = taskResult.lastInsertRowid;

    const undoId = await saveSnapshot('task', taskId, 'create', null);

    const result = await restoreSnapshot(undoId);
    expect(result.success).toBe(true);

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    expect(task).toBeUndefined();
  });

  test('undoes a dish update by restoring previous data', async () => {
    const { saveSnapshot, restoreSnapshot } = getHistory();

    // Create a dish
    const dishResult = await db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Original', 'Original desc', 'main');
    const dishId = dishResult.lastInsertRowid;

    // Save snapshot of original state
    const previousData = { name: 'Original', description: 'Original desc', category: 'main', chefs_notes: '' };
    const undoId = await saveSnapshot('dish', dishId, 'update', previousData);

    // Simulate AI changing the dish
    await db.prepare('UPDATE dishes SET name = ?, description = ? WHERE id = ?').run('Modified', 'Modified desc', dishId);

    // Undo
    const result = await restoreSnapshot(undoId);
    expect(result.success).toBe(true);

    const dish = await db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    expect(dish.name).toBe('Original');
    expect(dish.description).toBe('Original desc');
  });

  test('undoes a dish update restoring directions', async () => {
    const { saveSnapshot, restoreSnapshot } = getHistory();

    const dishResult = await db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Dir Dish', '', 'main');
    const dishId = dishResult.lastInsertRowid;

    // Add original directions
    await db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(dishId, 'step', 'Original step 1', 0);
    await db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(dishId, 'step', 'Original step 2', 1);

    const originalDirs = [
      { type: 'step', text: 'Original step 1', sort_order: 0 },
      { type: 'step', text: 'Original step 2', sort_order: 1 },
    ];

    const undoId = await saveSnapshot('dish', dishId, 'update', { directions: originalDirs });

    // Simulate AI replacing directions
    await db.prepare('DELETE FROM dish_directions WHERE dish_id = ?').run(dishId);
    await db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(dishId, 'step', 'New step', 0);

    // Undo
    await restoreSnapshot(undoId);

    const dirs = await db.prepare('SELECT * FROM dish_directions WHERE dish_id = ? ORDER BY sort_order').all(dishId);
    expect(dirs).toHaveLength(2);
    expect(dirs[0].text).toBe('Original step 1');
    expect(dirs[1].text).toBe('Original step 2');
  });

  test('returns failure for nonexistent snapshot', async () => {
    const { restoreSnapshot } = getHistory();
    const result = await restoreSnapshot(99999);
    expect(result.success).toBe(false);
  });
});

describe('cleanupOldSnapshots', () => {
  test('removes snapshots older than 24 hours', async () => {
    const { cleanupOldSnapshots } = getHistory();

    // Insert an old snapshot
    await db.prepare(
      "INSERT INTO ai_history (entity_type, entity_id, action_type, created_at) VALUES (?, ?, ?, NOW() - INTERVAL '2 days')"
    ).run('menu', 1, 'create');

    const deleted = await cleanupOldSnapshots();
    expect(deleted).toBeGreaterThanOrEqual(1);
  });
});
