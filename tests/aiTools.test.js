'use strict';

/**
 * Unit tests for services/ai/aiTools.js
 * Tests tool definitions and handler preview/execute paths.
 */

jest.mock('../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const { createTestApp } = require('./helpers/setupTestApp');

let db, cleanup;

beforeAll(async () => {
  try { delete require.cache[require.resolve('../services/ai/aiTools')]; } catch {}
  try { delete require.cache[require.resolve('../services/ai/aiHistory')]; } catch {}

  const ctx = await createTestApp();
  db = ctx.db;
  cleanup = ctx.cleanup;

  // Ensure required tables
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action_type TEXT NOT NULL,
      previous_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch {}
});

afterAll(() => cleanup());

function getTools() {
  delete require.cache[require.resolve('../services/ai/aiTools')];
  delete require.cache[require.resolve('../services/ai/aiHistory')];
  return require('../services/ai/aiTools');
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

describe('getToolDefinitions', () => {
  test('returns all 50 tools', () => {
    const { getToolDefinitions } = getTools();
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(50);
  });

  test('each tool has name, description, and input_schema', () => {
    const { getToolDefinitions } = getTools();
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeDefined();
      expect(typeof tool.description).toBe('string');
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe('object');
    }
  });

  test('includes expected tool names', () => {
    const { getToolDefinitions } = getTools();
    const names = getToolDefinitions().map(t => t.name);
    expect(names).toContain('create_menu');
    expect(names).toContain('create_dish');
    expect(names).toContain('create_task');
    expect(names).toContain('add_dish_to_menu');
    expect(names).toContain('cleanup_recipe');
    expect(names).toContain('check_allergens');
    expect(names).toContain('scale_recipe');
    expect(names).toContain('convert_units');
    expect(names).toContain('add_service_note');
    expect(names).toContain('search_dishes');
    expect(names).toContain('lookup_dish');
    expect(names).toContain('lookup_menu');
    expect(names).toContain('search_ingredients');
    expect(names).toContain('search_tasks');
    expect(names).toContain('search_service_notes');
    expect(names).toContain('get_shopping_list');
    expect(names).toContain('get_system_summary');
  });
});

// ─── isAutoApproved ─────────────────────────────────────────────────────────

describe('isAutoApproved', () => {
  test('returns true for auto-approved tools', () => {
    const { isAutoApproved } = getTools();
    expect(isAutoApproved('search_dishes')).toBe(true);
    expect(isAutoApproved('create_task')).toBe(true);
    expect(isAutoApproved('add_service_note')).toBe(true);
    expect(isAutoApproved('lookup_dish')).toBe(true);
    expect(isAutoApproved('get_system_summary')).toBe(true);
  });

  test('returns false for tools requiring confirmation', () => {
    const { isAutoApproved } = getTools();
    expect(isAutoApproved('create_menu')).toBe(false);
    expect(isAutoApproved('create_dish')).toBe(false);
    expect(isAutoApproved('add_dish_to_menu')).toBe(false);
    expect(isAutoApproved('cleanup_recipe')).toBe(false);
  });

  test('returns false for unknown tools', () => {
    const { isAutoApproved } = getTools();
    expect(isAutoApproved('nonexistent')).toBe(false);
  });
});

// ─── Handler: create_menu ───────────────────────────────────────────────────

describe('create_menu handler', () => {
  test('preview returns description with menu name', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_menu', { name: 'Lunch Special' }, { preview: true });
    expect(result.description).toContain('Lunch Special');
    expect(result.message).toBeDefined();
  });

  test('preview includes event date when provided', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_menu', { name: 'Wedding', event_date: '2026-06-15' }, { preview: true });
    expect(result.description).toContain('Wedding');
    expect(result.description).toContain('2026-06-15');
    expect(result.message).toContain('2026-06-15');
  });

  test('execute creates a menu in the database', () => {
    const { executeToolHandler } = getTools();
    const broadcasts = [];
    const broadcast = (type, payload) => broadcasts.push({ type, payload });

    const result = executeToolHandler('create_menu', { name: 'AI Menu', description: 'Created by AI' }, { preview: false, broadcast });

    expect(result.success).toBe(true);
    expect(result.entityType).toBe('menu');
    expect(result.undoId).toBeDefined();

    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(result.entityId);
    expect(menu.name).toBe('AI Menu');
    expect(menu.menu_type).toBe('event');
    expect(broadcasts.some(b => b.type === 'menu_created')).toBe(true);
  });

  test('execute creates a menu with event_date', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_menu',
      { name: 'Gala Dinner', event_date: '2026-04-20', description: 'Annual gala' },
      { preview: false, broadcast: () => {} }
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('2026-04-20');

    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(result.entityId);
    expect(menu.name).toBe('Gala Dinner');
    expect(menu.event_date).toBe('2026-04-20');
    expect(menu.menu_type).toBe('event');
  });

  test('execute creates a standard (house) menu', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_menu',
      { name: 'House Menu', menu_type: 'standard' },
      { preview: false, broadcast: () => {} }
    );

    expect(result.success).toBe(true);
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(result.entityId);
    expect(menu.menu_type).toBe('standard');
    expect(menu.event_date).toBeNull();
  });

  test('rejects invalid event_date format', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_menu',
      { name: 'Bad Date', event_date: 'March 15' },
      { preview: false, broadcast: () => {} }
    );

    expect(result.message).toContain('YYYY-MM-DD');
    expect(result.success).toBeUndefined();
  });
});

// ─── Handler: create_dish ───────────────────────────────────────────────────

describe('create_dish handler', () => {
  test('preview includes dish name and category', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_dish', { name: 'Risotto', category: 'main' }, { preview: true });
    expect(result.description).toContain('Risotto');
    expect(result.description).toContain('main');
  });

  test('execute creates a dish', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_dish', { name: 'AI Risotto', category: 'starter' }, { preview: false });

    expect(result.success).toBe(true);
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(result.entityId);
    expect(dish.name).toBe('AI Risotto');
    expect(dish.category).toBe('starter');
  });
});

// ─── Handler: create_task ───────────────────────────────────────────────────

describe('create_task handler', () => {
  test('preview shows task title', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_task', { title: 'Order supplies' }, { preview: true });
    expect(result.description).toContain('Order supplies');
  });

  test('preview shows priority when non-default', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_task', { title: 'Urgent thing', priority: 'high' }, { preview: true });
    expect(result.description).toContain('high');
  });

  test('execute creates a task with defaults', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('create_task', { title: 'Test Task' }, { preview: false });

    expect(result.success).toBe(true);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.entityId);
    expect(task.title).toBe('Test Task');
    expect(task.priority).toBe('medium');
    expect(task.type).toBe('custom');
    expect(task.source).toBe('manual');
  });
});

// ─── Handler: add_dish_to_menu ──────────────────────────────────────────────

describe('add_dish_to_menu handler', () => {
  let testDishId, testMenuId;

  beforeAll(() => {
    const dishResult = db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Fuzzy Match Dish', '', 'main');
    testDishId = dishResult.lastInsertRowid;
    const menuResult = db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run('Fuzzy Match Menu', '');
    testMenuId = menuResult.lastInsertRowid;
  });

  test('resolves dish and menu by fuzzy name match', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('add_dish_to_menu', { dish_name: 'Fuzzy Match', menu_name: 'Fuzzy Match' }, { preview: true });
    expect(result.description).toContain('Fuzzy Match Dish');
    expect(result.description).toContain('Fuzzy Match Menu');
  });

  test('returns error when dish not found', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('add_dish_to_menu', { dish_name: 'Nonexistent Dish XYZ' }, { preview: true });
    expect(result.message).toMatch(/couldn.*find/i);
  });

  test('execute adds dish to menu', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('add_dish_to_menu',
      { dish_id: testDishId, menu_id: testMenuId, servings: 3 },
      { preview: false, broadcast: () => {} }
    );

    expect(result.success).toBe(true);
    const link = db.prepare('SELECT * FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').get(testMenuId, testDishId);
    expect(link).toBeDefined();
    expect(link.servings).toBe(3);
  });

  test('rejects adding duplicate dish to menu', () => {
    const { executeToolHandler } = getTools();
    // Already added above
    const result = executeToolHandler('add_dish_to_menu',
      { dish_id: testDishId, menu_id: testMenuId },
      { preview: false, broadcast: () => {} }
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already/i);
  });
});

// ─── Handler: search_dishes ─────────────────────────────────────────────────

describe('search_dishes handler', () => {
  test('finds matching dishes', () => {
    db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Chocolate Cake', 'Rich dark chocolate', 'dessert');

    const { executeToolHandler } = getTools();
    const result = executeToolHandler('search_dishes', { query: 'Chocolate' }, { preview: true });
    expect(result.message).toContain('Chocolate Cake');
  });

  test('returns no results message for unmatched query', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('search_dishes', { query: 'zzz_nonexistent_zzz' }, { preview: true });
    expect(result.message).toMatch(/no dishes found/i);
  });
});

// ─── Handler: convert_units ─────────────────────────────────────────────────

describe('convert_units handler', () => {
  test('preview shows conversion description', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('convert_units', { from_quantity: 250, from_unit: 'ml', to_unit: 'cups', ingredient_name: 'milk' }, { preview: true });
    expect(result.description).toContain('250');
    expect(result.description).toContain('ml');
    expect(result.description).toContain('milk');
  });
});

// ─── Handler: add_service_note ──────────────────────────────────────────────

describe('add_service_note handler', () => {
  test('preview shows note title', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('add_service_note', { title: 'VIP Alert', content: 'Peanut allergy table 5' }, { preview: true });
    expect(result.description).toContain('VIP Alert');
  });

  test('execute creates a service note', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('add_service_note',
      { title: 'Staff Note', content: 'Short on parsley', shift: 'am' },
      { preview: false, broadcast: () => {} }
    );

    expect(result.success).toBe(true);
    const note = db.prepare('SELECT * FROM service_notes WHERE id = ?').get(result.entityId);
    expect(note.title).toBe('Staff Note');
    expect(note.shift).toBe('am');
  });
});

// ─── Handler: lookup_dish ────────────────────────────────────────────────────

describe('lookup_dish handler', () => {
  test('returns dish details by ID', () => {
    const dish = db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Lookup Test', 'desc', 'main');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('lookup_dish', { dish_id: dish.lastInsertRowid }, { preview: false });
    expect(result.message).toContain('Lookup Test');
    expect(result.message).toContain('main');
  });

  test('returns dish details by fuzzy name', () => {
    db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run('Fuzzy Lookup Dish', '', 'dessert');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('lookup_dish', { dish_name: 'Fuzzy Lookup' }, { preview: false });
    expect(result.message).toContain('Fuzzy Lookup Dish');
  });

  test('returns not found for missing dish', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('lookup_dish', { dish_id: 99999 }, { preview: false });
    expect(result.message).toMatch(/not found/i);
  });
});

// ─── Handler: lookup_menu ────────────────────────────────────────────────────

describe('lookup_menu handler', () => {
  test('returns menu details by ID', () => {
    const menu = db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run('Lookup Menu Test', 'A test');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('lookup_menu', { menu_id: menu.lastInsertRowid }, { preview: false });
    expect(result.message).toContain('Lookup Menu Test');
  });

  test('includes event_date and menu_type in output', () => {
    const menu = db.prepare(
      "INSERT INTO menus (name, description, menu_type, event_date) VALUES (?, ?, ?, ?)"
    ).run('Dated Event', 'With date', 'event', '2026-05-01');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('lookup_menu', { menu_id: menu.lastInsertRowid }, { preview: false });
    expect(result.message).toContain('Dated Event');
    expect(result.message).toContain('event');
    expect(result.message).toContain('2026-05-01');
  });
});

// ─── Handler: search_ingredients ─────────────────────────────────────────────

describe('search_ingredients handler', () => {
  test('finds matching ingredients', () => {
    db.prepare('INSERT OR IGNORE INTO ingredients (name, unit_cost, base_unit) VALUES (?, ?, ?)').run('Paprika', 2.50, 'kg');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('search_ingredients', { query: 'Paprika' }, { preview: false });
    expect(result.message).toContain('Paprika');
  });

  test('returns no results for unmatched', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('search_ingredients', { query: 'zzz_no_ingredient_zzz' }, { preview: false });
    expect(result.message).toMatch(/no ingredients/i);
  });
});

// ─── Handler: search_tasks ───────────────────────────────────────────────────

describe('search_tasks handler', () => {
  test('finds matching tasks', () => {
    db.prepare('INSERT INTO tasks (title, type, priority, source) VALUES (?, ?, ?, ?)').run('Dice onions', 'prep', 'high', 'manual');
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('search_tasks', { query: 'onions' }, { preview: false });
    expect(result.message).toContain('Dice onions');
  });
});

// ─── Handler: get_system_summary ─────────────────────────────────────────────

describe('get_system_summary handler', () => {
  test('returns summary stats', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('get_system_summary', {}, { preview: false });
    expect(result.message).toContain('Dishes:');
    expect(result.message).toContain('Menus:');
    expect(result.message).toContain('Ingredients:');
    expect(result.message).toContain('Tasks:');
  });
});

// ─── Handler: unknown tool ──────────────────────────────────────────────────

describe('unknown tool handler', () => {
  test('returns error message for unknown tool', () => {
    const { executeToolHandler } = getTools();
    const result = executeToolHandler('nonexistent_tool', {}, { preview: true });
    expect(result.message).toMatch(/don.*know/i);
  });
});
