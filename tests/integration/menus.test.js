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

// ─── MENU TYPES ────────────────────────────────────────────────────────────

describe('Menu types (standard / event)', () => {
  test('creates an event menu by default', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Default Type Menu' })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(detail.body.menu_type).toBe('event');
  });

  test('creates a standard (house) menu', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'House Menu', menu_type: 'standard' })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(detail.body.menu_type).toBe('standard');
  });

  test('setting a new standard menu demotes the previous one', async () => {
    const first = await agent.post('/api/menus').send({ name: 'House 1', menu_type: 'standard' }).expect(201);
    const second = await agent.post('/api/menus').send({ name: 'House 2', menu_type: 'standard' }).expect(201);

    const firstDetail = await agent.get(`/api/menus/${first.body.id}`).expect(200);
    const secondDetail = await agent.get(`/api/menus/${second.body.id}`).expect(200);

    expect(firstDetail.body.menu_type).toBe('event');
    expect(secondDetail.body.menu_type).toBe('standard');
  });

  test('promotes an event menu to standard via PUT', async () => {
    const house = await agent.post('/api/menus').send({ name: 'Old House', menu_type: 'standard' }).expect(201);
    const event = await agent.post('/api/menus').send({ name: 'New House' }).expect(201);

    await agent.put(`/api/menus/${event.body.id}`).send({ menu_type: 'standard' }).expect(200);

    const oldDetail = await agent.get(`/api/menus/${house.body.id}`).expect(200);
    const newDetail = await agent.get(`/api/menus/${event.body.id}`).expect(200);

    expect(oldDetail.body.menu_type).toBe('event');
    expect(newDetail.body.menu_type).toBe('standard');
  });

  test('demoting to event clears schedule_days', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Schedule House', menu_type: 'standard', schedule_days: [1, 2, 3] }).expect(201);
    await agent.put(`/api/menus/${menu.body.id}`).send({ menu_type: 'event' }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(detail.body.menu_type).toBe('event');
    expect(JSON.parse(detail.body.schedule_days)).toEqual([]);
  });

  test('rejects invalid menu_type', async () => {
    await agent.post('/api/menus').send({ name: 'Bad Type', menu_type: 'brunch' }).expect(400);
  });

  test('creates event menu with event_date', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Wedding', event_date: '2026-06-15' })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(detail.body.event_date).toBe('2026-06-15');
  });

  test('rejects invalid event_date format', async () => {
    await agent.post('/api/menus').send({ name: 'Bad Date', event_date: 'June 15th' }).expect(400);
  });

  test('rejects schedule_days on event menu', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Event Schedule', menu_type: 'event', schedule_days: [1, 2] })
      .expect(400);
  });

  test('rejects schedule_days update on event menu', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Event Menu' }).expect(201);
    await agent.put(`/api/menus/${menu.body.id}`).send({ schedule_days: [1, 2] }).expect(400);
  });

  test('standard menus sort first in list', async () => {
    // Create an event menu, then a standard menu
    await agent.post('/api/menus').send({ name: 'Event Z' }).expect(201);
    await agent.post('/api/menus').send({ name: 'My House', menu_type: 'standard' }).expect(201);

    const list = await agent.get('/api/menus').expect(200);
    const standardIdx = list.body.findIndex(m => m.name === 'My House');
    const eventIdx = list.body.findIndex(m => m.name === 'Event Z');
    expect(standardIdx).toBeLessThan(eventIdx);
  });
});

// ─── WEEKLY SCHEDULE ─────────────────────────────────────────────────────────

describe('Weekly schedule (schedule_days & active_days)', () => {
  test('creates standard menu with schedule_days', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Weekly Menu', menu_type: 'standard', schedule_days: [3, 4, 5, 6, 0] })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(JSON.parse(detail.body.schedule_days)).toEqual([3, 4, 5, 6, 0]);
  });

  test('updates schedule_days on standard menu', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Update Schedule', menu_type: 'standard' }).expect(201);
    await agent.put(`/api/menus/${menu.body.id}`).send({ schedule_days: [1, 2, 3] }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(JSON.parse(detail.body.schedule_days)).toEqual([1, 2, 3]);
  });

  test('rejects invalid schedule_days', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Bad Schedule', menu_type: 'standard', schedule_days: [7] })
      .expect(400);

    await agent
      .post('/api/menus')
      .send({ name: 'Bad Schedule', menu_type: 'standard', schedule_days: 'not-array' })
      .expect(400);
  });

  test('sets active_days on a menu dish', async () => {
    const dishId = await createDish('Schedule Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Day Menu', menu_type: 'standard', schedule_days: [3, 4, 5, 6, 0] }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 }).expect(201);

    // Set active_days to Wed only
    await agent.put(`/api/menus/${menu.body.id}/dishes/${dishId}`).send({ active_days: [3] }).expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    const dish = detail.body.dishes.find(d => d.id === dishId);
    expect(JSON.parse(dish.active_days)).toEqual([3]);
  });

  test('clears active_days back to null', async () => {
    const dishId = await createDish('Clear Days Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Clear Menu', menu_type: 'standard', schedule_days: [3, 4, 5] }).expect(201);
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

// ─── EXISTENCE CHECKS ──────────────────────────────────────────────────────

describe('Menu dish existence checks', () => {
  test('returns 404 when updating servings for non-existent menu dish', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Existence Menu' }).expect(201);
    await agent
      .put(`/api/menus/${menu.body.id}/dishes/99999`)
      .send({ servings: 3 })
      .expect(404);
  });

  test('returns 404 when removing non-existent menu dish', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Existence Menu 2' }).expect(201);
    await agent
      .delete(`/api/menus/${menu.body.id}/dishes/99999`)
      .expect(404);
  });

  test('returns 404 when reordering dishes in non-existent menu', async () => {
    await agent
      .put('/api/menus/99999/dishes/reorder')
      .send({ order: [{ dish_id: 1, sort_order: 0 }] })
      .expect(404);
  });

  test('menu list excludes soft-deleted dishes from counts and costs', async () => {
    const dishId = await createDish('Delete Dish');
    const menu = await agent.post('/api/menus').send({ name: 'Soft Delete Menu' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dishId, servings: 1 });

    // Verify dish is counted
    let list = await agent.get('/api/menus').expect(200);
    let m = list.body.find(x => x.id === menu.body.id);
    expect(m.dish_count).toBe(1);

    // Soft-delete the dish
    await agent.delete(`/api/dishes/${dishId}`).expect(200);

    // Dish should no longer be counted
    list = await agent.get('/api/menus').expect(200);
    m = list.body.find(x => x.id === menu.body.id);
    expect(m.dish_count).toBe(0);
    expect(m.total_food_cost).toBe(0);
  });
});

// ─── SERVICE STYLE ──────────────────────────────────────────────────────────

describe('Service style (coursed / alacarte)', () => {
  test('creates a menu with service_style', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Coursed Menu', service_style: 'coursed' })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(detail.body.service_style).toBe('coursed');
  });

  test('defaults to alacarte service_style', async () => {
    const res = await agent
      .post('/api/menus')
      .send({ name: 'Default Style Menu' })
      .expect(201);

    const detail = await agent.get(`/api/menus/${res.body.id}`).expect(200);
    expect(detail.body.service_style).toBe('alacarte');
  });

  test('rejects invalid service_style', async () => {
    await agent
      .post('/api/menus')
      .send({ name: 'Bad Style', service_style: 'invalid' })
      .expect(400);
  });

  test('updates service_style', async () => {
    const menu = await agent.post('/api/menus').send({ name: 'Style Update' }).expect(201);
    await agent
      .put(`/api/menus/${menu.body.id}`)
      .send({ service_style: 'coursed' })
      .expect(200);

    const detail = await agent.get(`/api/menus/${menu.body.id}`).expect(200);
    expect(detail.body.service_style).toBe('coursed');
  });
});

// ─── MENU COURSES ──────────────────────────────────────────────────────────

describe('Menu courses/sections', () => {
  let menuId;

  beforeAll(async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Course Test Menu', service_style: 'coursed' })
      .expect(201);
    menuId = menu.body.id;
  });

  test('creates a course', async () => {
    const res = await agent
      .post(`/api/menus/${menuId}/courses`)
      .send({ name: 'Starter', notes: 'Light dishes' })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe('Starter');
  });

  test('rejects course without name', async () => {
    await agent
      .post(`/api/menus/${menuId}/courses`)
      .send({ notes: 'No name' })
      .expect(400);
  });

  test('lists courses', async () => {
    await agent.post(`/api/menus/${menuId}/courses`).send({ name: 'Main' }).expect(201);

    const res = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].name).toBe('Starter');
  });

  test('updates course name and notes', async () => {
    const courses = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const courseId = courses.body[0].id;

    await agent
      .put(`/api/menus/${menuId}/courses/${courseId}`)
      .send({ name: 'Appetizer', notes: 'Updated notes' })
      .expect(200);

    const updated = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const course = updated.body.find(c => c.id === courseId);
    expect(course.name).toBe('Appetizer');
    expect(course.notes).toBe('Updated notes');
  });

  test('reorders courses', async () => {
    const courses = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const order = courses.body.map((c, i) => ({
      course_id: c.id,
      sort_order: courses.body.length - 1 - i,
    }));

    await agent
      .put(`/api/menus/${menuId}/courses/reorder`)
      .send({ order })
      .expect(200);
  });

  test('assigns dish to course', async () => {
    const dishId = await createDish('Course Dish');
    const courses = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const courseId = courses.body[0].id;

    await agent
      .post(`/api/menus/${menuId}/dishes`)
      .send({ dish_id: dishId, servings: 1, course_id: courseId })
      .expect(201);

    const detail = await agent.get(`/api/menus/${menuId}`).expect(200);
    const dish = detail.body.dishes.find(d => d.id === dishId);
    expect(dish.course_id).toBe(courseId);
  });

  test('moves dish between courses', async () => {
    const courses = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const detail = await agent.get(`/api/menus/${menuId}`).expect(200);
    const dish = detail.body.dishes[0];
    const targetCourseId = courses.body[1].id;

    await agent
      .put(`/api/menus/${menuId}/dishes/${dish.id}`)
      .send({ course_id: targetCourseId })
      .expect(200);

    const updated = await agent.get(`/api/menus/${menuId}`).expect(200);
    const movedDish = updated.body.dishes.find(d => d.id === dish.id);
    expect(movedDish.course_id).toBe(targetCourseId);
  });

  test('dish notes on menu_dishes', async () => {
    const detail = await agent.get(`/api/menus/${menuId}`).expect(200);
    const dish = detail.body.dishes[0];

    await agent
      .put(`/api/menus/${menuId}/dishes/${dish.id}`)
      .send({ notes: 'Serve first, fire after speeches' })
      .expect(200);

    const updated = await agent.get(`/api/menus/${menuId}`).expect(200);
    const updatedDish = updated.body.dishes.find(d => d.id === dish.id);
    expect(updatedDish.menu_dish_notes).toBe('Serve first, fire after speeches');
  });

  test('deletes course and unassigns dishes', async () => {
    const courses = await agent.get(`/api/menus/${menuId}/courses`).expect(200);
    const courseId = courses.body[1].id;
    const detail = await agent.get(`/api/menus/${menuId}`).expect(200);
    const dishesInCourse = detail.body.dishes.filter(d => d.course_id === courseId);

    await agent.delete(`/api/menus/${menuId}/courses/${courseId}`).expect(200);

    const updated = await agent.get(`/api/menus/${menuId}`).expect(200);
    // Dishes should still exist but with null course_id
    for (const d of dishesInCourse) {
      const updatedDish = updated.body.dishes.find(dd => dd.id === d.id);
      expect(updatedDish).toBeDefined();
      expect(updatedDish.course_id).toBeNull();
    }
  });

  test('returns 404 for non-existent course', async () => {
    await agent.delete(`/api/menus/${menuId}/courses/99999`).expect(404);
  });
});

// ─── COURSE TEMPLATES ──────────────────────────────────────────────────────

describe('Course templates', () => {
  test('applies 3-course template', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Template Menu', service_style: 'coursed' })
      .expect(201);

    const res = await agent
      .post(`/api/menus/${menu.body.id}/courses/from-template`)
      .send({ template: '3-course' })
      .expect(201);

    expect(res.body.courses).toHaveLength(3);
    expect(res.body.courses[0].name).toBe('Starter');
    expect(res.body.courses[1].name).toBe('Main');
    expect(res.body.courses[2].name).toBe('Dessert');
  });

  test('applies 5-course template', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Template Menu 5', service_style: 'coursed' })
      .expect(201);

    const res = await agent
      .post(`/api/menus/${menu.body.id}/courses/from-template`)
      .send({ template: '5-course' })
      .expect(201);

    expect(res.body.courses).toHaveLength(5);
  });

  test('applies tasting template', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Template Menu Tasting', service_style: 'coursed' })
      .expect(201);

    const res = await agent
      .post(`/api/menus/${menu.body.id}/courses/from-template`)
      .send({ template: 'tasting' })
      .expect(201);

    expect(res.body.courses).toHaveLength(7);
  });

  test('rejects invalid template', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Bad Template Menu' })
      .expect(201);

    await agent
      .post(`/api/menus/${menu.body.id}/courses/from-template`)
      .send({ template: 'invalid' })
      .expect(400);
  });
});

// ─── KITCHEN PRINT WITH COURSES ─────────────────────────────────────────────

describe('Kitchen print with courses', () => {
  test('includes courses and courseMap in kitchen print', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Print Course Menu', service_style: 'coursed' })
      .expect(201);

    const courseRes = await agent
      .post(`/api/menus/${menu.body.id}/courses`)
      .send({ name: 'Starter', notes: 'Light and fresh' })
      .expect(201);

    const dishId = await createDish('Print Course Dish');
    await agent
      .post(`/api/menus/${menu.body.id}/dishes`)
      .send({ dish_id: dishId, servings: 1, course_id: courseRes.body.id })
      .expect(201);

    const res = await agent.get(`/api/menus/${menu.body.id}/kitchen-print`).expect(200);
    expect(res.body.courses).toBeDefined();
    expect(res.body.courses.length).toBe(1);
    expect(res.body.courses[0].name).toBe('Starter');
    expect(res.body.courseMap).toBeDefined();
    expect(res.body.unassigned).toBeDefined();
  });

  test('includes dish notes in kitchen print', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Note Print Menu' })
      .expect(201);

    const dishId = await createDish('Note Print Dish');
    await agent
      .post(`/api/menus/${menu.body.id}/dishes`)
      .send({ dish_id: dishId, servings: 1 })
      .expect(201);

    await agent
      .put(`/api/menus/${menu.body.id}/dishes/${dishId}`)
      .send({ notes: 'Garnish with herbs' })
      .expect(200);

    const res = await agent.get(`/api/menus/${menu.body.id}/kitchen-print`).expect(200);
    const dish = res.body.dishes.find(d => d.id === dishId);
    expect(dish.menu_dish_notes).toBe('Garnish with herbs');
  });

  test('menu list includes course_count', async () => {
    const menu = await agent
      .post('/api/menus')
      .send({ name: 'Count Menu', service_style: 'coursed' })
      .expect(201);

    await agent.post(`/api/menus/${menu.body.id}/courses`).send({ name: 'Starter' }).expect(201);
    await agent.post(`/api/menus/${menu.body.id}/courses`).send({ name: 'Main' }).expect(201);

    const list = await agent.get('/api/menus').expect(200);
    const m = list.body.find(x => x.id === menu.body.id);
    expect(m.course_count).toBe(2);
  });
});
