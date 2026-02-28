'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

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

async function createDish(name = 'Menu Test Dish') {
  const res = await agent.post('/api/dishes').send({
    name,
    category: 'main',
    ingredients: [{ name: 'Olive Oil', quantity: 50, unit: 'ml', unit_cost: 0.008 }],
  });
  return res.body.id;
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

describe('POST /api/menus', () => {
  test('creates a menu and returns id', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Friday Dinner' })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('rejects menu without name', async () => {
    await agent.post('/api/menus').send({}).expect(400);
  });

  test('validates sell_price is non-negative', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Bad Price', sell_price: -10 })
      .expect(400);
  });

  test('validates expected_covers is non-negative integer', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Bad Covers', expected_covers: 3.5 })
      .expect(400);
  });

  test('broadcasts menu_created', async () => {
    await agent.post('/api/menus').send({ name: 'Broadcast Menu' }).expect(201);
    const last = broadcasts[broadcasts.length - 1];
    expect(last.type).toBe('menu_created');
  });
});

// ─── LIST ─────────────────────────────────────────────────────────────────────

describe('GET /api/menus', () => {
  test('returns list of menus with dish_count and costs', async () => {
    const res = await agent.get('/api/menus').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('dish_count');
    expect(res.body[0]).toHaveProperty('total_food_cost');
  });
});

// ─── GET DETAIL ───────────────────────────────────────────────────────────────

describe('GET /api/menus/:id', () => {
  test('returns menu with dishes and cost breakdown', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Detail Menu', sell_price: 100 }).expect(201);
    const dishId = await createDish('Detail Dish');
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 2 });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);

    expect(res.body.name).toBe('Detail Menu');
    expect(res.body.dishes).toHaveLength(1);
    expect(res.body.dishes[0].cost_per_serving).toBeDefined();
    expect(res.body.total_food_cost).toBeGreaterThan(0);
    expect(res.body.all_allergens).toBeDefined();
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/menus/99999').expect(404);
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

describe('PUT /api/menus/:id', () => {
  test('updates menu fields', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Before' }).expect(201);

    await agent
      .put(`/api/menus/${menu.body.id}`)
      .send({ name: 'After', description: 'Updated', sell_price: 150 })
      .expect(200);

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(res.body.name).toBe('After');
    expect(res.body.description).toBe('Updated');
    expect(res.body.sell_price).toBe(150);
  });

  test('updates guest_allergies', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Allergy Menu' }).expect(201);

    await agent
      .put(`/api/menus/${menu.body.id}`)
      .send({ guest_allergies: 'nuts,milk' })
      .expect(200);

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(res.body.guest_allergies).toBe('nuts,milk');
  });
});

// ─── DELETE / RESTORE ─────────────────────────────────────────────────────────

describe('DELETE /api/menus/:id', () => {
  test('soft-deletes a menu', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Delete Menu' }).expect(201);
    await agent.delete(`/api/menus/${menu.body.id}`).expect(200);

    await agent.get(`/api/menus/${menu.body.id}`).expect(404);
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.delete('/api/menus/99999').expect(404);
  });
});

describe('POST /api/menus/:id/restore', () => {
  test('restores a soft-deleted menu', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Restore Menu' }).expect(201);
    await agent.delete(`/api/menus/${menu.body.id}`).expect(200);
    await agent.post(`/api/menus/${menu.body.id}/restore`).expect(200);

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(res.body.name).toBe('Restore Menu');
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.post('/api/menus/99999/restore').expect(404);
  });
});

// ─── MENU DISHES ──────────────────────────────────────────────────────────────

describe('Menu dishes management', () => {
  let menuId, dishId1, dishId2;

  beforeAll(async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Dishes Menu' }).expect(201);
    menuId = menu.body.id;
    dishId1 = await createDish('Dish A');
    dishId2 = await createDish('Dish B');
  });

  test('adds dish to menu', async () => {
    await agent
      .post(`/api/menus/${menuId}/dishes`)
      .send({ dish_id: dishId1, servings: 3 })
      .expect(201);

    const menu = await agent.get(`/api/menus/${menuId}`).expect(200);
    expect(menu.body.dishes).toHaveLength(1);
    expect(menu.body.dishes[0].servings).toBe(3);
  });

  test('rejects duplicate dish in menu', async () => {
    await agent
      .post(`/api/menus/${menuId}/dishes`)
      .send({ dish_id: dishId1, servings: 1 })
      .expect(409);
  });

  test('validates servings is positive', async () => {
    await agent
      .post(`/api/menus/${menuId}/dishes`)
      .send({ dish_id: dishId2, servings: 0 })
      .expect(400);
  });

  test('updates dish servings', async () => {
    await agent
      .put(`/api/menus/${menuId}/dishes/${dishId1}`)
      .send({ servings: 5 })
      .expect(200);

    const menu = await agent.get(`/api/menus/${menuId}`).expect(200);
    const dish = menu.body.dishes.find(d => d.id === dishId1);
    expect(dish.servings).toBe(5);
  });

  test('reorders dishes', async () => {
    await agent.post(`/api/menus/${menuId}/dishes`).send({ dish_id: dishId2, servings: 1 });

    await agent
      .put(`/api/menus/${menuId}/dishes/reorder`)
      .send({ order: [{ dish_id: dishId2, sort_order: 0 }, { dish_id: dishId1, sort_order: 1 }] })
      .expect(200);
  });

  test('removes dish from menu', async () => {
    await agent.delete(`/api/menus/${menuId}/dishes/${dishId2}`).expect(200);

    const menu = await agent.get(`/api/menus/${menuId}`).expect(200);
    expect(menu.body.dishes.find(d => d.id === dishId2)).toBeUndefined();
  });
});

// ─── MENU COST ROLLUP ─────────────────────────────────────────────────────────

describe('Menu cost calculations', () => {
  test('aggregates food cost across dishes', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Cost Menu', sell_price: 50 }).expect(201);
    const dishId = await createDish('Cost Dish');
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 2 });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(res.body.total_food_cost).toBeGreaterThan(0);
    expect(res.body.menu_food_cost_percent).toBeDefined();
  });
});

// ─── BATCH YIELD IN MENU CONTEXT ─────────────────────────────────────────────

describe('Batch yield in menu', () => {
  test('dish in menu includes cost_per_portion and batch_yield', async () => {
    // Create a dish with batch_yield = 4
    const dishRes = await agent.post('/api/dishes').send({
      name: 'Batch Menu Dish',
      category: 'main',
      batch_yield: 4,
      ingredients: [{ name: 'Chickpeas', quantity: 800, unit: 'g', unit_cost: 0.005 }],
    });
    const dishId = dishRes.body.id;

    const menu = await agent.post('/api/menus').send({ name: 'Batch Menu' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 2 });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    const dish = res.body.dishes[0];

    expect(dish.batch_yield).toBe(4);
    expect(dish.cost_per_portion).toBeDefined();
    expect(dish.total_portions).toBe(8); // 2 batches * 4 yield
    // Batch cost = 800g * $0.005 = $4.00, per-portion = $4.00 / 4 = $1.00
    expect(dish.cost_per_batch).toBe(4);
    expect(dish.cost_per_portion).toBe(1);
    // cost_total = batch cost * servings = $4.00 * 2 = $8.00
    expect(dish.cost_total).toBe(8);
  });

  test('total_food_cost sums batch costs times servings', async () => {
    const dishRes = await agent.post('/api/dishes').send({
      name: 'Batch Cost Dish',
      category: 'main',
      batch_yield: 3,
      ingredients: [{ name: 'Lentils2', quantity: 300, unit: 'g', unit_cost: 0.01 }],
    });
    const dishId = dishRes.body.id;

    const menu = await agent.post('/api/menus').send({ name: 'Batch Cost Menu' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 3 });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    // Batch cost = 300g * $0.01 = $3.00, servings = 3 => total = $9.00
    expect(res.body.total_food_cost).toBe(9);
  });
});

// ─── GUEST ALLERGY CONFLICTS ──────────────────────────────────────────────────

describe('Guest allergy conflict detection', () => {
  test('flags dishes with allergen conflicts', async () => {
    // Create a dish with milk allergen (butter contains milk)
    const dishId = await createDish('Milk Dish');
    // Manually add milk allergen
    await agent.post(`/api/dishes/${dishId}/allergens`).send({ allergen: 'milk', action: 'add' });

    const menu = await agent.post('/api/menus').send({ name: 'Allergy Test Menu' }).expect(201);
    await agent.put(`/api/menus/${menu.body.id}`).send({ guest_allergies: 'milk' });
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 });

    const res = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    const dish = res.body.dishes[0];
    expect(dish.allergy_conflicts).toContain('milk');
  });
});

// ─── KITCHEN PRINT ────────────────────────────────────────────────────────────

describe('GET /api/menus/:id/kitchen-print', () => {
  test('returns grouped kitchen print data', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Print Menu' }).expect(201);
    const dishId = await createDish('Print Dish');
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 });

    const res = await agent.get(`/api/menus/${menu.body.id}/kitchen-print`).expect(200);
    expect(res.body.menu).toBeDefined();
    expect(res.body.dishes).toBeDefined();
    expect(res.body.grouped).toBeDefined();
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/menus/99999/kitchen-print').expect(404);
  });
});

// ─── WEEKLY SCHEDULE ─────────────────────────────────────────────────────────

describe('Weekly schedule (schedule_days & active_days)', () => {
  test('creates menu with schedule_days', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Weekly Menu', schedule_days: [3, 4, 5, 6, 0] })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(JSON.parse(detail.body.schedule_days)).toEqual([3, 4, 5, 6, 0]);
  });

  test('updates schedule_days on existing menu', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Update Schedule' }).expect(201);
    await agent.put(`/api/menus/${menu.body.id}`).send({ schedule_days: [1, 2, 3] }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(JSON.parse(detail.body.schedule_days)).toEqual([1, 2, 3]);
  });

  test('rejects invalid schedule_days', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Bad Schedule', schedule_days: [7] })
      .expect(400);

    await agent
      .post('/api/menus')
      .send({ name: 'Bad Schedule', schedule_days: 'not-array' })
      .expect(400);
  });

  test('sets active_days on a menu dish', async () => {
    const dishId = await createDish('Schedule Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Day Menu', schedule_days: [3, 4, 5, 6, 0] }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 }).expect(201);

    // Set active_days to Wed only
    await agent.put(`/api/menus/${menu.body.id}/dishes/${dishId}`).send({ active_days: [3] }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    const dish = detail.body.dishes.find(d => d.id === dishId);
    expect(JSON.parse(dish.active_days)).toEqual([3]);
  });

  test('clears active_days back to null', async () => {
    const dishId = await createDish('Clear Days Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Clear Menu', schedule_days: [3, 4, 5] }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 }).expect(201);

    await agent.put(`/api/menus/${menu.body.id}/dishes/${dishId}`).send({ active_days: [3] }).expect(200);
    await agent.put(`/api/menus/${menu.body.id}/dishes/${dishId}`).send({ active_days: null }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    const dish = detail.body.dishes.find(d => d.id === dishId);
    expect(dish.active_days).toBeNull();
  });

  test('rejects invalid active_days', async () => {
    const dishId = await createDish('Invalid Days Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Invalid Menu' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 }).expect(201);

    await agent
      .put(`/api/menus/${menu.body.id}/dishes/${dishId}`)
      .send({ active_days: [8] })
      .expect(400);
  });
});
