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

// ─── KEYWORD MATCHING (via dish creation + allergen detection) ───────────────

describe('Allergen auto-detection on dish creation', () => {
  test('detects milk allergen from butter ingredient', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Butter Test',
      category: 'main',
      ingredients: [{ name: 'butter', quantity: 50, unit: 'g' }],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('milk');
  });

  test('detects gluten allergen from flour ingredient', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Flour Test',
      category: 'main',
      ingredients: [{ name: 'wheat flour', quantity: 200, unit: 'g' }],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('gluten');
  });

  test('detects multiple allergens from multiple ingredients', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Multi Allergen Test',
      category: 'main',
      ingredients: [
        { name: 'milk', quantity: 100, unit: 'ml' },
        { name: 'peanut butter', quantity: 30, unit: 'g' },
        { name: 'soy sauce', quantity: 10, unit: 'ml' },
      ],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('milk');
    expect(allergenNames).toContain('peanuts');
    expect(allergenNames).toContain('soy');
  });

  test('case insensitive detection', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Case Test',
      category: 'main',
      ingredients: [{ name: 'BUTTER', quantity: 50, unit: 'g' }],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('milk');
  });

  test('no false positives for unrelated ingredient names', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Safe Test',
      category: 'main',
      ingredients: [
        { name: 'carrot', quantity: 100, unit: 'g' },
        { name: 'potato', quantity: 200, unit: 'g' },
      ],
    }).expect(201);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.allergens.length).toBe(0);
  });
});

// ─── ALLERGEN RE-DETECTION ON UPDATE ────────────────────────────────────────

describe('Allergen re-detection on dish update', () => {
  test('re-detects allergens when ingredients change', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Update Allergen Test',
      category: 'main',
      ingredients: [{ name: 'carrot', quantity: 100, unit: 'g' }],
    }).expect(201);

    let dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    expect(dish.body.allergens.length).toBe(0);

    // Update to include milk-containing ingredient
    await agent.put(`/api/dishes/${res.body.id}`).send({
      ingredients: [
        { name: 'carrot', quantity: 100, unit: 'g' },
        { name: 'cream', quantity: 50, unit: 'ml' },
      ],
    }).expect(200);

    dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('milk');
  });
});

// ─── MANUAL ALLERGEN OVERRIDES ──────────────────────────────────────────────

describe('Manual allergen overrides', () => {
  test('adds manual allergen to dish', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Manual Allergen Test',
      category: 'main',
      ingredients: [{ name: 'carrot', quantity: 100, unit: 'g' }],
    }).expect(201);

    await agent.post(`/api/dishes/${res.body.id}/allergens`).send({
      allergen: 'nuts',
      action: 'add',
    }).expect(200);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).toContain('nuts');

    // Check source is manual
    const nutsAllergen = dish.body.allergens.find(a => a.allergen === 'nuts');
    expect(nutsAllergen.source).toBe('manual');
  });

  test('removes manual allergen from dish', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Remove Allergen Test',
      category: 'main',
      ingredients: [{ name: 'rice', quantity: 200, unit: 'g' }],
    }).expect(201);

    await agent.post(`/api/dishes/${res.body.id}/allergens`).send({
      allergen: 'sesame',
      action: 'add',
    }).expect(200);

    await agent.post(`/api/dishes/${res.body.id}/allergens`).send({
      allergen: 'sesame',
      action: 'remove',
    }).expect(200);

    const dish = await agent.get(`/api/dishes/${res.body.id}`).expect(200);
    const allergenNames = dish.body.allergens.map(a => a.allergen);
    expect(allergenNames).not.toContain('sesame');
  });

  test('rejects invalid allergen name', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Invalid Allergen Test',
      category: 'main',
      ingredients: [],
    }).expect(201);

    await agent.post(`/api/dishes/${res.body.id}/allergens`).send({
      allergen: 'chocolate',
      action: 'add',
    }).expect(400);
  });

  test('rejects invalid action', async () => {
    const res = await agent.post('/api/dishes').send({
      name: 'Invalid Action Test',
      category: 'main',
      ingredients: [],
    }).expect(201);

    await agent.post(`/api/dishes/${res.body.id}/allergens`).send({
      allergen: 'milk',
      action: 'toggle',
    }).expect(400);
  });
});

// ─── INGREDIENT-LEVEL ALLERGENS ─────────────────────────────────────────────

describe('Ingredient-level allergen detection', () => {
  test('auto-detects allergens when creating ingredient', async () => {
    const res = await agent.post('/api/ingredients').send({
      name: 'whole milk AD',
      unit_cost: 0.002,
      base_unit: 'ml',
    }).expect(201);

    const allergens = await agent.get(`/api/ingredients/${res.body.id}/allergens`).expect(200);
    expect(allergens.body.allergens).toContain('milk');
  });

  test('re-detects allergens when ingredient name changes', async () => {
    const res = await agent.post('/api/ingredients').send({
      name: 'plain water AD',
      unit_cost: 0,
      base_unit: 'ml',
    }).expect(201);

    let allergens = await agent.get(`/api/ingredients/${res.body.id}/allergens`).expect(200);
    expect(allergens.body.allergens.length).toBe(0);

    // Rename to something with allergen
    await agent.put(`/api/ingredients/${res.body.id}`).send({ name: 'soy milk AD' });

    allergens = await agent.get(`/api/ingredients/${res.body.id}/allergens`).expect(200);
    expect(allergens.body.allergens).toContain('soy');
    expect(allergens.body.allergens).toContain('milk');
  });

  test('manual allergen override on ingredient', async () => {
    const res = await agent.post('/api/ingredients').send({
      name: 'special sauce AD',
      unit_cost: 0.05,
      base_unit: 'ml',
    }).expect(201);

    await agent.post(`/api/ingredients/${res.body.id}/allergens`).send({
      allergen: 'mustard',
      action: 'add',
    }).expect(200);

    const allergens = await agent.get(`/api/ingredients/${res.body.id}/allergens`).expect(200);
    expect(allergens.body.allergens).toContain('mustard');
  });
});

// ─── ALLERGEN KEYWORDS MANAGEMENT ───────────────────────────────────────────

describe('Allergen keywords CRUD', () => {
  test('lists allergen keywords', async () => {
    const res = await agent.get('/api/dishes/allergen-keywords/all').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    // Check structure
    expect(res.body[0]).toHaveProperty('keyword');
    expect(res.body[0]).toHaveProperty('allergen');
  });

  test('adds a custom allergen keyword', async () => {
    await agent.post('/api/dishes/allergen-keywords').send({
      keyword: 'tempeh_test',
      allergen: 'soy',
    }).expect(201);

    const res = await agent.get('/api/dishes/allergen-keywords/all').expect(200);
    const found = res.body.find(k => k.keyword === 'tempeh_test');
    expect(found).toBeDefined();
    expect(found.allergen).toBe('soy');
  });

  test('deletes an allergen keyword', async () => {
    // Add one to delete
    await agent.post('/api/dishes/allergen-keywords').send({
      keyword: 'delete_me_kw',
      allergen: 'gluten',
    }).expect(201);

    let res = await agent.get('/api/dishes/allergen-keywords/all').expect(200);
    const kw = res.body.find(k => k.keyword === 'delete_me_kw');
    expect(kw).toBeDefined();

    await agent.delete(`/api/dishes/allergen-keywords/${kw.id}`).expect(200);

    res = await agent.get('/api/dishes/allergen-keywords/all').expect(200);
    const deleted = res.body.find(k => k.keyword === 'delete_me_kw');
    expect(deleted).toBeUndefined();
  });

  test('returns 404 when deleting non-existent keyword', async () => {
    await agent.delete('/api/dishes/allergen-keywords/99999').expect(404);
  });

  test('rejects keyword without required fields', async () => {
    await agent.post('/api/dishes/allergen-keywords').send({ keyword: '' }).expect(400);
    await agent.post('/api/dishes/allergen-keywords').send({ allergen: 'milk' }).expect(400);
  });
});

// ─── BATCH ALLERGEN DETECTION ───────────────────────────────────────────────

describe('Batch allergen detection in menus', () => {
  test('menu detail includes allergens aggregated from ingredients', async () => {
    const dish = await agent.post('/api/dishes').send({
      name: 'Menu Allergen Dish',
      category: 'main',
      ingredients: [
        { name: 'cream cheese', quantity: 100, unit: 'g' },
        { name: 'egg noodles', quantity: 200, unit: 'g' },
      ],
    }).expect(201);

    const menu = await agent.post('/api/menus').send({ name: 'Allergen Menu' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({
      dish_id: dish.body.id,
      servings: 1,
    });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(res.body.all_allergens).toBeDefined();
    expect(res.body.all_allergens.length).toBeGreaterThan(0);
  });
});
