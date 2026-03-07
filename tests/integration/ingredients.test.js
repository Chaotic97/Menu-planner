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

// ─── INGREDIENT ALLERGEN MANAGEMENT ──────────────────────────────────────────

describe('POST /api/ingredients/:id/allergens', () => {
  let ingredientId;

  beforeAll(async () => {
    const res = await agent
      .post('/api/ingredients')
      .send({ name: 'Plain Water' })
      .expect(201);
    ingredientId = res.body.id;
  });

  test('adds manual allergen to ingredient', async () => {
    await agent
      .post(`/api/ingredients/${ingredientId}/allergens`)
      .send({ allergen: 'nuts', action: 'add' })
      .expect(200);

    const res = await agent.get(`/api/ingredients/${ingredientId}/allergens`).expect(200);
    expect(res.body.allergens).toContain('nuts');
  });

  test('removes allergen from ingredient', async () => {
    await agent
      .post(`/api/ingredients/${ingredientId}/allergens`)
      .send({ allergen: 'nuts', action: 'remove' })
      .expect(200);

    const res = await agent.get(`/api/ingredients/${ingredientId}/allergens`).expect(200);
    expect(res.body.allergens).not.toContain('nuts');
  });

  test('rejects invalid allergen', async () => {
    await agent
      .post(`/api/ingredients/${ingredientId}/allergens`)
      .send({ allergen: 'chocolate', action: 'add' })
      .expect(400);
  });

  test('rejects invalid action', async () => {
    await agent
      .post(`/api/ingredients/${ingredientId}/allergens`)
      .send({ allergen: 'nuts', action: 'toggle' })
      .expect(400);
  });

  test('returns 404 for non-existent ingredient', async () => {
    await agent
      .post('/api/ingredients/99999/allergens')
      .send({ allergen: 'nuts', action: 'add' })
      .expect(404);
  });
});

describe('ingredient allergens flow to dishes', () => {
  test('auto-detected ingredient allergens appear on dish', async () => {
    // Create a dish with a milk ingredient (butter → milk allergen)
    const created = await agent.post('/api/dishes').send({
      name: 'Allergen Flow Test',
      ingredients: [{ name: 'Butter', quantity: 100, unit: 'g' }],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(dish.body.allergens.some(a => a.allergen === 'milk')).toBe(true);
  });

  test('ingredient list returns allergens per ingredient', async () => {
    await agent.post('/api/ingredients').send({ name: 'Fresh Shrimp' }).expect(201);

    const list = await agent.get('/api/ingredients?search=Fresh Shrimp').expect(200);
    const shrimp = list.body.find(i => i.name === 'Fresh Shrimp');
    expect(shrimp.allergens).toBeDefined();
    expect(shrimp.allergens.some(a => a.allergen === 'crustaceans')).toBe(true);
  });
});

// ─── EXISTENCE CHECKS ──────────────────────────────────────────────────────

describe('PUT /api/ingredients/:id existence check', () => {
  test('returns 404 for non-existent ingredient', async () => {
    await agent
      .put('/api/ingredients/99999')
      .send({ name: 'Ghost' })
      .expect(404);
  });
});
