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

## E2E tests (`tests/e2e/*.spec.js`)
- Playwright with Chromium. Run with `npm run test:e2e`.
- Spins up a real server on port 3001 with a disposable `test-e2e.db`.
- Auth handled via `global-setup.js` project — saves session to `tests/e2e/.auth/state.json`, reused by smoke tests.
- Smoke tests cover page navigation, dish/menu/service-note CRUD.
- Config in `playwright.config.js`. Jest excludes `tests/e2e/` via `--testPathIgnorePatterns`.

## Rules
- `extractTiming` and `extractPrepTasks` are exported from `prepTaskGenerator.js` for testing — keep them exported.
- Do not test IEEE 754 half-way rounding in `round2` (e.g. `1.005`) — use `toBeCloseTo`.
