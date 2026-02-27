'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, cleanup, agent;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  cleanup = ctx.cleanup;
  agent = await loginAgent(app);
});

afterAll(() => cleanup());

// ─── Setup: create a menu with dishes ─────────────────────────────────────────

let menuId;

beforeAll(async () => {
  // Create two dishes with ingredients and directions
  const dish1 = await agent.post('/api/dishes').send({
    name: 'Pasta Carbonara',
    category: 'main',
    ingredients: [
      { name: 'Spaghetti', quantity: 500, unit: 'g', unit_cost: 0.003 },
      { name: 'Guanciale', quantity: 200, unit: 'g', unit_cost: 0.025 },
      { name: 'Egg Yolks', quantity: 6, unit: 'each', unit_cost: 0.30 },
      { name: 'Pecorino', quantity: 100, unit: 'g', unit_cost: 0.04 },
    ],
    directions: [
      { type: 'step', text: 'Boil spaghetti in salted water.' },
      { type: 'step', text: 'Dice and render guanciale the day before.' },
      { type: 'step', text: 'Combine egg yolks and pecorino.' },
    ],
  }).expect(201);

  const dish2 = await agent.post('/api/dishes').send({
    name: 'Caesar Salad',
    category: 'starter',
    ingredients: [
      { name: 'Romaine', quantity: 300, unit: 'g', unit_cost: 0.005 },
      { name: 'Pecorino', quantity: 50, unit: 'g', unit_cost: 0.04 },
      { name: 'Croutons', quantity: 100, unit: 'g', unit_cost: 0.01 },
    ],
    directions: [
      { type: 'step', text: 'Wash and chop romaine lettuce.' },
      { type: 'step', text: 'Toss with dressing and croutons.' },
    ],
  }).expect(201);

  // Create a menu and add both dishes
  const menu = await agent.post('/api/menus').send({ name: 'Todo Test Menu' }).expect(201);
  menuId = menu.body.id;

  await agent.post(`/api/menus/${menuId}/dishes`).send({ dish_id: dish1.body.id, servings: 4 });
  await agent.post(`/api/menus/${menuId}/dishes`).send({ dish_id: dish2.body.id, servings: 2 });
});

// ─── SHOPPING LIST ────────────────────────────────────────────────────────────

describe('GET /api/todos/menu/:id/shopping-list', () => {
  test('returns aggregated shopping list', async () => {
    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);

    expect(res.body.groups).toBeDefined();
    expect(Array.isArray(res.body.groups)).toBe(true);
    expect(res.body.total_estimated_cost).toBeDefined();

    // Pecorino appears in both dishes — should be merged into one line
    let pecorinoCount = 0;
    for (const group of res.body.groups) {
      for (const item of group.items) {
        if (item.ingredient.toLowerCase() === 'pecorino') {
          pecorinoCount++;
        }
      }
    }
    expect(pecorinoCount).toBe(1); // merged, not duplicated
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/todos/menu/99999/shopping-list').expect(404);
  });
});

// ─── SCALED SHOPPING LIST ─────────────────────────────────────────────────────

describe('GET /api/todos/menu/:id/scaled-shopping-list', () => {
  test('scales quantities by cover count', async () => {
    const base = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const scaled = await agent.get(`/api/todos/menu/${menuId}/scaled-shopping-list?covers=12`).expect(200);

    expect(scaled.body.covers).toBe(12);
    expect(scaled.body.scale_factor).toBeGreaterThan(0);
    expect(scaled.body.total_estimated_cost).toBeGreaterThanOrEqual(base.body.total_estimated_cost);
  });

  test('rejects missing covers parameter', async () => {
    await agent.get(`/api/todos/menu/${menuId}/scaled-shopping-list`).expect(400);
  });

  test('rejects covers=0', async () => {
    await agent.get(`/api/todos/menu/${menuId}/scaled-shopping-list?covers=0`).expect(400);
  });
});

// ─── PREP TASKS ───────────────────────────────────────────────────────────────

describe('GET /api/todos/menu/:id/prep-tasks', () => {
  test('returns prep tasks grouped by timing', async () => {
    const res = await agent.get(`/api/todos/menu/${menuId}/prep-tasks`).expect(200);

    expect(res.body.task_groups).toBeDefined();
    expect(Array.isArray(res.body.task_groups)).toBe(true);
    expect(res.body.total_tasks).toBeGreaterThan(0);
    // Should have at least one group with tasks
    expect(res.body.task_groups.some(g => g.tasks.length > 0)).toBe(true);
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/todos/menu/99999/prep-tasks').expect(404);
  });
});
