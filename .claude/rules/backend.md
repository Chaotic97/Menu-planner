---
globs: ["server.js", "db/**", "middleware/**", "routes/**", "services/**"]
---
# Backend Conventions

## Module system
- **CommonJS only** — `require()` / `module.exports`. Never use `import`/`export`.

## Route handlers
- Use `asyncHandler` for any route with `await` or that could throw:
  ```js
  const asyncHandler = require('../middleware/asyncHandler');
  router.post('/my-thing', asyncHandler(async (req, res) => { ... }));
  ```
- Success: `res.json(data)` (200) or `res.status(201).json(data)` for creates.
- Errors: always `res.status(N).json({ error: 'Human-readable message' })`. The `error` key is what `api.js` reads.
- Mount new routers in `server.js` under `/api/your-path`.
- Broadcast on any mutation: `req.broadcast('event_type', payload, req.headers['x-client-id'])`.
- To make an endpoint public, add its path to `PUBLIC_PATHS` in `middleware/auth.js`.

## Input validation
- Numeric fields: `typeof val !== 'number' || isNaN(val) || val < 0` → 400
- Required strings: `!val || typeof val !== 'string' || !val.trim()` → 400
- Enum fields: check against a `VALID_*` array → 400
- Restore/delete: check `result.changes === 0` → 404

## Database (PostgreSQL via pg Pool)
- `const db = await getDb()` — async, must `await` in every route/service.
- `await db.prepare(sql).get(p1, p2, ...)` → row or `undefined` (single row SELECT)
- `await db.prepare(sql).all(p1, p2, ...)` → array (multi-row SELECT)
- `await db.prepare(sql).run(p1, p2, ...)` → `{ lastInsertRowid, changes }` (INSERT/UPDATE/DELETE)
- `await db.exec(sql)` → void (schema statements with no params)
- Params are positional `?` in code (auto-converted to `$1, $2, ...` for PG), passed as separate args (not an array).
- Transactions: `await db.transaction(async (tx) => { ... })` — tx has same prepare()/exec() API.
- All `dishes` and `menus` queries must include `WHERE deleted_at IS NULL`.
- PG SQL syntax: `NOW()` not `datetime('now')`, `ON CONFLICT` not `INSERT OR REPLACE`, no `COLLATE NOCASE` (citext handles it).

## Services
- Reusable business logic goes in `services/`, not route handlers.
- Pure functions (no DB) are unit-testable. DB-dependent functions call `getDb()` internally.

## Key gotchas
- **Session save before response**: Login route calls `req.session.save(cb)` before `res.json()`. Do not remove.
- **No disk writes needed**: PostgreSQL handles persistence. The `cancelPendingSave()` method is a no-op.
- **UNIQUE(dish_id, ingredient_id)** on `dish_ingredients` — adding same ingredient twice throws.
- **Ingredient rows contain section headers**: `GET /api/dishes/:id` returns merged array with `row_type: 'ingredient'` and `row_type: 'section'`. Filter to `row_type === 'ingredient'` before cost calculations.
- **Photo paths**: Store relative URL `/uploads/dish-TIMESTAMP.ext`, not filesystem paths.
