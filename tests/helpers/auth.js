'use strict';

const request = require('supertest');

/**
 * Sets up the app's password (via /api/auth/setup) and returns an
 * authenticated supertest agent with a valid session cookie.
 *
 * Usage:
 *   const agent = await loginAgent(app);
 *   await agent.get('/api/dishes').expect(200);
 */
async function loginAgent(app, password = 'testpass123', email = 'test@example.com') {
  const agent = request.agent(app);

  // First setup
  await agent
    .post('/api/auth/setup')
    .send({ password, email })
    .expect(200);

  return agent;
}

module.exports = { loginAgent };
