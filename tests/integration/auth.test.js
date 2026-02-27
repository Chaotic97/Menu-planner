'use strict';

// Disable rate limiting for tests
jest.mock('../../middleware/rateLimit', () => ({
  createRateLimit: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const { createTestApp } = require('../helpers/setupTestApp');

let app, cleanup;

beforeAll(async () => {
  const ctx = await createTestApp();
  app = ctx.app;
  cleanup = ctx.cleanup;
});

afterAll(() => cleanup());

// Helper: login and return an agent with a valid session
async function login(password = 'testpass123') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ password });
  return agent;
}

// ─── Auth status ──────────────────────────────────────────────────────────────

describe('GET /api/auth/status', () => {
  test('returns isSetup=false before setup', async () => {
    const res = await request(app).get('/api/auth/status').expect(200);
    expect(res.body).toEqual({ isSetup: false, isAuthenticated: false });
  });
});

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/setup', () => {
  test('rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ password: '12345', email: 'a@b.com' })
      .expect(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  test('rejects missing email', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ password: 'testpass123' })
      .expect(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('creates password and logs in', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/setup')
      .send({ password: 'testpass123', email: 'chef@test.com' })
      .expect(200);
    expect(res.body.success).toBe(true);

    // Should now be authenticated
    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body.isSetup).toBe(true);
    expect(status.body.isAuthenticated).toBe(true);
  });

  test('rejects second setup attempt', async () => {
    const res = await request(app)
      .post('/api/auth/setup')
      .send({ password: 'another123', email: 'x@y.com' })
      .expect(400);
    expect(res.body.error).toMatch(/already configured/i);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  test('rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'wrong' })
      .expect(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('rejects empty password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({})
      .expect(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('logs in with correct password', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/auth/login')
      .send({ password: 'testpass123' })
      .expect(200);
    expect(res.body.success).toBe(true);

    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body.isAuthenticated).toBe(true);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  test('destroys session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ password: 'testpass123' }).expect(200);

    await agent.post('/api/auth/logout').expect(200);

    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body.isAuthenticated).toBe(false);
  });
});

// ─── Change password ──────────────────────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
  // Use a single agent for all change-password tests to minimize login calls
  let agent;

  beforeAll(async () => {
    agent = await login('testpass123');
  });

  test('rejects unauthenticated request', async () => {
    await request(app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'testpass123', newPassword: 'newpass123' })
      .expect(401);
  });

  test('rejects wrong current password', async () => {
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'newpass123' })
      .expect(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('rejects short new password', async () => {
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'testpass123', newPassword: '12345' })
      .expect(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  test('changes password successfully', async () => {
    await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'testpass123', newPassword: 'newpass123' })
      .expect(200);

    // New password should work
    const agent2 = await login('newpass123');
    const status = await agent2.get('/api/auth/status').expect(200);
    expect(status.body.isAuthenticated).toBe(true);
  });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

describe('Auth middleware', () => {
  test('blocks unauthenticated API requests', async () => {
    const res = await request(app).get('/api/dishes').expect(401);
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  test('allows public auth endpoints without session', async () => {
    await request(app).get('/api/auth/status').expect(200);
  });
});
