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

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createIngredient(name, unit_cost, base_unit = 'g', category = 'produce') {
  const res = await agent.post('/api/ingredients').send({ name, unit_cost, base_unit, category });
  return res.body.id;
}

async function createDishWithIngredients(name, ingredients) {
  const res = await agent.post('/api/dishes').send({
    name,
    category: 'main',
    ingredients,
  });
  return res.body.id;
}

async function createMenuWithDishes(name, dishes) {
  const menu = await agent.post('/api/menus').send({ name });
  const menuId = menu.body.id;
  for (const { dishId, servings } of dishes) {
    await agent.post(`/api/menus/${menuId}/dishes`).send({ dish_id: dishId, servings });
  }
  return menuId;
}

// ─── BASIC AGGREGATION ──────────────────────────────────────────────────────

describe('Shopping list basic aggregation', () => {
  test('aggregates ingredients from multiple dishes', async () => {
    const dish1 = await createDishWithIngredients('Salad', [
      { name: 'Tomato SL', quantity: 200, unit: 'g', unit_cost: 0.005, base_unit: 'g' },
      { name: 'Lettuce SL', quantity: 100, unit: 'g', unit_cost: 0.003, base_unit: 'g' },
    ]);
    const dish2 = await createDishWithIngredients('Soup', [
      { name: 'Tomato SL', quantity: 300, unit: 'g', unit_cost: 0.005, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Aggregation Menu', [
      { dishId: dish1, servings: 1 },
      { dishId: dish2, servings: 1 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);

    expect(res.body.menu_name).toBe('Aggregation Menu');
    expect(res.body.groups).toBeDefined();

    // Find tomato — should be aggregated (200 + 300 = 500g)
    const allItems = res.body.groups.flatMap(g => g.items);
    const tomato = allItems.find(i => i.ingredient === 'Tomato SL');
    expect(tomato).toBeDefined();
    expect(tomato.total_quantity).toBe(500);
    expect(tomato.unit).toBe('g');
  });

  test('multiplies quantities by servings', async () => {
    const dish = await createDishWithIngredients('Pasta SL', [
      { name: 'Flour SL', quantity: 100, unit: 'g', unit_cost: 0.002, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Servings Menu', [
      { dishId: dish, servings: 3 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const flour = allItems.find(i => i.ingredient === 'Flour SL');
    expect(flour.total_quantity).toBe(300);
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/todos/menu/99999/shopping-list').expect(404);
  });
});

// ─── AUTO-UPSCALING ─────────────────────────────────────────────────────────

describe('Shopping list auto-upscaling', () => {
  test('converts grams to kg when >= 1000', async () => {
    const dish = await createDishWithIngredients('Big Batch', [
      { name: 'Sugar SL', quantity: 500, unit: 'g', unit_cost: 0.002, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Upscale Menu', [
      { dishId: dish, servings: 3 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const sugar = allItems.find(i => i.ingredient === 'Sugar SL');
    // 500 * 3 = 1500g -> 1.5kg
    expect(sugar.total_quantity).toBe(1.5);
    expect(sugar.unit).toBe('kg');
  });

  test('does not upscale when below 1000', async () => {
    const dish = await createDishWithIngredients('Small Batch', [
      { name: 'Salt SL', quantity: 10, unit: 'g', unit_cost: 0.001, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Small Menu', [
      { dishId: dish, servings: 2 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const salt = allItems.find(i => i.ingredient === 'Salt SL');
    expect(salt.total_quantity).toBe(20);
    expect(salt.unit).toBe('g');
  });
});

// ─── CATEGORY GROUPING ──────────────────────────────────────────────────────

describe('Shopping list category grouping', () => {
  test('groups items by ingredient category', async () => {
    // Pre-create ingredients with specific categories
    await createIngredient('Chicken SL', 0.01, 'g', 'protein');
    await createIngredient('Carrot SL', 0.003, 'g', 'produce');

    // Use the pre-created ingredients by name — saveIngredients upserts, preserving category
    const dish = await createDishWithIngredients('Mixed Dish', [
      { name: 'Chicken SL', quantity: 200, unit: 'g' },
      { name: 'Carrot SL', quantity: 100, unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Category Menu', [
      { dishId: dish, servings: 1 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    // Items should be grouped into categories
    expect(res.body.groups.length).toBeGreaterThanOrEqual(1);
    // Each group has a category and items
    for (const group of res.body.groups) {
      expect(group.category).toBeDefined();
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  test('groups are sorted alphabetically', async () => {
    await createIngredient('Alpha SL', 0.01, 'g', 'dairy');
    await createIngredient('Beta SL', 0.01, 'g', 'produce');

    const dish = await createDishWithIngredients('Sort Dish', [
      { name: 'Alpha SL', quantity: 100, unit: 'g' },
      { name: 'Beta SL', quantity: 100, unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Sort Menu', [
      { dishId: dish, servings: 1 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const categories = res.body.groups.map(g => g.category);
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });
});

// ─── ESTIMATED COST ─────────────────────────────────────────────────────────

describe('Shopping list estimated cost', () => {
  test('calculates estimated cost per item and total', async () => {
    const dish = await createDishWithIngredients('Cost Dish SL', [
      { name: 'Rice SL', quantity: 200, unit: 'g', unit_cost: 0.003, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Cost Menu SL', [
      { dishId: dish, servings: 2 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const rice = allItems.find(i => i.ingredient === 'Rice SL');
    // 200 * 2 = 400g, cost = 400 * 0.003 = 1.2
    expect(rice.estimated_cost).toBeCloseTo(1.2, 2);
    expect(res.body.total_estimated_cost).toBeGreaterThan(0);
  });
});

// ─── MIXED UNITS ────────────────────────────────────────────────────────────

describe('Shopping list mixed/incompatible units', () => {
  test('tracks incompatible units separately in mixed_units', async () => {
    // Create two dishes with the same ingredient but incompatible units
    const dish1 = await createDishWithIngredients('Herb Dish 1', [
      { name: 'Basil SL', quantity: 100, unit: 'g', unit_cost: 0.01, base_unit: 'g' },
    ]);
    const dish2 = await createDishWithIngredients('Herb Dish 2', [
      { name: 'Basil SL', quantity: 2, unit: 'bunch' },
    ]);

    const menuId = await createMenuWithDishes('Mixed Unit Menu', [
      { dishId: dish1, servings: 1 },
      { dishId: dish2, servings: 1 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const basil = allItems.find(i => i.ingredient === 'Basil SL');
    expect(basil).toBeDefined();
    // The first unit (g) should be the main quantity, bunch should be in mixed_units
    expect(basil.mixed_units).toBeDefined();
    expect(basil.mixed_units.length).toBe(1);
    expect(basil.mixed_units[0].unit).toBe('bunch');
    expect(basil.mixed_units[0].quantity).toBe(2);
  });
});

// ─── USED_IN TRACKING ───────────────────────────────────────────────────────

describe('Shopping list used_in tracking', () => {
  test('tracks which dishes use each ingredient', async () => {
    const dish = await createDishWithIngredients('Tracking Dish', [
      { name: 'Onion SL', quantity: 50, unit: 'g', unit_cost: 0.002, base_unit: 'g' },
    ]);

    const menuId = await createMenuWithDishes('Tracking Menu', [
      { dishId: dish, servings: 1 },
    ]);

    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    const allItems = res.body.groups.flatMap(g => g.items);
    const onion = allItems.find(i => i.ingredient === 'Onion SL');
    expect(onion.used_in).toBeDefined();
    expect(onion.used_in.length).toBeGreaterThan(0);
    expect(onion.used_in[0]).toContain('Tracking Dish');
  });
});

// ─── SCALED SHOPPING LIST ───────────────────────────────────────────────────

describe('Scaled shopping list', () => {
  test('scales quantities by cover ratio', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Scale Menu', expected_covers: 10 }).expect(201);
    const dish = await createDishWithIngredients('Scale Dish', [
      { name: 'Potato SL', quantity: 100, unit: 'g', unit_cost: 0.002, base_unit: 'g' },
    ]);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dish, servings: 1 });

    const res = await agent.get(`/api/todos/menu/${menu.body.id}/scaled-shopping-list?covers=20`).expect(200);
    expect(res.body.covers).toBe(20);
    expect(res.body.base_covers).toBe(10);
    expect(res.body.scale_factor).toBe(2);
  });

  test('rejects invalid covers parameter', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Bad Scale' }).expect(201);
    await agent.get(`/api/todos/menu/${menu.body.id}/scaled-shopping-list?covers=0`).expect(400);
    await agent.get(`/api/todos/menu/${menu.body.id}/scaled-shopping-list?covers=abc`).expect(400);
  });
});
