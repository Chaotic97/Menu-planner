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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createDish(name = 'Special Dish') {
  const res = await agent.post('/api/dishes').send({
    name,
    category: 'main',
    ingredients: [{ name: 'Butter', quantity: 100, unit: 'g', unit_cost: 0.01 }],
  });
  return res.body.id;
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('POST /api/menus/specials', () => {
  test('creates a weekly special', async () => {
    const dishId = await createDish('Weekly Special Dish');
    const res = await agent
      .post('/api/menus/specials')
      .send({ dish_id: dishId, week_start: '2026-03-02', week_end: '2026-03-08', notes: 'Chef special' })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('rejects missing required fields', async () => {
    await agent
      .post('/api/menus/specials')
      .send({ dish_id: 1 })
      .expect(400);

    await agent
      .post('/api/menus/specials')
      .send({ week_start: '2026-03-02', week_end: '2026-03-08' })
      .expect(400);
  });
});

// ─── LIST ────────────────────────────────────────────────────────────────────

describe('GET /api/menus/specials/list', () => {
  test('lists all specials', async () => {
    const res = await agent.get('/api/menus/specials/list').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].dish_name).toBeDefined();
  });

  test('filters by week', async () => {
    const res = await agent.get('/api/menus/specials/list?week=2026-03-04').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Should include the special we just created (week_start=03-02 to week_end=03-08)
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('includes allergens on each special', async () => {
    const res = await agent.get('/api/menus/specials/list').expect(200);
    for (const special of res.body) {
      expect(Array.isArray(special.allergens)).toBe(true);
    }
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('PUT /api/menus/specials/:id', () => {
  let specialId;

  beforeAll(async () => {
    const dishId = await createDish('Update Special Dish');
    const res = await agent
      .post('/api/menus/specials')
      .send({ dish_id: dishId, week_start: '2026-03-09', week_end: '2026-03-15' })
      .expect(201);
    specialId = res.body.id;
  });

  test('updates notes', async () => {
    await agent
      .put(`/api/menus/specials/${specialId}`)
      .send({ notes: 'Updated notes' })
      .expect(200);
  });

  test('toggles is_active', async () => {
    await agent
      .put(`/api/menus/specials/${specialId}`)
      .send({ is_active: false })
      .expect(200);
  });

  test('rejects empty update', async () => {
    await agent
      .put(`/api/menus/specials/${specialId}`)
      .send({})
      .expect(400);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/menus/specials/:id', () => {
  test('deletes a special', async () => {
    const dishId = await createDish('Delete Special Dish');
    const created = await agent
      .post('/api/menus/specials')
      .send({ dish_id: dishId, week_start: '2026-03-16', week_end: '2026-03-22' })
      .expect(201);

    await agent.delete(`/api/menus/specials/${created.body.id}`).expect(200);

    // Verify it's gone
    const list = await agent.get('/api/menus/specials/list').expect(200);
    expect(list.body.find(s => s.id === created.body.id)).toBeUndefined();
  });
});
