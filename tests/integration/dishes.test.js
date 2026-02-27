'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, broadcasts, cleanup, agent;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  broadcasts = ctx.broadcasts;
  cleanup = ctx.cleanup;
  agent = await loginAgent(app);
});

afterAll(() => cleanup());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createDish(overrides = {}) {
  return {
    name: 'Test Dish',
    description: 'A test dish',
    category: 'main',
    ingredients: [
      { name: 'Butter', quantity: 100, unit: 'g', unit_cost: 0.01 },
      { name: 'Salt', quantity: 5, unit: 'g' },
    ],
    tags: ['test', 'sample'],
    directions: [
      { type: 'step', text: 'Melt butter in a pan.' },
      { type: 'step', text: 'Add salt.' },
    ],
    ...overrides,
  };
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

describe('POST /api/dishes', () => {
  test('creates a dish and returns id', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish())
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(typeof res.body.id).toBe('number');
  });

  test('rejects dish without name', async () => {
    const res = await agent
      .post('/api/dishes')
      .send({ description: 'no name' })
      .expect(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('saves ingredients correctly', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Ingredient Test' }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const ingredients = dish.body.ingredients.filter(i => i.row_type === 'ingredient');
    expect(ingredients).toHaveLength(2);
    expect(ingredients[0].ingredient_name).toBe('Butter');
  });

  test('saves tags correctly', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Tag Test' }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.tags).toEqual(expect.arrayContaining(['test', 'sample']));
  });

  test('saves directions correctly', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Directions Test' }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.directions).toHaveLength(2);
    expect(dish.body.directions[0].type).toBe('step');
    expect(dish.body.directions[0].text).toBe('Melt butter in a pan.');
  });

  test('saves section headers in ingredients', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'Section Test',
        ingredients: [
          { section_header: 'For the sauce' },
          { name: 'Cream', quantity: 200, unit: 'ml' },
        ],
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const sections = dish.body.ingredients.filter(i => i.row_type === 'section');
    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('For the sauce');
  });

  test('saves substitutions correctly', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'Sub Test',
        substitutions: [{
          allergen: 'milk',
          original_ingredient: 'Butter',
          substitute_ingredient: 'Olive oil',
          notes: 'Use same quantity',
        }],
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.substitutions).toHaveLength(1);
    expect(dish.body.substitutions[0].allergen).toBe('milk');
  });

  test('broadcasts dish_created', async () => {
    const before = broadcasts.length;
    await agent.post('/api/dishes').send(createDish({ name: 'Broadcast Test' })).expect(201);
    expect(broadcasts.length).toBeGreaterThan(before);
    const last = broadcasts[broadcasts.length - 1];
    expect(last.type).toBe('dish_created');
  });
});

// ─── READ ─────────────────────────────────────────────────────────────────────

describe('GET /api/dishes', () => {
  test('returns list of dishes', async () => {
    const res = await agent.get('/api/dishes').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('filters by category', async () => {
    await agent.post('/api/dishes').send(createDish({ name: 'Dessert Dish', category: 'dessert' }));
    const res = await agent.get('/api/dishes?category=dessert').expect(200);
    expect(res.body.every(d => d.category === 'dessert')).toBe(true);
  });

  test('filters by search term', async () => {
    await agent.post('/api/dishes').send(createDish({ name: 'Unique Salmon Risotto' }));
    const res = await agent.get('/api/dishes?search=Unique%20Salmon').expect(200);
    expect(res.body.some(d => d.name === 'Unique Salmon Risotto')).toBe(true);
  });

  test('filters by tag', async () => {
    await agent.post('/api/dishes').send(createDish({ name: 'Tagged Dish', tags: ['specialtag'] }));
    const res = await agent.get('/api/dishes?tag=specialtag').expect(200);
    expect(res.body.some(d => d.name === 'Tagged Dish')).toBe(true);
  });
});

describe('GET /api/dishes/:id', () => {
  test('returns dish with full details', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Detail Test' })).expect(201);
    const res = await agent.get(`/api/dishes/${created.body.id}`).expect(200);

    expect(res.body.name).toBe('Detail Test');
    expect(res.body.ingredients).toBeDefined();
    expect(res.body.allergens).toBeDefined();
    expect(res.body.tags).toBeDefined();
    expect(res.body.cost).toBeDefined();
    expect(res.body.directions).toBeDefined();
  });

  test('includes cost calculation', async () => {
    const created = await agent.post('/api/dishes').send(createDish({
      name: 'Cost Test',
      ingredients: [{ name: 'Flour', quantity: 500, unit: 'g', unit_cost: 0.002 }],
    })).expect(201);

    const res = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(res.body.cost.totalCost).toBeGreaterThan(0);
  });

  test('returns 404 for non-existent dish', async () => {
    await agent.get('/api/dishes/99999').expect(404);
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

describe('PUT /api/dishes/:id', () => {
  test('updates dish fields', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Before Update' })).expect(201);

    await agent
      .put(`/api/dishes/${created.body.id}`)
      .send({ name: 'After Update', description: 'Updated desc' })
      .expect(200);

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(dish.body.name).toBe('After Update');
    expect(dish.body.description).toBe('Updated desc');
  });

  test('replaces ingredients on update', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Replace Ing' })).expect(201);

    await agent
      .put(`/api/dishes/${created.body.id}`)
      .send({ ingredients: [{ name: 'Garlic', quantity: 10, unit: 'g' }] })
      .expect(200);

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    const ingredients = dish.body.ingredients.filter(i => i.row_type === 'ingredient');
    expect(ingredients).toHaveLength(1);
    expect(ingredients[0].ingredient_name).toBe('Garlic');
  });

  test('returns 404 for non-existent dish', async () => {
    await agent.put('/api/dishes/99999').send({ name: 'X' }).expect(404);
  });
});

// ─── DELETE / RESTORE ─────────────────────────────────────────────────────────

describe('DELETE /api/dishes/:id', () => {
  test('soft-deletes a dish', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Delete Me' })).expect(201);

    await agent.delete(`/api/dishes/${created.body.id}`).expect(200);

    // Should not appear in list
    const list = await agent.get('/api/dishes').expect(200);
    expect(list.body.find(d => d.id === created.body.id)).toBeUndefined();

    // Should return 404 on direct fetch
    await agent.get(`/api/dishes/${created.body.id}`).expect(404);
  });

  test('returns 404 for non-existent dish', async () => {
    await agent.delete('/api/dishes/99999').expect(404);
  });
});

describe('POST /api/dishes/:id/restore', () => {
  test('restores a soft-deleted dish', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Restore Me' })).expect(201);
    await agent.delete(`/api/dishes/${created.body.id}`).expect(200);

    await agent.post(`/api/dishes/${created.body.id}/restore`).expect(200);

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(dish.body.name).toBe('Restore Me');
  });
});

// ─── DUPLICATE ────────────────────────────────────────────────────────────────

describe('POST /api/dishes/:id/duplicate', () => {
  test('creates a full copy', async () => {
    const created = await agent.post('/api/dishes').send(createDish({
      name: 'Original',
      tags: ['dup-test'],
      directions: [{ type: 'step', text: 'Do something.' }],
    })).expect(201);

    const res = await agent.post(`/api/dishes/${created.body.id}/duplicate`).expect(201);
    expect(res.body.id).not.toBe(created.body.id);

    const copy = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(copy.body.name).toBe('Copy of Original');
    expect(copy.body.tags).toContain('dup-test');
    expect(copy.body.directions).toHaveLength(1);
  });
});

// ─── FAVORITE ─────────────────────────────────────────────────────────────────

describe('POST /api/dishes/:id/favorite', () => {
  test('toggles favorite status', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Fav Test' })).expect(201);

    const res1 = await agent.post(`/api/dishes/${created.body.id}/favorite`).expect(200);
    expect(res1.body.is_favorite).toBe(1);

    const res2 = await agent.post(`/api/dishes/${created.body.id}/favorite`).expect(200);
    expect(res2.body.is_favorite).toBe(0);
  });
});

// ─── ALLERGENS ────────────────────────────────────────────────────────────────

describe('POST /api/dishes/:id/allergens', () => {
  test('adds manual allergen', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Allergen Test' })).expect(201);

    await agent
      .post(`/api/dishes/${created.body.id}/allergens`)
      .send({ allergen: 'nuts', action: 'add' })
      .expect(200);

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(dish.body.allergens.some(a => a.allergen === 'nuts' && a.source === 'manual')).toBe(true);
  });

  test('removes allergen', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Remove Allergen' })).expect(201);

    await agent.post(`/api/dishes/${created.body.id}/allergens`).send({ allergen: 'nuts', action: 'add' });
    await agent.post(`/api/dishes/${created.body.id}/allergens`).send({ allergen: 'nuts', action: 'remove' });

    const dish = await agent.get(`/api/dishes/${created.body.id}`).expect(200);
    expect(dish.body.allergens.find(a => a.allergen === 'nuts')).toBeUndefined();
  });

  test('rejects invalid allergen', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Bad Allergen' })).expect(201);

    await agent
      .post(`/api/dishes/${created.body.id}/allergens`)
      .send({ allergen: 'chocolate', action: 'add' })
      .expect(400);
  });

  test('rejects invalid action', async () => {
    const created = await agent.post('/api/dishes').send(createDish({ name: 'Bad Action' })).expect(201);

    await agent
      .post(`/api/dishes/${created.body.id}/allergens`)
      .send({ allergen: 'nuts', action: 'toggle' })
      .expect(400);
  });
});

// ─── AUTO ALLERGEN DETECTION ──────────────────────────────────────────────────

describe('Allergen auto-detection', () => {
  test('detects allergens from ingredient names', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'Shrimp Dish',
        ingredients: [{ name: 'Shrimp', quantity: 200, unit: 'g' }],
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.allergens.some(a => a.allergen === 'crustaceans')).toBe(true);
  });
});

// ─── TAGS ─────────────────────────────────────────────────────────────────────

describe('GET /api/dishes/tags/all', () => {
  test('returns all tags', async () => {
    const res = await agent.get('/api/dishes/tags/all').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some(t => t.name === 'test')).toBe(true);
  });
});

// ─── BATCH YIELD ─────────────────────────────────────────────────────────────

describe('Batch yield', () => {
  test('creates dish with batch_yield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Batch Test', batch_yield: 4 }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.batch_yield).toBe(4);
  });

  test('defaults batch_yield to 1 when not provided', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Default Yield' }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.batch_yield).toBe(1);
  });

  test('rejects batch_yield of 0', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Zero Yield', batch_yield: 0 }))
      .expect(400);
    expect(res.body.error).toMatch(/batch_yield/i);
  });

  test('rejects negative batch_yield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Neg Yield', batch_yield: -2 }))
      .expect(400);
    expect(res.body.error).toMatch(/batch_yield/i);
  });

  test('rejects non-integer batch_yield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Float Yield', batch_yield: 2.5 }))
      .expect(400);
    expect(res.body.error).toMatch(/batch_yield/i);
  });

  test('cost response includes costPerPortion and batchYield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'Portion Cost Test',
        batch_yield: 5,
        ingredients: [{ name: 'Rice', quantity: 1000, unit: 'g', unit_cost: 0.002 }],
        suggested_price: 10,
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.cost.batchYield).toBe(5);
    expect(dish.body.cost.costPerPortion).toBeDefined();
    // Batch cost = 1000g * $0.002/g = $2.00, per-portion = $2.00 / 5 = $0.40
    expect(dish.body.cost.combinedTotal).toBe(2);
    expect(dish.body.cost.costPerPortion).toBe(0.4);
  });

  test('food_cost_percent based on per-portion cost', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'FCP Yield Test',
        batch_yield: 5,
        ingredients: [{ name: 'Pasta', quantity: 500, unit: 'g', unit_cost: 0.004 }],
        suggested_price: 10,
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    // Batch cost = 500g * $0.004/g = $2.00, per-portion = $2.00 / 5 = $0.40
    // Food cost % = ($0.40 / $10) * 100 = 4%
    expect(dish.body.food_cost_percent).toBe(4);
  });

  test('suggested_price_calc based on per-portion cost', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({
        name: 'Suggest Yield Test',
        batch_yield: 4,
        ingredients: [{ name: 'Lentils', quantity: 400, unit: 'g', unit_cost: 0.003 }],
      }))
      .expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    // Batch cost = 400g * $0.003/g = $1.20, per-portion = $1.20 / 4 = $0.30
    // Suggested price at 30% = $0.30 / 0.30 = $1.00
    expect(dish.body.suggested_price_calc).toBe(1);
  });

  test('updates batch_yield via PUT', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Update Yield', batch_yield: 2 }))
      .expect(201);

    await agent
      .put(`/api/dishes/${res.body.id}`)
      .send({ batch_yield: 8 })
      .expect(200);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.batch_yield).toBe(8);
  });

  test('PUT rejects invalid batch_yield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Bad Update Yield' }))
      .expect(201);

    await agent
      .put(`/api/dishes/${res.body.id}`)
      .send({ batch_yield: 0 })
      .expect(400);
  });

  test('duplicate copies batch_yield', async () => {
    const res = await agent
      .post('/api/dishes')
      .send(createDish({ name: 'Dup Yield', batch_yield: 6 }))
      .expect(201);

    const dup = await agent.post(`/api/dishes/${res.body.id}/duplicate`).expect(201);
    const copy = await agent.get(`/api/dishes/${dup.body.id}`).expect(200);
    expect(copy.body.batch_yield).toBe(6);
  });
});

// ─── AUTH REQUIRED ────────────────────────────────────────────────────────────

describe('Authentication required', () => {
  test('unauthenticated request returns 401', async () => {
    await request(app).get('/api/dishes').expect(401);
  });
});
