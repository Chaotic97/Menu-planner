---
globs: ["tests/**"]
---
# Test Conventions

## Framework
- Jest. Run with `npm test`.

## Unit tests (`tests/*.test.js`)
- Pure functions only, no DB/network. Place in `tests/`.

## Integration tests (`tests/integration/*.test.js`)
- Full request→response via supertest against in-memory SQLite.
- Setup: `createTestApp()` from `tests/helpers/setupTestApp.js` (fresh DB per suite).
- Auth: `loginAgent(app)` from `tests/helpers/auth.js` (sets up password, returns authenticated agent).
- **Every integration test must mock rate limiting:**
  ```js
  jest.mock('../../middleware/rateLimit', () => ({
    createRateLimit: () => (_req, _res, next) => next()
  }));
  ```

## Rules
- `extractTiming` and `extractPrepTasks` are exported from `prepTaskGenerator.js` for testing — keep them exported.
- Do not test IEEE 754 half-way rounding in `round2` (e.g. `1.005`) — use `toBeCloseTo`.
