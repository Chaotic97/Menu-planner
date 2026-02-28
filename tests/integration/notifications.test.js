'use strict';

jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const { createTestApp } = require('../helpers/setupTestApp');
const { loginAgent } = require('../helpers/auth');

let app, agent, cleanup;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  cleanup = ctx.cleanup;
  agent = await loginAgent(app);
});

afterAll(() => cleanup());

describe('Notification Preferences', () => {
  test('GET /api/notifications/preferences returns defaults when no prefs saved', async () => {
    const res = await agent.get('/api/notifications/preferences').expect(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.prep_reminders).toBe(true);
    expect(res.body.prep_lead_minutes).toBe(15);
    expect(res.body.task_due_reminders).toBe(true);
    expect(res.body.task_lead_minutes).toBe(10);
    expect(res.body.overdue_alerts).toBe(true);
    expect(res.body.overdue_interval_minutes).toBe(30);
    expect(res.body.daily_briefing).toBe(true);
    expect(res.body.daily_briefing_time).toBe('08:00');
    expect(res.body.specials_expiring).toBe(true);
  });

  test('PUT /api/notifications/preferences saves and returns merged prefs', async () => {
    const res = await agent
      .put('/api/notifications/preferences')
      .send({ enabled: true, prep_lead_minutes: 20, daily_briefing_time: '07:30' })
      .expect(200);

    expect(res.body.enabled).toBe(true);
    expect(res.body.prep_lead_minutes).toBe(20);
    expect(res.body.daily_briefing_time).toBe('07:30');
    // Defaults preserved
    expect(res.body.task_lead_minutes).toBe(10);
  });

  test('GET /api/notifications/preferences returns saved prefs', async () => {
    const res = await agent.get('/api/notifications/preferences').expect(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.prep_lead_minutes).toBe(20);
    expect(res.body.daily_briefing_time).toBe('07:30');
  });

  test('PUT /api/notifications/preferences merges with existing', async () => {
    const res = await agent
      .put('/api/notifications/preferences')
      .send({ task_lead_minutes: 5 })
      .expect(200);

    // New value
    expect(res.body.task_lead_minutes).toBe(5);
    // Previous values preserved
    expect(res.body.enabled).toBe(true);
    expect(res.body.prep_lead_minutes).toBe(20);
  });

  test('rejects invalid numeric fields', async () => {
    const res = await agent
      .put('/api/notifications/preferences')
      .send({ prep_lead_minutes: 200 })
      .expect(400);
    expect(res.body.error).toMatch(/prep_lead_minutes/);
  });

  test('rejects invalid time format', async () => {
    const res = await agent
      .put('/api/notifications/preferences')
      .send({ daily_briefing_time: '8am' })
      .expect(400);
    expect(res.body.error).toMatch(/daily_briefing_time/);
  });

  test('ignores unknown keys', async () => {
    const res = await agent
      .put('/api/notifications/preferences')
      .send({ unknown_field: 'test', enabled: false })
      .expect(200);

    expect(res.body.unknown_field).toBeUndefined();
    expect(res.body.enabled).toBe(false);
  });
});

describe('Notification Pending', () => {
  test('GET /api/notifications/pending returns structure', async () => {
    const res = await agent.get('/api/notifications/pending').expect(200);
    expect(res.body).toHaveProperty('date');
    expect(res.body).toHaveProperty('now');
    expect(res.body).toHaveProperty('overdue');
    expect(res.body).toHaveProperty('upcoming_today');
    expect(res.body).toHaveProperty('today_summary');
    expect(res.body).toHaveProperty('expiring_specials');
    expect(res.body).toHaveProperty('phases');
    expect(Array.isArray(res.body.overdue)).toBe(true);
    expect(Array.isArray(res.body.upcoming_today)).toBe(true);
    expect(Array.isArray(res.body.expiring_specials)).toBe(true);
  });

  test('pending includes overdue tasks', async () => {
    // Create a task due yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    await agent.post('/api/todos').send({
      title: 'Overdue prep task',
      type: 'prep',
      due_date: yesterdayStr,
      priority: 'high',
    }).expect(201);

    const res = await agent.get('/api/notifications/pending').expect(200);
    expect(res.body.overdue.length).toBeGreaterThanOrEqual(1);
    expect(res.body.overdue.some(t => t.title === 'Overdue prep task')).toBe(true);
  });

  test('pending includes today summary counts', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await agent.post('/api/todos').send({
      title: 'Today task',
      type: 'custom',
      due_date: today,
    }).expect(201);

    const res = await agent.get('/api/notifications/pending').expect(200);
    expect(res.body.today_summary.total).toBeGreaterThanOrEqual(1);
  });
});
