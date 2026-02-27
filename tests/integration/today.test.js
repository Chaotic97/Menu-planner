'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, agent, cleanup;

beforeAll(async () => {
  ({ app, cleanup } = await createTestApp());
  agent = await loginAgent(app);
});

afterAll(() => {
  if (cleanup) cleanup();
});

// ─── GET /api/today ─────────────────────────────────────────────────────────

describe('GET /api/today', () => {
  test('returns today data with phases, overdue, progress', async () => {
    const today = new Date().toISOString().slice(0, 10);

    // Create a task for today
    await agent.post('/api/todos').send({ title: 'Today task', due_date: today }).expect(201);

    const res = await agent.get('/api/today').expect(200);

    expect(res.body).toHaveProperty('date', today);
    expect(res.body).toHaveProperty('phases');
    expect(Array.isArray(res.body.phases)).toBe(true);
    expect(res.body).toHaveProperty('unscheduled');
    expect(res.body).toHaveProperty('overdue');
    expect(res.body).toHaveProperty('progress');
    expect(res.body.progress).toHaveProperty('total');
    expect(res.body.progress).toHaveProperty('completed');
  });

  test('groups tasks by day_phase', async () => {
    const today = new Date().toISOString().slice(0, 10);

    await agent.post('/api/todos').send({ title: 'Admin task', due_date: today, day_phase: 'admin' }).expect(201);
    await agent.post('/api/todos').send({ title: 'Prep task', due_date: today, day_phase: 'prep' }).expect(201);

    const res = await agent.get('/api/today').expect(200);

    const adminPhase = res.body.phases.find(p => p.id === 'admin');
    const prepPhase = res.body.phases.find(p => p.id === 'prep');

    expect(adminPhase.tasks.some(t => t.title === 'Admin task')).toBe(true);
    expect(prepPhase.tasks.some(t => t.title === 'Prep task')).toBe(true);
  });

  test('includes overdue tasks', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    await agent.post('/api/todos').send({ title: 'Overdue task', due_date: yesterdayStr }).expect(201);

    const res = await agent.get('/api/today').expect(200);
    expect(res.body.overdue.some(t => t.title === 'Overdue task')).toBe(true);
  });

  test('accepts date query parameter', async () => {
    const res = await agent.get('/api/today?date=2026-03-15').expect(200);
    expect(res.body.date).toBe('2026-03-15');
  });

  test('tracks next_task', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const created = await agent.post('/api/todos').send({ title: 'Next one', due_date: today }).expect(201);

    await agent.put(`/api/todos/${created.body.id}/next`).expect(200);

    const res = await agent.get('/api/today').expect(200);
    expect(res.body.next_task).not.toBeNull();
    expect(res.body.next_task.title).toBe('Next one');
  });
});

// ─── GET /api/today/summary ─────────────────────────────────────────────────

describe('GET /api/today/summary', () => {
  test('returns summary with completed, added, incomplete, tomorrow', async () => {
    const res = await agent.get('/api/today/summary').expect(200);

    expect(res.body).toHaveProperty('date');
    expect(res.body).toHaveProperty('completed');
    expect(res.body).toHaveProperty('added');
    expect(res.body).toHaveProperty('incomplete');
    expect(res.body).toHaveProperty('tomorrow');
    expect(res.body.tomorrow).toHaveProperty('date');
    expect(res.body.tomorrow).toHaveProperty('task_count');
    expect(res.body.tomorrow).toHaveProperty('tasks');
  });

  test('shows tasks completed today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = await agent.post('/api/todos').send({ title: 'To complete', due_date: today }).expect(201);
    await agent.put(`/api/todos/${t.body.id}`).send({ completed: true }).expect(200);

    const res = await agent.get('/api/today/summary').expect(200);
    expect(res.body.completed.some(task => task.title === 'To complete')).toBe(true);
  });
});

// ─── GET/PUT /api/today/day-phases ──────────────────────────────────────────

describe('GET /api/today/day-phases', () => {
  test('returns default phases', async () => {
    const res = await agent.get('/api/today/day-phases').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(4);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('start');
    expect(res.body[0]).toHaveProperty('end');
  });
});

describe('PUT /api/today/day-phases', () => {
  test('saves custom phases', async () => {
    const customPhases = [
      { id: 'morning', name: 'Morning', start: '08:00', end: '12:00' },
      { id: 'afternoon', name: 'Afternoon', start: '12:00', end: '17:00' },
    ];

    const res = await agent.put('/api/today/day-phases')
      .send({ phases: customPhases })
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body[0].name).toBe('Morning');

    // Verify persistence
    const getRes = await agent.get('/api/today/day-phases').expect(200);
    expect(getRes.body).toHaveLength(2);
  });

  test('rejects non-array', async () => {
    await agent.put('/api/today/day-phases')
      .send({ phases: 'invalid' })
      .expect(400);
  });

  test('rejects phases missing required fields', async () => {
    await agent.put('/api/today/day-phases')
      .send({ phases: [{ id: 'x' }] })
      .expect(400);
  });

  test('rejects invalid time format', async () => {
    await agent.put('/api/today/day-phases')
      .send({ phases: [{ id: 'x', name: 'X', start: '8am', end: '12pm' }] })
      .expect(400);
  });
});

// ─── PUT /api/todos/:id/next ────────────────────────────────────────────────

describe('PUT /api/todos/:id/next', () => {
  test('sets a task as next', async () => {
    const t = await agent.post('/api/todos').send({ title: 'Focus task' }).expect(201);

    const res = await agent.put(`/api/todos/${t.body.id}/next`).expect(200);
    expect(res.body.success).toBe(true);

    // Verify
    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(x => x.id === t.body.id);
    expect(task.is_next).toBe(1);
  });

  test('clears previous next when setting a new one', async () => {
    const t1 = await agent.post('/api/todos').send({ title: 'First next' }).expect(201);
    const t2 = await agent.post('/api/todos').send({ title: 'Second next' }).expect(201);

    await agent.put(`/api/todos/${t1.body.id}/next`).expect(200);
    await agent.put(`/api/todos/${t2.body.id}/next`).expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const first = tasks.body.find(x => x.id === t1.body.id);
    const second = tasks.body.find(x => x.id === t2.body.id);
    expect(first.is_next).toBe(0);
    expect(second.is_next).toBe(1);
  });

  test('returns 404 for non-existent task', async () => {
    await agent.put('/api/todos/99999/next').expect(404);
  });
});

// ─── DELETE /api/todos/next ─────────────────────────────────────────────────

describe('DELETE /api/todos/next', () => {
  test('clears the next flag', async () => {
    const t = await agent.post('/api/todos').send({ title: 'Clear me' }).expect(201);
    await agent.put(`/api/todos/${t.body.id}/next`).expect(200);

    await agent.delete('/api/todos/next').expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(x => x.id === t.body.id);
    expect(task.is_next).toBe(0);
  });
});

// ─── day_phase on tasks ─────────────────────────────────────────────────────

describe('Task day_phase field', () => {
  test('creates task with day_phase', async () => {
    const res = await agent.post('/api/todos')
      .send({ title: 'Phased task', day_phase: 'prep' })
      .expect(201);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(t => t.id === res.body.id);
    expect(task.day_phase).toBe('prep');
  });

  test('updates task day_phase', async () => {
    const t = await agent.post('/api/todos').send({ title: 'Update phase' }).expect(201);

    await agent.put(`/api/todos/${t.body.id}`)
      .send({ day_phase: 'service' })
      .expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(x => x.id === t.body.id);
    expect(task.day_phase).toBe('service');
  });

  test('clears day_phase when set to null', async () => {
    const t = await agent.post('/api/todos')
      .send({ title: 'Clear phase', day_phase: 'admin' })
      .expect(201);

    await agent.put(`/api/todos/${t.body.id}`)
      .send({ day_phase: null })
      .expect(200);

    const tasks = await agent.get('/api/todos').expect(200);
    const task = tasks.body.find(x => x.id === t.body.id);
    expect(task.day_phase).toBeNull();
  });
});
