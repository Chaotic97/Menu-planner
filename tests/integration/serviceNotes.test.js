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

describe('POST /api/service-notes', () => {
  test('creates a service note', async () => {
    const res = await agent
      .post('/api/service-notes')
      .send({ date: '2026-02-27', shift: 'lunch', title: '86 List', content: 'No halibut today' })
      .expect(201);

    expect(res.body.id).toBeDefined();
  });

  test('rejects missing date', async () => {
    await agent
      .post('/api/service-notes')
      .send({ title: 'No date', content: 'test' })
      .expect(400);
  });

  test('rejects invalid date format', async () => {
    await agent
      .post('/api/service-notes')
      .send({ date: '27-02-2026', content: 'test' })
      .expect(400);
  });

  test('rejects invalid shift', async () => {
    await agent
      .post('/api/service-notes')
      .send({ date: '2026-02-27', shift: 'midnight', content: 'test' })
      .expect(400);
  });

  test('rejects empty content and title', async () => {
    await agent
      .post('/api/service-notes')
      .send({ date: '2026-02-27' })
      .expect(400);
  });

  test('defaults shift to all', async () => {
    const res = await agent
      .post('/api/service-notes')
      .send({ date: '2026-02-28', title: 'Default shift' })
      .expect(201);

    const notes = await agent.get('/api/service-notes?date=2026-02-28').expect(200);
    const note = notes.body.find(n => n.id === res.body.id);
    expect(note.shift).toBe('all');
  });
});

// ─── LIST ─────────────────────────────────────────────────────────────────────

describe('GET /api/service-notes', () => {
  test('returns notes for a specific date', async () => {
    const res = await agent.get('/api/service-notes?date=2026-02-27').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].date).toBe('2026-02-27');
  });

  test('returns notes without filters (last 30 days)', async () => {
    const res = await agent.get('/api/service-notes').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/service-notes/dates', () => {
  test('returns dates that have notes', async () => {
    const res = await agent.get('/api/service-notes/dates').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('2026-02-27');
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

describe('PUT /api/service-notes/:id', () => {
  test('updates note content', async () => {
    const created = await agent
      .post('/api/service-notes')
      .send({ date: '2026-03-01', title: 'Update Test', content: 'Original' })
      .expect(201);

    await agent
      .put(`/api/service-notes/${created.body.id}`)
      .send({ content: 'Updated content', shift: 'pm' })
      .expect(200);

    const notes = await agent.get('/api/service-notes?date=2026-03-01').expect(200);
    const note = notes.body.find(n => n.id === created.body.id);
    expect(note.content).toBe('Updated content');
    expect(note.shift).toBe('pm');
  });

  test('rejects invalid date format on update', async () => {
    const created = await agent
      .post('/api/service-notes')
      .send({ date: '2026-03-02', content: 'test' })
      .expect(201);

    await agent
      .put(`/api/service-notes/${created.body.id}`)
      .send({ date: 'bad-date' })
      .expect(400);
  });

  test('rejects invalid shift on update', async () => {
    const created = await agent
      .post('/api/service-notes')
      .send({ date: '2026-03-03', content: 'test' })
      .expect(201);

    await agent
      .put(`/api/service-notes/${created.body.id}`)
      .send({ shift: 'invalid' })
      .expect(400);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/service-notes/:id', () => {
  test('hard-deletes a note', async () => {
    const created = await agent
      .post('/api/service-notes')
      .send({ date: '2026-03-04', content: 'Delete me' })
      .expect(201);

    await agent.delete(`/api/service-notes/${created.body.id}`).expect(200);

    const notes = await agent.get('/api/service-notes?date=2026-03-04').expect(200);
    expect(notes.body.find(n => n.id === created.body.id)).toBeUndefined();
  });
});
