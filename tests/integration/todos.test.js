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

// ─── LEGACY ENDPOINTS (unchanged) ───────────────────────────────────────────

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

describe('Scaling with batch_yield and expected_covers', () => {
  test('uses expected_covers as base when set on menu', async () => {
    const dish = await agent.post('/api/dishes').send({
      name: 'Scale Test Dish',
      category: 'main',
      batch_yield: 4,
      ingredients: [{ name: 'ScaleTestIng', quantity: 100, unit: 'g', unit_cost: 0.01 }],
    }).expect(201);

    const menu = await agent.post('/api/menus').send({
      name: 'Expected Covers Menu',
      expected_covers: 20,
    }).expect(201);

    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dish.body.id, servings: 2 });

    // base should be expected_covers=20, so factor for 40 covers = 2
    const scaled = await agent.get(`/api/todos/menu/${menu.body.id}/scaled-shopping-list?covers=40`).expect(200);

    expect(scaled.body.base_covers).toBe(20);
    expect(scaled.body.scale_factor).toBe(2);
    expect(scaled.body.base_covers_source).toBe('expected');
  });

  test('computes base covers from servings * batch_yield when expected_covers not set', async () => {
    const dish = await agent.post('/api/dishes').send({
      name: 'Yield Scale Dish',
      category: 'main',
      batch_yield: 5,
      ingredients: [{ name: 'YieldScaleIng', quantity: 200, unit: 'g', unit_cost: 0.01 }],
    }).expect(201);

    const menu = await agent.post('/api/menus').send({ name: 'No Covers Menu' }).expect(201);

    // 3 servings * 5 batch_yield = 15 computed portions
    await agent.post(`/api/menus/${menu.body.id}/dishes`).send({ dish_id: dish.body.id, servings: 3 });

    // base should be computed 15, so factor for 30 covers = 2
    const scaled = await agent.get(`/api/todos/menu/${menu.body.id}/scaled-shopping-list?covers=30`).expect(200);

    expect(scaled.body.base_covers).toBe(15);
    expect(scaled.body.scale_factor).toBe(2);
    expect(scaled.body.base_covers_source).toBe('computed');
  });

  test('shopping list returns computed_covers', async () => {
    const res = await agent.get(`/api/todos/menu/${menuId}/shopping-list`).expect(200);
    expect(res.body).toHaveProperty('computed_covers');
    expect(typeof res.body.computed_covers).toBe('number');
  });
});

describe('GET /api/todos/menu/:id/prep-tasks', () => {
  test('returns prep tasks grouped by timing', async () => {
    const res = await agent.get(`/api/todos/menu/${menuId}/prep-tasks`).expect(200);

    expect(res.body.task_groups).toBeDefined();
    expect(Array.isArray(res.body.task_groups)).toBe(true);
    expect(res.body.total_tasks).toBeGreaterThan(0);
    expect(res.body.task_groups.some(g => g.tasks.length > 0)).toBe(true);
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.get('/api/todos/menu/99999/prep-tasks').expect(404);
  });
});

// ─── GENERATE TASKS ──────────────────────────────────────────────────────────

describe('POST /api/todos/generate/:menuId', () => {
  test('generates and persists prep tasks from a menu', async () => {
    const res = await agent.post(`/api/todos/generate/${menuId}`).expect(201);

    expect(res.body.menu_id).toBe(menuId);
    expect(res.body.prep_count).toBeGreaterThan(0);
    expect(res.body.total).toBe(res.body.prep_count);
  });

  test('returns 404 for non-existent menu', async () => {
    await agent.post('/api/todos/generate/99999').expect(404);
  });

  test('regeneration replaces auto tasks', async () => {
    const first = await agent.post(`/api/todos/generate/${menuId}`).expect(201);
    const second = await agent.post(`/api/todos/generate/${menuId}`).expect(201);

    expect(second.body.total).toBe(first.body.total);

    // Should not have doubled the count
    const tasks = await agent.get(`/api/todos?menu_id=${menuId}`).expect(200);
    const autoTasks = tasks.body.filter(t => t.source === 'auto' && t.menu_id === menuId);
    expect(autoTasks.length).toBe(second.body.total);
  });
});

// ─── LIST TASKS ──────────────────────────────────────────────────────────────

describe('GET /api/todos', () => {
  test('returns all tasks', async () => {
    const res = await agent.get('/api/todos').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('filters by type', async () => {
    const res = await agent.get('/api/todos?type=prep').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const task of res.body) {
      expect(task.type).toBe('prep');
    }
  });

  test('filters by priority', async () => {
    const res = await agent.get('/api/todos?priority=medium').expect(200);
    for (const task of res.body) {
      expect(task.priority).toBe('medium');
    }
  });

  test('filters completed tasks', async () => {
    const res = await agent.get('/api/todos?completed=0').expect(200);
    for (const task of res.body) {
      expect(task.completed).toBe(0);
    }
  });

  test('includes menu_name in response', async () => {
    const res = await agent.get(`/api/todos?menu_id=${menuId}`).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].menu_name).toBe('Todo Test Menu');
  });
});

// ─── CREATE TASK ─────────────────────────────────────────────────────────────

describe('POST /api/todos', () => {
  test('creates a custom task', async () => {
    const res = await agent
      .post('/api/todos')
      .send({ title: 'Call fish supplier', priority: 'high', due_date: '2026-03-01' })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('creates a task with all fields', async () => {
    const res = await agent
      .post('/api/todos')
      .send({
        title: 'Order wine',
        description: 'Need 3 cases of Pinot',
        type: 'custom',
        priority: 'medium',
        due_date: '2026-03-05',
        due_time: '10:00',
        menu_id: menuId,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('rejects missing title', async () => {
    await agent.post('/api/todos').send({ priority: 'high' }).expect(400);
  });

  test('rejects invalid type', async () => {
    await agent.post('/api/todos').send({ title: 'Test', type: 'invalid' }).expect(400);
  });

  test('rejects shopping type (no longer valid)', async () => {
    await agent.post('/api/todos').send({ title: 'Test', type: 'shopping' }).expect(400);
  });

  test('rejects invalid priority', async () => {
    await agent.post('/api/todos').send({ title: 'Test', priority: 'critical' }).expect(400);
  });

  test('rejects invalid date format', async () => {
    await agent.post('/api/todos').send({ title: 'Test', due_date: '27-03-2026' }).expect(400);
  });

  test('rejects invalid time format', async () => {
    await agent.post('/api/todos').send({ title: 'Test', due_time: '10am' }).expect(400);
  });
});

// ─── UPDATE TASK ─────────────────────────────────────────────────────────────

describe('PUT /api/todos/:id', () => {
  let taskId;

  beforeAll(async () => {
    const res = await agent
      .post('/api/todos')
      .send({ title: 'Update test task', priority: 'low' })
      .expect(201);
    taskId = res.body.id;
  });

  test('updates task fields', async () => {
    await agent
      .put(`/api/todos/${taskId}`)
      .send({ title: 'Updated title', priority: 'high', due_date: '2026-03-10' })
      .expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(t => t.id === taskId);
    expect(task.title).toBe('Updated title');
    expect(task.priority).toBe('high');
    expect(task.due_date).toBe('2026-03-10');
  });

  test('marks task as completed', async () => {
    await agent.put(`/api/todos/${taskId}`).send({ completed: true }).expect(200);

    const tasks = await agent.get('/api/todos?completed=1').expect(200);
    const task = tasks.body.find(t => t.id === taskId);
    expect(task.completed).toBe(1);
    expect(task.completed_at).toBeDefined();
  });

  test('marks task as uncompleted', async () => {
    await agent.put(`/api/todos/${taskId}`).send({ completed: false }).expect(200);

    const tasks = await agent.get('/api/todos?completed=0').expect(200);
    const task = tasks.body.find(t => t.id === taskId);
    expect(task.completed).toBe(0);
    expect(task.completed_at).toBeNull();
  });

  test('clears due date when set to null', async () => {
    await agent.put(`/api/todos/${taskId}`).send({ due_date: null }).expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(t => t.id === taskId);
    expect(task.due_date).toBeNull();
  });

  test('rejects nothing to update', async () => {
    await agent.put(`/api/todos/${taskId}`).send({}).expect(400);
  });

  test('rejects invalid priority', async () => {
    await agent.put(`/api/todos/${taskId}`).send({ priority: 'urgent' }).expect(400);
  });

  test('returns 404 for non-existent task', async () => {
    await agent.put('/api/todos/99999').send({ title: 'Nope' }).expect(404);
  });

  test('promotes auto task to manual on content edit', async () => {
    // Generate tasks to get auto prep tasks
    await agent.post(`/api/todos/generate/${menuId}`).expect(201);
    const tasks = await agent.get(`/api/todos?menu_id=${menuId}&type=prep`).expect(200);
    const autoTask = tasks.body.find(t => t.source === 'auto');
    expect(autoTask).toBeDefined();

    // Edit the auto task's title
    await agent.put(`/api/todos/${autoTask.id}`).send({ title: 'Custom title' }).expect(200);

    const updated = await agent.get('/api/todos').expect(200);
    const task = updated.body.find(t => t.id === autoTask.id);
    expect(task.source).toBe('manual');
    expect(task.title).toBe('Custom title');
  });
});

// ─── DELETE TASK ─────────────────────────────────────────────────────────────

describe('DELETE /api/todos/:id', () => {
  test('deletes a task', async () => {
    const created = await agent.post('/api/todos').send({ title: 'Delete me' }).expect(201);
    await agent.delete(`/api/todos/${created.body.id}`).expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    expect(tasks.body.find(t => t.id === created.body.id)).toBeUndefined();
  });

  test('returns 404 for non-existent task', async () => {
    await agent.delete('/api/todos/99999').expect(404);
  });
});

// ─── BATCH COMPLETE ──────────────────────────────────────────────────────────

describe('POST /api/todos/batch-complete', () => {
  test('batch completes multiple tasks', async () => {
    const t1 = await agent.post('/api/todos').send({ title: 'Batch 1' }).expect(201);
    const t2 = await agent.post('/api/todos').send({ title: 'Batch 2' }).expect(201);

    await agent
      .post('/api/todos/batch-complete')
      .send({ task_ids: [t1.body.id, t2.body.id], completed: true })
      .expect(200);

    const tasks = await agent.get('/api/todos?completed=1').expect(200);
    const ids = tasks.body.map(t => t.id);
    expect(ids).toContain(t1.body.id);
    expect(ids).toContain(t2.body.id);
  });

  test('batch uncompletes tasks', async () => {
    const t1 = await agent.post('/api/todos').send({ title: 'Unbatch' }).expect(201);
    await agent.post('/api/todos/batch-complete').send({ task_ids: [t1.body.id], completed: true }).expect(200);
    await agent.post('/api/todos/batch-complete').send({ task_ids: [t1.body.id], completed: false }).expect(200);

    const tasks = await agent.get('/api/todos?completed=0').expect(200);
    const task = tasks.body.find(t => t.id === t1.body.id);
    expect(task.completed).toBe(0);
  });

  test('rejects empty task_ids', async () => {
    await agent.post('/api/todos/batch-complete').send({ task_ids: [], completed: true }).expect(400);
  });

  test('rejects missing task_ids', async () => {
    await agent.post('/api/todos/batch-complete').send({ completed: true }).expect(400);
  });
});
