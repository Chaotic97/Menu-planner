'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

// Mock Vertex AI client — all instances share the same messages.create/stream mock
const mockMessagesCreate = jest.fn();
const mockMessagesStream = jest.fn();
jest.mock('../../services/ai/vertexClient', () => ({
  getClaudeClient: () => ({
    messages: {
      create: mockMessagesCreate,
      stream: mockMessagesStream,
    },
  }),
  isConfigured: () => true,
}));

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
    '../../services/ai/vertexClient',
  ];
  for (const mod of aiModules) {
    try { delete require.cache[require.resolve(mod)]; } catch {}
  }

  const ctx = await createTestApp();
  app = ctx.app;
  db = ctx.db;
  broadcasts = ctx.broadcasts;
  cleanup = ctx.cleanup;

  // Mount AI routes on the test app (before the error handler)
  const aiRoutes = require('../../routes/ai');
  app.use('/api/ai', aiRoutes);

  // Re-add error handler after AI routes so it catches AI errors
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  agent = await loginAgent(app);
});

afterAll(async () => await cleanup());

beforeEach(() => {
  broadcasts.length = 0;
  mockMessagesCreate.mockReset();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

// No-op: Vertex AI auth is via ADC (mocked by vertexClient mock above).
// Kept as stub so existing test calls don't break.
async function setApiKey() {}

async function createTestDish(name = 'Test Dish') {
  const result = await db.prepare('INSERT INTO dishes (name, description, category) VALUES (?, ?, ?)').run(name, 'A test dish', 'main');
  return result.lastInsertRowid;
}

async function createTestMenu(name = 'Test Menu') {
  const result = await db.prepare('INSERT INTO menus (name, description) VALUES (?, ?)').run(name, 'A test menu');
  return result.lastInsertRowid;
}

async function addDirections(dishId, steps) {
  for (let i = 0; i < steps.length; i++) {
    await db.prepare('INSERT INTO dish_directions (dish_id, type, text, sort_order) VALUES (?, ?, ?, ?)').run(
      dishId, steps[i].type || 'step', steps[i].text, i
    );
  }
}

/** Mock a follow-up text response from Haiku (used after auto-approved tool execution in the agentic loop) */
function mockFollowUpText(text = 'Done.') {
  mockMessagesCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 100, output_tokens: 30 },
  });
}

// ─── SETTINGS ───────────────────────────────────────────────────────────────

describe('GET /api/ai/settings', () => {
  test('returns default settings with configured status', async () => {
    const res = await agent.get('/api/ai/settings').expect(200);

    expect(res.body.configured).toBe(true);
    expect(res.body.features).toEqual({ cleanup: true, matching: true, allergens: true, scaling: true });
    expect(res.body.dailyLimit).toBe(0);
    expect(res.body.monthlyLimit).toBe(0);
  });
});

describe('POST /api/ai/settings', () => {
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
  test('rejects empty message', async () => {
    await setApiKey();
    const res = await agent
      .post('/api/ai/command')
      .send({ message: '', context: { page: '#/dishes' } })
      .expect(400);

    expect(res.body.error).toMatch(/message/i);
  });

  test('rejects missing message', async () => {
    await setApiKey();
    const res = await agent
      .post('/api/ai/command')
      .send({ context: { page: '#/dishes' } })
      .expect(400);

    expect(res.body.error).toMatch(/message/i);
  });

  test('returns text response for non-tool AI reply', async () => {
    await setApiKey();
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
    await setApiKey();
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
    await setApiKey();

    // Set a very low daily limit
    await db.prepare("DELETE FROM settings WHERE key = 'ai_daily_limit'").run();
    await db.prepare("INSERT INTO settings (key, value) VALUES ('ai_daily_limit', '1')").run();

    // Insert a usage record for today
    await db.prepare(
      "INSERT INTO ai_usage (tokens_in, tokens_out, model, created_at) VALUES (100, 50, 'claude-haiku-4-5-20251001', NOW())"
    ).run();

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'test', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.rateLimited).toBe(true);

    // Cleanup
    await db.prepare("DELETE FROM settings WHERE key = 'ai_daily_limit'").run();
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
    await setApiKey();
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
    const menu = await db.prepare('SELECT * FROM menus WHERE id = ?').get(confirmRes.body.entityId);
    expect(menu).toBeDefined();
    expect(menu.name).toBe('Saturday Brunch');

    // Verify broadcast
    expect(broadcasts.some(b => b.type === 'menu_created')).toBe(true);
  });

  test('executes create_dish tool on confirm', async () => {
    await setApiKey();
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
    const dish = await db.prepare('SELECT * FROM dishes WHERE id = ?').get(confirmRes.body.entityId);
    expect(dish.name).toBe('Grilled Salmon');
    expect(dish.category).toBe('main');
  });

  test('executes create_task tool (auto-approved)', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_4', name: 'create_task', input: { title: 'Call fish supplier', priority: 'high' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Task "Call fish supplier" created.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'remind me to call the fish supplier', context: { page: '#/todos' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Call fish supplier');

    // Task was created in DB
    const tasks = await db.prepare("SELECT * FROM tasks WHERE title = 'Call fish supplier'").all();
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].priority).toBe('high');
  });

  test('executes add_service_note tool (auto-approved)', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use', id: 'call_5', name: 'add_service_note',
          input: { title: 'VIP table tonight', content: 'Table 5 has a nut allergy', shift: 'pm' },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Service note created.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'add a note about VIP table', context: { page: '#/service-notes' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);

    const notes = await db.prepare("SELECT * FROM service_notes WHERE title = 'VIP table tonight'").all();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].shift).toBe('pm');
  });

  test('confirmation ID cannot be reused', async () => {
    await setApiKey();
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
    await setApiKey();
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
    let menu = await db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
    expect(menu).toBeDefined();

    // Undo
    broadcasts.length = 0;
    const undoRes = await agent
      .post(`/api/ai/undo/${undoId}`)
      .expect(200);

    expect(undoRes.body.success).toBe(true);

    // Menu is now soft-deleted
    menu = await db.prepare('SELECT * FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
    expect(menu).toBeUndefined();

    // Broadcast fired
    expect(broadcasts.some(b => b.type === 'menu_deleted')).toBe(true);
  });

  test('undoes a dish creation', async () => {
    await setApiKey();
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

    const dish = await db.prepare('SELECT * FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
    expect(dish).toBeUndefined();
  });

  test('undoes a task creation (hard-deletes it)', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_9', name: 'create_task', input: { title: 'Undo Task' } },
      ],
      usage: { input_tokens: 50, output_tokens: 20 },
    });
    mockFollowUpText('Task created.');

    const cmdRes = await agent
      .post('/api/ai/command')
      .send({ message: 'create task for undo', context: { page: '#/todos' } })
      .expect(200);

    expect(cmdRes.body.autoExecuted).toBe(true);
    // Find the undo ID from toolResults
    const undoId = cmdRes.body.undoId;
    expect(undoId).toBeDefined();

    // Find the task
    const tasks = await db.prepare("SELECT * FROM tasks WHERE title = 'Undo Task'").all();
    expect(tasks.length).toBeGreaterThan(0);
    const taskId = tasks[0].id;

    await agent.post(`/api/ai/undo/${undoId}`).expect(200);

    const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    expect(task).toBeUndefined();
  });
});

// ─── CLEANUP RECIPE ─────────────────────────────────────────────────────────

describe('POST /api/ai/cleanup-recipe/:dishId', () => {
  test('returns 400 for invalid dish ID', async () => {
    await setApiKey();
    await agent.post('/api/ai/cleanup-recipe/abc').expect(400);
  });

  test('returns 404 for nonexistent dish', async () => {
    await setApiKey();
    await agent.post('/api/ai/cleanup-recipe/99999').expect(404);
  });

  test('returns 400 when dish has no directions', async () => {
    await setApiKey();
    const dishId = await createTestDish('No Directions Dish');
    await agent.post(`/api/ai/cleanup-recipe/${dishId}`).expect(400);
  });

  test('returns before/after diff and confirmationId', async () => {
    await setApiKey();
    const dishId = await createTestDish('Cleanup Test Dish');
    await addDirections(dishId, [
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
    await setApiKey();
    await agent
      .post('/api/ai/match-ingredients')
      .send({ ingredients: [] })
      .expect(400);
  });

  test('returns 400 for missing ingredients', async () => {
    await setApiKey();
    await agent
      .post('/api/ai/match-ingredients')
      .send({})
      .expect(400);
  });

  test('returns matches from AI', async () => {
    await setApiKey();

    // Create an ingredient in DB to match against
    await db.prepare('INSERT INTO ingredients (name, unit_cost, base_unit) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING').run('Butter', 0.5, 'kg');

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
  test('returns matching dishes (auto-executed)', async () => {
    await setApiKey();
    await createTestDish('Pasta Carbonara');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_10', name: 'search_dishes', input: { query: 'Pasta' } },
      ],
      usage: { input_tokens: 80, output_tokens: 30 },
    });
    mockFollowUpText('Found Pasta Carbonara in your dishes.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'search for pasta', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Pasta');
  });
});

// ─── ADD DISH TO MENU TOOL ──────────────────────────────────────────────────

describe('add_dish_to_menu tool (via command + confirm)', () => {
  test('adds a dish to a menu with fuzzy matching', async () => {
    await setApiKey();
    const dishId = await createTestDish('Truffle Risotto');
    const menuId = await createTestMenu('Evening Service');

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
    const link = await db.prepare('SELECT * FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').get(menuId, dishId);
    expect(link).toBeDefined();
    expect(link.servings).toBe(2);
  });
});

// ─── AUTO-APPROVED READ-ONLY TOOLS ──────────────────────────────────────────

describe('auto-approved read-only tools (via command)', () => {
  test('lookup_dish returns dish details without confirmation', async () => {
    await setApiKey();
    const dishId = await createTestDish('Lookup Test Dish');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_20', name: 'lookup_dish', input: { dish_id: dishId } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Lookup Test Dish is a main course.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'tell me about lookup test dish', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Lookup Test Dish');
  });

  test('lookup_menu returns menu details without confirmation', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Lookup Test Menu');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_21', name: 'lookup_menu', input: { menu_id: menuId } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Lookup Test Menu has no dishes yet.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'what dishes are on lookup test menu', context: { page: '#/menus' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Lookup Test Menu');
  });

  test('search_ingredients returns matches without confirmation', async () => {
    await setApiKey();
    await db.prepare('INSERT INTO ingredients (name, unit_cost, base_unit) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING').run('Olive Oil', 1.50, 'L');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_22', name: 'search_ingredients', input: { query: 'Olive' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Yes, you have Olive Oil in stock.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'do we have olive oil', context: { page: '#/ingredients' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Olive');
  });

  test('search_tasks returns matches without confirmation', async () => {
    await setApiKey();
    await db.prepare('INSERT INTO tasks (title, type, priority, source) VALUES (?, ?, ?, ?)').run('Prep garlic', 'prep', 'medium', 'manual');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_23', name: 'search_tasks', input: { query: 'garlic' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Found a task: Prep garlic.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'any garlic tasks', context: { page: '#/todos' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('garlic');
  });

  test('get_system_summary returns stats without confirmation', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_24', name: 'get_system_summary', input: {} },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('You have several Dishes: and Menus: in the system.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'give me an overview', context: { page: '#/today' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Dishes:');
  });

  test('get_shopping_list returns list without confirmation', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Shopping List Menu');
    const dishId = await createTestDish('SL Test Dish');
    await db.prepare('INSERT INTO ingredients (name, unit_cost, base_unit) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING').run('Flour', 0.80, 'kg');
    const ing = await db.prepare("SELECT id FROM ingredients WHERE name = 'Flour'").get();
    await db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, quantity, unit, sort_order) VALUES (?, ?, ?, ?, ?)').run(dishId, ing.id, 2, 'kg', 0);
    await db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(menuId, dishId, 1, 0);

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_25', name: 'get_shopping_list', input: { menu_id: menuId } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Shopping list includes Flour.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'shopping list for menu', context: { page: '#/shopping' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Flour');
  });

  test('search_service_notes returns notes without confirmation', async () => {
    await setApiKey();
    const today = new Date().toISOString().slice(0, 10);
    await db.prepare('INSERT INTO service_notes (date, shift, title, content) VALUES (?, ?, ?, ?)').run(today, 'am', 'AM briefing', 'Staff meeting at 8am');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_26', name: 'search_service_notes', input: { date: today } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });
    mockFollowUpText('Found a note: AM briefing.');

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'any notes for today', context: { page: '#/service-notes' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('AM briefing');
  });
});

// ─── NON-AUTO-APPROVED TOOLS STILL NEED CONFIRMATION ────────────────────────

describe('non-auto-approved tools require confirmation', () => {
  test('create_menu requires confirmation', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_30', name: 'create_menu', input: { name: 'Confirm Test' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'create a menu called Confirm Test', context: { page: '#/menus' } })
      .expect(200);

    expect(res.body.confirmationId).toBeDefined();
    expect(res.body.autoExecuted).toBeUndefined();
  });

  test('create_dish requires confirmation', async () => {
    await setApiKey();
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'call_31', name: 'create_dish', input: { name: 'Confirm Dish', category: 'starter' } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'create a dish called Confirm Dish', context: { page: '#/dishes' } })
      .expect(200);

    expect(res.body.confirmationId).toBeDefined();
    expect(res.body.autoExecuted).toBeUndefined();
  });
});

// ─── TOOL CHAINING ──────────────────────────────────────────────────────────

describe('multi-step tool chaining', () => {
  test('chains two auto-approved tools and returns final answer', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Chain Test Menu');
    const dishId = await createTestDish('Chain Test Dish');
    await db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(menuId, dishId, 1, 0);

    // Round 1: Haiku calls lookup_menu
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Let me look up the menu first.' },
        { type: 'tool_use', id: 'chain_1', name: 'lookup_menu', input: { menu_id: menuId } },
      ],
      usage: { input_tokens: 80, output_tokens: 40 },
    });

    // Round 2: Haiku sees the result and gives final text answer
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'The Chain Test Menu has 1 dish: Chain Test Dish.' },
      ],
      usage: { input_tokens: 200, output_tokens: 60 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'tell me about chain test menu', context: { page: '#/menus' } })
      .expect(200);

    expect(res.body.autoExecuted).toBe(true);
    expect(res.body.response).toContain('Chain Test Menu');
    // Haiku was called twice (initial + after tool result)
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });

  test('stops chaining when non-auto-approved tool is called (needs confirmation)', async () => {
    await setApiKey();

    // Round 1: Haiku calls search_dishes (auto-approved) — executed immediately
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'chain_2', name: 'search_dishes', input: { query: 'zzz_no_risotto_zzz' } },
      ],
      usage: { input_tokens: 80, output_tokens: 30 },
    });

    // Round 2: Haiku sees empty results and wants to create_dish (needs confirmation)
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'No risotto found. I\'ll create one.' },
        { type: 'tool_use', id: 'chain_3', name: 'create_dish', input: { name: 'Mushroom Risotto', category: 'main' } },
      ],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    const res = await agent
      .post('/api/ai/command')
      .send({ message: 'find or create a risotto', context: { page: '#/dishes' } })
      .expect(200);

    // Should have a confirmation for create_dish
    expect(res.body.confirmationId).toBeDefined();
    expect(res.body.preview).toContain('Mushroom Risotto');
    // Haiku was called twice
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });
});

// ─── EXTRACT TEXT ENDPOINT ──────────────────────────────────────────────────

describe('POST /api/ai/extract-text', () => {
  test('returns 400 when no file uploaded', async () => {
    await agent.post('/api/ai/extract-text').expect(400);
  });

  test('extracts text from CSV file', async () => {
    const csv = 'Name,Qty\nFlour,500g\nButter,200g';
    const res = await agent
      .post('/api/ai/extract-text')
      .attach('file', Buffer.from(csv), 'ingredients.csv')
      .expect(200);

    expect(res.body.text).toContain('Flour');
    expect(res.body.type).toBe('text');
  });

  test('extracts text from plain text file', async () => {
    const text = 'Preheat oven to 180C. Mix dry ingredients.';
    const res = await agent
      .post('/api/ai/extract-text')
      .attach('file', Buffer.from(text), 'recipe.txt')
      .expect(200);

    expect(res.body.text).toBe(text);
  });

  test('returns 400 for unsupported file type', async () => {
    const res = await agent
      .post('/api/ai/extract-text')
      .attach('file', Buffer.from('data'), 'file.xyz')
      .expect(400);

    expect(res.body.error).toMatch(/unsupported/i);
  });
});

// ─── CHAT CONVERSATIONS ────────────────────────────────────────────────────

describe('chat conversations CRUD', () => {
  test('creates a conversation and lists it', async () => {
    const createRes = await agent
      .post('/api/ai/conversations')
      .send({ title: 'Test Chat' })
      .expect(201);

    expect(createRes.body.id).toBeDefined();

    const listRes = await agent.get('/api/ai/conversations').expect(200);
    const found = listRes.body.find(c => c.id === createRes.body.id);
    expect(found).toBeDefined();
    expect(found.title).toBe('Test Chat');
  });

  test('adds messages and retrieves them', async () => {
    const conv = await agent.post('/api/ai/conversations').send({}).expect(201);

    await agent
      .post(`/api/ai/conversations/${conv.body.id}/messages`)
      .send({ role: 'user', content: 'Hello AI' })
      .expect(201);

    await agent
      .post(`/api/ai/conversations/${conv.body.id}/messages`)
      .send({ role: 'assistant', content: 'Hello! How can I help?' })
      .expect(201);

    const msgs = await agent
      .get(`/api/ai/conversations/${conv.body.id}/messages`)
      .expect(200);

    expect(msgs.body).toHaveLength(2);
    expect(msgs.body[0].role).toBe('user');
    expect(msgs.body[0].content).toBe('Hello AI');
    expect(msgs.body[1].role).toBe('assistant');
  });

  test('auto-titles conversation from first user message', async () => {
    const conv = await agent.post('/api/ai/conversations').send({}).expect(201);

    await agent
      .post(`/api/ai/conversations/${conv.body.id}/messages`)
      .send({ role: 'user', content: 'What allergens are in the salmon dish?' })
      .expect(201);

    const listRes = await agent.get('/api/ai/conversations').expect(200);
    const found = listRes.body.find(c => c.id === conv.body.id);
    expect(found.title).toContain('allergens');
  });

  test('deletes a conversation', async () => {
    const conv = await agent.post('/api/ai/conversations').send({ title: 'To Delete' }).expect(201);

    await agent.delete(`/api/ai/conversations/${conv.body.id}`).expect(200);

    const listRes = await agent.get('/api/ai/conversations').expect(200);
    const found = listRes.body.find(c => c.id === conv.body.id);
    expect(found).toBeUndefined();
  });

  test('returns 404 for non-existent conversation messages', async () => {
    await agent.get('/api/ai/conversations/99999/messages').expect(404);
  });

  test('returns 400 for missing role/content on add message', async () => {
    const conv = await agent.post('/api/ai/conversations').send({}).expect(201);

    await agent
      .post(`/api/ai/conversations/${conv.body.id}/messages`)
      .send({ role: 'user' })
      .expect(400);
  });
});

// ─── AI TASK GENERATION ────────────────────────────────────────────────────

describe('POST /api/ai/generate-tasks/:menuId', () => {
  test('returns 404 for non-existent menu', async () => {
    await setApiKey();
    await agent.post('/api/ai/generate-tasks/99999').expect(404);
  });

  test('returns 400 for empty menu', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Empty AI Menu');
    await agent.post(`/api/ai/generate-tasks/${menuId}`).expect(400);
  });

  test('generates AI-powered tasks from a menu', async () => {
    await setApiKey();
    const menuId = await createTestMenu('AI Task Menu');
    const dishId = await createTestDish('Beurre Blanc Fish');
    await db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(menuId, dishId, 2, 0);
    await addDirections(dishId, [
      { type: 'step', text: 'Make beurre blanc sauce' },
      { type: 'step', text: 'Season and portion fish' },
    ]);

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([
          { title: 'Make beurre blanc (2L)', priority: 'medium', dish: 'Beurre Blanc Fish' },
          { title: 'Portion and season fish x40', priority: 'high', dish: 'Beurre Blanc Fish' },
        ]),
      }],
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const res = await agent
      .post(`/api/ai/generate-tasks/${menuId}`)
      .expect(201);

    expect(res.body.ai_generated).toBe(true);
    expect(res.body.total).toBe(2);

    // Verify tasks in DB
    const tasks = await db.prepare('SELECT * FROM tasks WHERE menu_id = ? ORDER BY sort_order').all(menuId);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toBe('Make beurre blanc (2L)');
    expect(tasks[0].source).toBe('auto');
    expect(tasks[1].title).toBe('Portion and season fish x40');
    expect(tasks[1].priority).toBe('high');
    expect(tasks[1].source_dish_id).toBe(dishId);
  });

  test('replaces auto tasks but preserves manual tasks', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Replace Test Menu');
    const dishId = await createTestDish('Replace Dish');
    await db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(menuId, dishId, 1, 0);

    // Create a manual task
    await db.prepare("INSERT INTO tasks (menu_id, title, type, priority, source) VALUES (?, ?, ?, ?, 'manual')").run(menuId, 'Custom task', 'custom', 'medium');
    // Create an auto task that should be replaced
    await db.prepare("INSERT INTO tasks (menu_id, title, type, priority, source) VALUES (?, ?, ?, ?, 'auto')").run(menuId, 'Old auto task', 'prep', 'medium');

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([
          { title: 'New AI task', priority: 'medium', dish: null },
        ]),
      }],
      usage: { input_tokens: 200, output_tokens: 50 },
    });

    await agent.post(`/api/ai/generate-tasks/${menuId}`).expect(201);

    const tasks = await db.prepare('SELECT * FROM tasks WHERE menu_id = ?').all(menuId);
    expect(tasks.find(t => t.title === 'Custom task')).toBeDefined();
    expect(tasks.find(t => t.title === 'Old auto task')).toBeUndefined();
    expect(tasks.find(t => t.title === 'New AI task')).toBeDefined();
  });

  test('broadcasts tasks_generated event', async () => {
    await setApiKey();
    const menuId = await createTestMenu('Broadcast Test Menu');
    const dishId = await createTestDish('Broadcast Dish');
    await db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, servings, sort_order) VALUES (?, ?, ?, ?)').run(menuId, dishId, 1, 0);

    mockMessagesCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify([{ title: 'Test task', priority: 'medium', dish: null }]),
      }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    broadcasts.length = 0;
    await agent.post(`/api/ai/generate-tasks/${menuId}`).expect(201);

    const generated = broadcasts.find(b => b.type === 'tasks_generated');
    expect(generated).toBeDefined();
    expect(generated.payload.menu_id).toBe(menuId);
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
