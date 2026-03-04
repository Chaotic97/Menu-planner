'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

// Shared mock for Anthropic SDK — all instances share the same messages.create mock
const mockMessagesCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  }));
});

const request = require('supertest');
const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, db, broadcasts, cleanup, agent;

beforeAll(async () => {
  // Clear cached AI modules so they pick up the test DB
  const aiModules = [
    '../../routes/ai',
    '../../services/ai/aiService',
    '../../services/ai/aiTools',
    '../../services/ai/aiContext',
    '../../services/ai/aiHistory',
  ];
  for (const mod of aiModules) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }

  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  broadcasts = ctx.broadcasts;
  cleanup = ctx.cleanup;

  // Create ai_history and ai_usage tables (in case test app doesn't have them yet)
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
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      model TEXT NOT NULL,
      tool_used TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at)');
  } catch {}

  // Mount AI routes on the test app (before the error handler)
  const aiRoutes = require('../../routes/ai');
  app.use('/api/ai', aiRoutes);

  // Re-add error handler after AI routes so it catches AI errors
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  agent = await loginAgent(app);
});

afterAll(() => cleanup());

beforeEach(() => {
  broadcasts.length = 0;
  mockMessagesCreate.mockReset();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function setApiKey(key = 'sk-ant-test-key-12345') {
  const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('ai_api_key');
  if (existing) {
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(key, 'ai_api_key');
  } else {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai_api_key', key);
  }
}

function clearApiKey() {
  db.prepare("DELETE FROM settings WHERE key = 'ai_api_key'").run();
}

function createTestDish(name = 'Test Dish') {
  const result = db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run(name, 'A test dish', 'main');
  return result.lastInsertRowid;
}

function createTestMenu(name = 'Test Menu') {
  const result = db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run(name, 'A test menu');
  return result.lastInsertRowid;
}

function addDirections(dishId, steps) {
  for (let i = 0; i < steps.length; i++) {
    db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(
      dishId, steps[i].type || 'step', steps[i].text, i
    );
  }
}

// ─── SETTINGS ───────────────────────────────────────────────────────────────

describe('GET /api/ai/settings', () => {
  test('returns default settings when no API key is configured', async () => {
    clearApiKey();
    const res = await agent.get('/api/ai/settings').expect(200);

    expect(res.body.hasApiKey).toBe(false);
    expect(res.body.apiKey).toBe('');
    expect(res.body.features).toEqual({ cleanup: true, matching: true, allergens: true, scaling: true });
    expect(res.body.dailyLimit).toBe(0);
    expect(res.body.monthlyLimit).toBe(0);
  });

  test('returns masked API key when configured', async () => {
    setApiKey('sk-ant-api03-very-long-key-here-1234');
    const res = await agent.get('/api/ai/settings').expect(200);

    expect(res.body.hasApiKey).toBe(true);
    expect(res.body.apiKey).toMatch(/^sk-ant-api/);
    expect(res.body.apiKey).toMatch(/1234$/);
    // Key should be masked in the middle
    expect(res.body.apiKey).toContain('...');
  });
});

describe('POST /api/ai/settings', () => {
  test('saves a valid API key', async () => {
    const res = await agent
      .post('/api/ai/settings')
      .send({ apiKey: 'sk-ant-new-key-5678' })
      .expect(200);

    expect(res.body.success).toBe(true);

    // Verify it persisted
    const check = await agent.get('/api/ai/settings').expect(200);
    expect(check.body.hasApiKey).toBe(true);
  });

  test('rejects an invalid API key format', async () => {
    const res = await agent
      .post('/api/ai/settings')
      .send({ apiKey: 'invalid-key-format' })
      .expect(400);

    expect(res.body.error).toMatch(/invalid api key/i);
  });

  test('clears API key when empty string is sent', async () => {
    setApiKey();
    const res = await agent
      .post('/api/ai/settings')
      .send({ apiKey: '' })
      .expect(200);

    expect(res.body.success).toBe(true);

    const check = await agent.get('/api/ai/settings').expect(200);
    expect(check.body.hasApiKey).toBe(false);
  });

  test('saves feature toggles', async () => {
    const features = { cleanup: false, matching: true, allergens: true, scaling: false };
    await agent
      .post('/api/ai/settings')
      .send({ features })
      .expect(200);

    const check = await agent.get('/api/ai/settings').expect(200);
    expect(check.body.features).toEqual(features);
  });

  test('saves daily and monthly limits', async () => {
    await agent
      .post('/api/ai/settings')
      .send({ dailyLimit: 50, monthlyLimit: 500 })
      .expect(200);

    const check = await agent.get('/api/ai/settings').expect(200);
    expect(check.body.dailyLimit).toBe(50);
    expect(check.body.monthlyLimit).toBe(500);
  });

  test('clamps negative limits to zero', async () => {
    await agent
      .post('/api/ai/settings')
      .send({ dailyLimit: -10, monthlyLimit: -5 })
      .expect(200);

    const check = await agent.get('/api/ai/settings').expect(200);
    expect(check.body.dailyLimit).toBe(0);
    expect(check.body.monthlyLimit).toBe(0);
  });
});

// ─── USAGE STATS ────────────────────────────────────────────────────────────

describe('GET /api/ai/usage', () => {
  test('returns zero stats when no usage exists', async () => {
    const res = await agent.get('/api/ai/usage').expect(200);

    expect(res.body.today).toBeDefined();
    expect(res.body.month).toBeDefined();
    expect(res.body.limits).toBeDefined();
    expect(res.body.today.requests).toBeGreaterThanOrEqual(0);
  });
});

// ─── COMMAND ENDPOINT ───────────────────────────────────────────────────────

describe('POST /api/ai/command', () => {
  test('returns needsSetup when no API key', async () => {
    clearApiKey();
    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'hello', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.needsSetup).toBe(true);
    expect(res.body.response).toMatch(/api key/i);
  });

  test('rejects empty message', async () => {
    setApiKey();
    const res = await agent
      .post('/api/ai/command')
      .send({ message: '', context: { page: '#/dishes' } })
      .expect(400);

    expect(res.body.error).toMatch(/message/i);
  });

  test('rejects missing message', async () => {
    setApiKey();
    const res = await agent
      .post('/api/ai/command')
      .send({ context: { page: '#/dishes' } })
      .expect(400);

    expect(res.body.error).toMatch(/message/i);
  });

  test('returns text response for non-tool AI reply', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Hello! How can I help?' }],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'hello', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.response).toBe('Hello! How can I help?');
    expect(res.body.confirmationId).toBeUndefined();
  });

  test('returns confirmation for tool call', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'I\'ll create that menu for you.' },
        { type: 'tool_use', id: 'call_1', name: 'create_menu', input: { name: 'Friday Dinner' } },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'create a menu called Friday Dinner', context: { page: '#/menus' } })
      .expect(200);

    expect(res.body.confirmationId).toBeDefined();
    expect(res.body.preview).toContain('Friday Dinner');
    expect(res.body.toolName).toBe('create_menu');
  });

  test('returns rate limited response when daily limit exceeded', async () => {
    setApiKey();

    // Set a very low daily limit
    db.prepare("DELETE FROM settings WHERE key = 'ai_daily_limit'").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_daily_limit', '1')").run();

    // Insert a usage record for today
    db.prepare(
      "INSERT INTO ai_usage (tokens_in, tokens_out, model, created_at) VALUES (100, 50, 'claude-haiku-4-5-20251001', datetime('now'))"
    ).run();

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'test', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.rateLimited).toBe(true);

    // Cleanup
    db.prepare("DELETE FROM settings WHERE key = 'ai_daily_limit'").run();
  });
});

// ─── CONFIRM ENDPOINT ───────────────────────────────────────────────────────

describe('POST /api/ai/confirm/:id', () => {
  test('returns 404 for unknown confirmation ID', async () => {
    const res = await agent
      .post('/api/ai/confirm/nonexistent123')
      .expect(404);

    expect(res.body.error).toMatch(/expired|not found/i);
  });

  test('executes create_menu tool on confirm', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_2', name: 'create_menu', input: { name: 'Saturday Brunch' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    // Step 1: Get confirmation ID
    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create menu Saturday Brunch', context: { page: '#/menus' } })
      .expect(200);

    const confirmId = cmdRes.body.confirmationId;
    expect(confirmId).toBeDefined();

    // Step 2: Confirm
    broadcasts.length = 0;
    const confirmRes = await agent
      .post(`/api/ai/confirm/${confirmId}`)
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    expect(confirmRes.body.entityType).toBe('menu');
    expect(confirmRes.body.entityId).toBeDefined();
    expect(confirmRes.body.undoId).toBeDefined();

    // Verify menu was created in DB
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(confirmRes.body.entityId);
    expect(menu).toBeDefined();
    expect(menu.name).toBe('Saturday Brunch');

    // Verify broadcast
    expect(broadcasts.some(b => b.type === 'menu_created')).toBe(true);
  });

  test('executes create_dish tool on confirm', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_3', name: 'create_dish', input: { name: 'Grilled Salmon', category: 'main' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create dish grilled salmon', context: { page: '#/dishes' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(confirmRes.body.entityId);
    expect(dish.name).toBe('Grilled Salmon');
    expect(dish.category).toBe('main');
  });

  test('executes create_task tool on confirm', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_4', name: 'create_task', input: { title: 'Call fish supplier', priority: 'high' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'remind me to call the fish supplier', context: { page: '#/todos' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(confirmRes.body.entityId);
    expect(task.title).toBe('Call fish supplier');
    expect(task.priority).toBe('high');
  });

  test('executes add_service_note tool on confirm', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use', id: 'call_5', name: 'add_service_note',
          input: { title: 'VIP table tonight', content: 'Table 5 has a nut allergy', shift: 'pm' },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'add a note about VIP table', context: { page: '#/service-notes' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    expect(confirmRes.body.success).toBe(true);
    const note = db.prepare('SELECT * FROM service_notes WHERE id = ?').get(confirmRes.body.entityId);
    expect(note.title).toBe('VIP table tonight');
    expect(note.shift).toBe('pm');
  });

  test('confirmation ID cannot be reused', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_6', name: 'create_menu', input: { name: 'Reuse Test' } },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create menu reuse test', context: { page: '#/menus' } })
      .expect(200);

    const confirmId = cmdRes.body.confirmationId;

    // First confirm succeeds
    await agent.post(`/api/ai/confirm/${confirmId}`).expect(200);

    // Second confirm fails (already consumed)
    await agent.post(`/api/ai/confirm/${confirmId}`).expect(404);
  });
});

// ─── UNDO ENDPOINT ──────────────────────────────────────────────────────────

describe('POST /api/ai/undo/:id', () => {
  test('returns 400 for invalid undo ID', async () => {
    await agent.post('/api/ai/undo/abc').expect(400);
  });

  test('returns 404 for nonexistent undo ID', async () => {
    await agent.post('/api/ai/undo/99999').expect(404);
  });

  test('undoes a menu creation (soft-deletes it)', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_7', name: 'create_menu', input: { name: 'Undo Test Menu' } },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create menu for undo test', context: { page: '#/menus' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    const menuId = confirmRes.body.entityId;
    const undoId = confirmRes.body.undoId;

    // Menu exists
    let menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
    expect(menu).toBeDefined();

    // Undo
    broadcasts.length = 0;
    const undoRes = await agent
      .post(`/api/ai/undo/${undoId}`)
      .expect(200);

    expect(undoRes.body.success).toBe(true);

    // Menu is now soft-deleted
    menu = db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
    expect(menu).toBeUndefined();

    // Broadcast fired
    expect(broadcasts.some(b => b.type === 'menu_deleted')).toBe(true);
  });

  test('undoes a dish creation', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_8', name: 'create_dish', input: { name: 'Undo Dish' } },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create dish for undo', context: { page: '#/dishes' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    const dishId = confirmRes.body.entityId;

    await agent.post(`/api/ai/undo/${confirmRes.body.undoId}`).expect(200);

    const dish = db.prepare('SELECT * FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
    expect(dish).toBeUndefined();
  });

  test('undoes a task creation (hard-deletes it)', async () => {
    setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_9', name: 'create_task', input: { title: 'Undo Task' } },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create task for undo', context: { page: '#/todos' } })
      .expect(200);

    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    const taskId = confirmRes.body.entityId;

    await agent.post(`/api/ai/undo/${confirmRes.body.undoId}`).expect(200);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    expect(task).toBeUndefined();
  });
});

// ─── CLEANUP RECIPE ─────────────────────────────────────────────────────────

describe('POST /api/ai/cleanup-recipe/:dishId', () => {
  test('returns 400 for invalid dish ID', async () => {
    setApiKey();
    await agent.post('/api/ai/cleanup-recipe/abc').expect(400);
  });

  test('returns 400 when no API key', async () => {
    clearApiKey();
    await agent.post('/api/ai/cleanup-recipe/1').expect(400);
  });

  test('returns 404 for nonexistent dish', async () => {
    setApiKey();
    await agent.post('/api/ai/cleanup-recipe/99999').expect(404);
  });

  test('returns 400 when dish has no directions', async () => {
    setApiKey();
    const dishId = createTestDish('No Directions Dish');
    await agent.post(`/api/ai/cleanup-recipe/${dishId}`).expect(400);
  });

  test('returns before/after diff and confirmationId', async () => {
    setApiKey();
    const dishId = createTestDish('Cleanup Test Dish');
    addDirections(dishId, [
      { type: 'step', text: 'chop the onions real fine' },
      { type: 'step', text: 'put in pan with oil' },
    ]);

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify([
        { type: 'step', text: 'Brunoise the onions.' },
        { type: 'step', text: 'Sauté in oil over medium heat.' },
      ])}],
      usage: { input_tokens: 200, output_tokens: 100 },
    });

    const res = await agent
      .post(`/api/ai/cleanup-recipe/${dishId}`)
      .expect(200);

    expect(res.body.before).toBeInstanceOf(Array);
    expect(res.body.after).toBeInstanceOf(Array);
    expect(res.body.confirmationId).toBeDefined();
    expect(res.body.dishName).toBe('Cleanup Test Dish');
    expect(res.body.after).toHaveLength(2);
  });
});

// ─── MATCH INGREDIENTS ──────────────────────────────────────────────────────

describe('POST /api/ai/match-ingredients', () => {
  test('returns 400 for empty ingredients array', async () => {
    setApiKey();
    await agent
      .post('/api/ai/match-ingredients')
      .send({ ingredients: [] })
      .expect(400);
  });

  test('returns 400 for missing ingredients', async () => {
    setApiKey();
    await agent
      .post('/api/ai/match-ingredients')
      .send({})
      .expect(400);
  });

  test('returns 400 when no API key', async () => {
    clearApiKey();
    await agent
      .post('/api/ai/match-ingredients')
      .send({ ingredients: [{ name: 'butter' }] })
      .expect(400);
  });

  test('returns matches from AI', async () => {
    setApiKey();

    // Create an ingredient in DB to match against
    db.prepare('INSERT OR IGNORE INTO ingredients (name, unit_cost, base_unit) VALUES (?, ?, ?)').run('Butter', 0.5, 'kg');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify([
        { input_name: 'unsalted butter', matched_id: 1, matched_name: 'Butter', confidence: 'high' },
      ])}],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await agent
      .post('/api/ai/match-ingredients')
      .send({ ingredients: [{ name: 'unsalted butter' }] })
      .expect(200);

    expect(res.body.matches).toBeInstanceOf(Array);
    expect(res.body.matches[0].input_name).toBe('unsalted butter');
    expect(res.body.matches[0].confidence).toBe('high');
  });
});

// ─── SEARCH DISHES TOOL ─────────────────────────────────────────────────────

describe('search_dishes tool (via command)', () => {
  test('returns matching dishes', async () => {
    setApiKey();
    createTestDish('Pasta Carbonara');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_10', name: 'search_dishes', input: { query: 'Pasta' } },
      ],
      usage: { input_tokens: 80, output_tokens: 30 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'search for pasta', context: { page: '#/dishes' } })
      .expect(200);

    // search_dishes returns a preview with the results
    expect(res.body.preview).toContain('Pasta');
  });
});

// ─── ADD DISH TO MENU TOOL ──────────────────────────────────────────────────

describe('add_dish_to_menu tool (via command + confirm)', () => {
  test('adds a dish to a menu with fuzzy matching', async () => {
    setApiKey();
    const dishId = createTestDish('Truffle Risotto');
    const menuId = createTestMenu('Evening Service');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use', id: 'call_11', name: 'add_dish_to_menu',
          input: { dish_name: 'Truffle', menu_name: 'Evening', servings: 2 },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 40 },
    });

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'add truffle to evening menu', context: { page: '#/menus' } })
      .expect(200);

    expect(cmdRes.body.confirmationId).toBeDefined();
    expect(cmdRes.body.preview).toContain('Truffle Risotto');
    expect(cmdRes.body.preview).toContain('Evening Service');

    // Confirm
    const confirmRes = await agent
      .post(`/api/ai/confirm/${cmdRes.body.confirmationId}`)
      .expect(200);

    expect(confirmRes.body.success).toBe(true);

    // Verify in DB
    const link = db.prepare('SELECT * FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').get(menuId, dishId);
    expect(link).toBeDefined();
    expect(link.servings).toBe(2);
  });
});

// ─── AUTH REQUIRED ──────────────────────────────────────────────────────────

describe('AI endpoints require authentication', () => {
  test('unauthenticated request to /api/ai/command returns 401', async () => {
    await request(app)
      .post('/api/ai/command')
      .send({ message: 'test', context: { page: '#/' } })
      .expect(401);
  });

  test('unauthenticated request to /api/ai/settings returns 401', async () => {
    await request(app)
      .get('/api/ai/settings')
      .expect(401);
  });
});
