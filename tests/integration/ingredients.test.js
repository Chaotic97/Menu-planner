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

// ─── CREATE ───────────────────────────────────────────────────────────────────

describe('POST /api/ingredients', () => {
  test('creates a new ingredient', async () => {
    const res = await agent
      .post('/api/ingredients')
      .send({ name: 'Paprika', unit_cost: 0.05, base_unit: 'g', category: 'spices' })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('upserts existing ingredient by name', async () => {
    await agent.post('/api/ingredients').send({ name: 'Cumin', unit_cost: 0.03 }).expect(201);

    const res = await agent
      .post('/api/ingredients')
      .send({ name: 'Cumin', unit_cost: 0.04 })
      .expect(200);

    expect(res.body.updated).toBe(true);
  });

  test('rejects missing name', async () => {
    await agent.post('/api/ingredients').send({ unit_cost: 1 }).expect(400);
  });

  test('rejects negative unit_cost', async () => {
    await agent
      .post('/api/ingredients')
      .send({ name: 'Bad Cost', unit_cost: -5 })
      .expect(400);
  });

  test('rejects non-number unit_cost', async () => {
    await agent
      .post('/api/ingredients')
      .send({ name: 'Bad Type', unit_cost: 'expensive' })
      .expect(400);
  });
});

// ─── LIST / SEARCH ────────────────────────────────────────────────────────────

describe('GET /api/ingredients', () => {
  test('returns all ingredients', async () => {
    const res = await agent.get('/api/ingredients').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('filters by search term', async () => {
    await agent.post('/api/ingredients').send({ name: 'Turmeric' }).expect(201);

    const res = await agent.get('/api/ingredients?search=Turm').expect(200);
    expect(res.body.some(i => i.name === 'Turmeric')).toBe(true);
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

describe('PUT /api/ingredients/:id', () => {
  test('updates ingredient fields', async () => {
    const created = await agent
      .post('/api/ingredients')
      .send({ name: 'Thyme', unit_cost: 0.1, base_unit: 'g' })
      .expect(201);

    await agent
      .put(`/api/ingredients/${created.body.id}`)
      .send({ unit_cost: 0.2, base_unit: 'bunch' })
      .expect(200);

    const list = await agent.get('/api/ingredients?search=Thyme').expect(200);
    const thyme = list.body.find(i => i.name === 'Thyme');
    expect(thyme.unit_cost).toBe(0.2);
    expect(thyme.base_unit).toBe('bunch');
  });

  test('rejects nothing to update', async () => {
    const created = await agent
      .post('/api/ingredients')
      .send({ name: 'Oregano' })
      .expect(201);

    await agent.put(`/api/ingredients/${created.body.id}`).send({}).expect(400);
  });

  test('validates unit_cost on update', async () => {
    const created = await agent
      .post('/api/ingredients')
      .send({ name: 'Basil' })
      .expect(201);

    await agent
      .put(`/api/ingredients/${created.body.id}`)
      .send({ unit_cost: -1 })
      .expect(400);
  });
});

// ─── ALLERGEN DETECTION ───────────────────────────────────────────────────────

describe('GET /api/ingredients/:id/allergens', () => {
  test('detects allergens for an ingredient', async () => {
    const created = await agent
      .post('/api/ingredients')
      .send({ name: 'Whole Milk' })
      .expect(201);

    const res = await agent.get(`/api/ingredients/${created.body.id}/allergens`).expect(200);
    expect(res.body.ingredient).toBe('Whole Milk');
    expect(res.body.allergens).toContain('milk');
  });

  test('returns 404 for non-existent ingredient', async () => {
    await agent.get('/api/ingredients/99999/allergens').expect(404);
  });
});
