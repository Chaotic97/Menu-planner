# PlateStack — Project Reference

## What is this?
PlateStack is a chef-focused menu planning web app. Full workflow: create dishes with costed ingredients → build menus → track EU 14 allergens → generate shopping lists and purchase orders → manage daily service notes. Single-user, behind a password gate.

---

## Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Backend | Node.js + Express 4 | **CommonJS only** — `require()` / `module.exports`. Never use `import`/`export` in backend files. |
| Frontend | Vanilla JS ES modules | **ES modules only** — `import`/`export`. Never use `require()` in frontend files. No build step, no bundler. |
| Database | SQLite via sql.js | Loaded into memory on startup. Written to disk via 500 ms debounced save. |
| Auth | express-session + session-file-store | Single-user bcrypt password gate. Sessions persist across restarts. |
| Real-time | WebSocket (ws) | Server broadcasts on every CRUD mutation. Frontend listens via `sync:TYPE` custom events. |
| CSS | Single stylesheet | `public/css/style.css` — CSS custom properties, no preprocessor. |
| PWA | service-worker.js | Cache-first for static, network-first for /api/. |

---

## Project structure

```
server.js                        — Express entry point: middleware, WebSocket, route mounting, global error handler
db/
  database.js                    — sql.js wrapper (DbWrapper/StmtWrapper), schema init, migrations, auto-purge
  schema.sql                     — Core table definitions (run once on first start)
  seed.sql                       — EU 14 allergen keyword mappings
  seed-sample.js                 — Optional: inserts 5 sample dishes (npm run seed-sample)
middleware/
  auth.js                        — Blocks unauthenticated /api/* requests. PUBLIC_PATHS list is the bypass list.
  asyncHandler.js                — Wraps async route handlers so thrown errors reach the global error handler
services/
  allergenDetector.js            — updateDishAllergens(dishId), getAllergenKeywords()
  costCalculator.js              — calculateDishCost(), calculateFoodCostPercent(), suggestPrice(), convertUnits(), normalizeUnit(), round2()
  emailService.js                — sendPasswordResetEmail(toAddress, resetUrl)
  prepTaskGenerator.js           — generatePrepTasks(menuId), extractPrepTasks(notes, dishName), extractTiming(text)
  recipeImporter.js              — importRecipe(url) — scrapes a URL and returns a dish-shaped object
  shoppingListGenerator.js       — generateShoppingList(menuId) — aggregates + unit-normalises menu ingredients
routes/
  auth.js                        — Login, logout, setup, forgot/reset password, change password
  dishes.js                      — Full CRUD + photo upload, duplicate, favorites, tags, allergens, import from URL
  ingredients.js                 — Ingredient CRUD with unit_cost
  menus.js                       — Menu CRUD + dish ordering, weekly specials, kitchen print, scaling
  todos.js                       — Shopping list and prep task endpoints
  serviceNotes.js                — Daily kitchen notes CRUD
public/
  index.html                     — SPA shell: nav, bottom tab bar, offline banner, SW registration
  manifest.json + service-worker.js — PWA assets
  css/style.css                  — All styles (~3100 lines). See CSS conventions.
  js/
    app.js                       — Hash router, auth check, theme, route table
    api.js                       — SOLE HTTP layer. Never call fetch() elsewhere.
    sync.js                      — WebSocket client. Dispatches sync:TYPE events on window.
    utils/escapeHtml.js          — escapeHtml(). Must wrap all user content in templates.
    pages/                       — One file per page. Each exports renderXxx(container).
      dishList.js · dishForm.js · dishView.js · menuList.js · menuBuilder.js
      todoView.js · serviceNotes.js · flavorPairings.js · specials.js · login.js
    components/
      modal.js                   — openModal(htmlContent) / closeModal()
      toast.js                   — showToast(message, options)
      allergenBadges.js          — renderAllergenBadges(allergens)
      lightbox.js                — openLightbox(src, alt)
      unitConverter.js           — openUnitConverter()
    data/
      categories.js · units.js · allergenKeywords.js · flavorPairings.js
tests/
  costCalculator.test.js · prepTaskGenerator.test.js
```

---

## Conventions

### Backend: routes

1. Use `asyncHandler` for any route that uses `await` or could throw. Sync-only handlers don't need it.
   ```js
   const asyncHandler = require('../middleware/asyncHandler');
   router.post('/my-thing', asyncHandler(async (req, res) => { ... }));
   ```
2. Success: `res.json(data)` (200) or `res.status(201).json(data)` for creates.
3. Errors: always `res.status(N).json({ error: 'Human-readable message' })`. The `error` key is what `api.js` reads and throws. No other shape.
4. Mount new routers in `server.js` under `/api/your-path`.
5. Broadcast on any mutation: `req.broadcast('event_type', payload, req.headers['x-client-id'])`.
6. To make an endpoint public (no auth required), add its exact path to `PUBLIC_PATHS` in `middleware/auth.js`.

---

### Backend: database

Call `getDb()` synchronously inside route handlers — it is guaranteed to be initialised by the time any route runs:
```js
const { getDb } = require('../db/database');
const db = getDb(); // always synchronous here — never await it in a route handler
```

**DbWrapper API:**

| Call | Returns | Use for |
|------|---------|---------|
| `db.prepare(sql).get(p1, p2, ...)` | row object or `undefined` | SELECT expecting 0 or 1 rows |
| `db.prepare(sql).all(p1, p2, ...)` | array (may be empty) | SELECT expecting multiple rows |
| `db.prepare(sql).run(p1, p2, ...)` | `{ lastInsertRowid, changes }` | INSERT / UPDATE / DELETE |
| `db.exec(sql)` | void | Schema statements with no params |

Params are positional `?`. Pass as separate args, never as an array:
```js
db.prepare('SELECT * FROM dishes WHERE id = ? AND deleted_at IS NULL').get(id);
db.prepare('UPDATE dishes SET name = ? WHERE id = ?').run(name, id);
```

**Adding a migration:** append to the `MIGRATIONS` array in `db/database.js`. Each runs in a `try/catch` so it silently skips if the column/table already exists. Fine for `ALTER TABLE ADD COLUMN`. Be careful with destructive changes.

---

### Backend: services

Put reusable or testable business logic in `services/`, not directly in route handlers. Pure functions (no DB dependency) belong here and are unit-testable. Functions that need DB get it via `getDb()` internally.

---

### Frontend: page modules

Every page exports a single async function:
```js
export async function renderMyPage(container) {
  container.innerHTML = `...`; // set initial HTML first, then attach listeners
}
```

Rules:
- **`escapeHtml()` is mandatory** on every piece of user-supplied content in template literals. Dish names, ingredient names, notes, everything. Skipping it is an XSS hole. Import from `../utils/escapeHtml.js`.
- `container.innerHTML = ...` wipes previous event listeners — no manual cleanup needed.
- **Never call `fetch()` directly.** Use functions from `../api.js`.
- Feedback: `showToast(message)` from `../components/toast.js`.
- Dialogs/pickers: `openModal(html)` / `closeModal()` from `../components/modal.js`.
- Real-time updates: `window.addEventListener('sync:event_type', e => { ... })` — payload is in `e.detail`.

---

### Frontend: adding a new page end-to-end

1. Create `public/js/pages/myPage.js` exporting `renderMyPage(container)`.
2. In `public/js/app.js`: import it and add a route entry:
   ```js
   import { renderMyPage } from './pages/myPage.js';
   { pattern: /^#\/my-page$/, handler: () => renderMyPage(appContent) },
   ```
3. Add nav links in `public/index.html` (top nav + bottom tab bar for mobile).
4. Add backend route + `api.js` client function if server data is needed.
5. Add CSS under a new named section with a feature prefix (e.g. `.mp-` for "my page").

---

### Frontend: API client

`public/js/api.js` is the only place `fetch()` is called. It handles: `/api` prefix, JSON headers, FormData detection, `X-Client-Id` header for sync, 401 → redirect to login, error response parsing.

Adding a new function:
```js
export const getMyThing = (id) => request(`/my-thing/${id}`);
export const createMyThing = (data) => request('/my-thing', { method: 'POST', body: data });
// body: plain object → auto JSON.stringified. FormData → sent as-is.
```

---

### WebSocket / real-time sync

**Server side** (inside any route handler):
```js
req.broadcast('dish_updated', { id: dish.id }, req.headers['x-client-id']);
// Sends to all connected tabs except the one that made the request
```

**Client side:**
```js
window.addEventListener('sync:dish_updated', (e) => {
  const { id } = e.detail;
  // re-fetch and re-render
});
```

Existing event types: `dish_created` · `dish_updated` · `dish_deleted` · `menu_created` · `menu_updated` · `menu_deleted`

Broadcast on creates, updates, deletes. Never on reads.

---

## Testing

Unit tests use **Jest**. Run with `npm test`.

```
tests/
  costCalculator.test.js    — all 6 exports: normalizeUnit, convertUnits, round2,
                              calculateDishCost, calculateFoodCostPercent, suggestPrice
  prepTaskGenerator.test.js — extractTiming (all 5 buckets), extractPrepTasks (splitting,
                              filtering, timing assignment, all sentences included)
```

Rules for new tests:
- Test pure functions only. Functions that call `getDb()` are candidates for integration tests (not yet written).
- `extractTiming` and `extractPrepTasks` are exported from `prepTaskGenerator.js` specifically for testing — keep them exported.
- Do not test IEEE 754 half-way rounding in `round2` (e.g. `1.005`) — use `toBeCloseTo` or avoid that exact value.

---

## API endpoint reference

### Dishes
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/dishes` | Query: `category`, `search`, `favorite=1`, `tag` |
| GET | `/api/dishes/:id` | Full detail: ingredients (with row_type), allergens, cost, substitutions, tags |
| POST | `/api/dishes` | Body: name\*, description, category, chefs_notes, suggested_price, ingredients[], tags[], substitutions[], manual_costs[] → 201 `{ id }` |
| PUT | `/api/dishes/:id` | Same body as POST |
| DELETE | `/api/dishes/:id` | Soft delete (sets deleted_at) |
| POST | `/api/dishes/:id/restore` | Clears deleted_at |
| POST | `/api/dishes/:id/duplicate` | Full copy including ingredients, headers, subs, tags → 201 `{ id }` |
| POST | `/api/dishes/:id/favorite` | Toggles is_favorite |
| POST | `/api/dishes/:id/photo` | multipart/form-data, field name: `photo` |
| POST | `/api/dishes/:id/allergens` | Body: `{ allergen, action: 'add'|'remove', source: 'manual' }` |
| GET | `/api/dishes/tags/all` | All tags |
| GET | `/api/dishes/allergen-keywords/all` | All keyword→allergen mappings |

### Ingredients
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/ingredients` | Query: `search` |
| POST | `/api/ingredients` | Body: name, unit_cost, base_unit, category |
| PUT | `/api/ingredients/:id` | Same body |

### Menus
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/menus` | Includes dish_count, total_food_cost, menu_food_cost_percent per menu |
| GET | `/api/menus/:id` | Full detail: dishes with cost breakdown |
| POST | `/api/menus` | Body: name, description → 201 `{ id }` |
| PUT | `/api/menus/:id` | Body: name, description, is_active, sell_price, expected_covers, guest_allergies (CSV), allergen_covers (JSON) |
| DELETE | `/api/menus/:id` | Soft delete |
| POST | `/api/menus/:id/restore` | |
| POST | `/api/menus/:id/dishes` | Body: dish_id, servings |
| PUT | `/api/menus/:id/dishes/:dishId` | Body: servings |
| DELETE | `/api/menus/:id/dishes/:dishId` | Remove dish from menu |
| PUT | `/api/menus/:id/dishes/reorder` | Body: `{ order: [dishId, ...] }` |
| GET | `/api/menus/:id/kitchen-print` | Scaled print data |

### Todos
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/todos/menu/:id/shopping-list` | Aggregated, unit-normalised ingredient list |
| GET | `/api/todos/menu/:id/scaled-shopping-list` | Query: `covers=N` |
| GET | `/api/todos/menu/:id/prep-tasks` | Tasks grouped by timing bucket |

### Service Notes
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/service-notes` | Query: `date` (YYYY-MM-DD), `shift` |
| GET | `/api/service-notes/dates` | Array of dates that have at least one note |
| POST | `/api/service-notes` | Body: date, shift, title, content |
| PUT | `/api/service-notes/:id` | Same body |
| DELETE | `/api/service-notes/:id` | Hard delete |

### Weekly Specials
| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/menus/specials/list` | Query: `week_start` |
| POST | `/api/menus/specials` | Body: dish_id, week_start, week_end, notes |
| PUT | `/api/menus/specials/:id` | Same body |
| DELETE | `/api/menus/specials/:id` | Hard delete |

### Auth (all public — no session required)
| Method | Path |
|--------|------|
| GET | `/api/auth/status` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| POST | `/api/auth/setup` |
| POST | `/api/auth/forgot` |
| POST | `/api/auth/reset` |
| POST | `/api/auth/change-password` |

---

## Database tables

| Table | Key columns |
|-------|-------------|
| `dishes` | id, name, description, category, photo_path, chefs_notes, suggested_price, is_favorite, deleted_at, manual_costs (JSON `[]`), created_at, updated_at |
| `ingredients` | id, name, unit_cost, base_unit, category |
| `dish_ingredients` | dish_id, ingredient_id, quantity, unit, prep_note, sort_order — **UNIQUE(dish_id, ingredient_id)** |
| `dish_section_headers` | id, dish_id, label, sort_order — visual dividers in the ingredient list |
| `allergen_keywords` | keyword, allergen — EU 14 allergen detection source (see below) |
| `dish_allergens` | dish_id, allergen, source (`'auto'` or `'manual'`) |
| `menus` | id, name, description, is_active, sell_price, expected_covers, guest_allergies (CSV), allergen_covers (JSON `{}`), deleted_at, created_at, updated_at |
| `menu_dishes` | menu_id, dish_id, sort_order, servings |
| `weekly_specials` | dish_id, week_start, week_end, notes, is_active |
| `tags` | id, name UNIQUE COLLATE NOCASE |
| `dish_tags` | dish_id, tag_id |
| `dish_substitutions` | dish_id, allergen, original_ingredient, substitute_ingredient, substitute_quantity, substitute_unit, notes |
| `settings` | key, value — stores: password_hash, email, reset_token, reset_expires |
| `service_notes` | id, date (YYYY-MM-DD), shift, title, content, created_at, updated_at |

**Shift values:** `all` · `am` · `lunch` · `pm` · `prep`

**EU 14 allergens tracked:** celery · gluten · crustaceans · eggs · fish · lupin · milk · molluscs · mustard · nuts · peanuts · sesame · soy · sulphites

---

## Key patterns and gotchas

### Session save before response (do not remove)
The login route calls `req.session.save(cb)` before `res.json()`. Without this, the session file may not be on disk before the browser receives the cookie — login appears broken. Do not remove this pattern.

### `getDb()` sync vs async
`getDb()` returns a Promise on the very first call (server startup). After `initialize()` resolves, it returns the `DbWrapper` synchronously. `server.js` awaits it once. Inside every route handler, call it synchronously — never `await getDb()` in a route.

### Debounced disk write
Every `.run()` / `.exec()` schedules a disk write 500 ms later. There is no explicit commit. The in-memory DB is authoritative; the file is a snapshot. PM2 and `process.on('exit')` call `save()` synchronously on shutdown, so normal restarts are safe.

### UNIQUE constraint on dish_ingredients
`UNIQUE(dish_id, ingredient_id)` — adding the same ingredient twice throws. The dish form prevents this in the UI. API callers must handle the error.

### escapeHtml is non-negotiable
Wrap every user-supplied string in `escapeHtml()` before inserting into template literals. Dish names, notes, ingredient names, tag names — everything. Omitting it is an XSS vulnerability.

### Ingredient rows contain section headers
`GET /api/dishes/:id` returns `dish.ingredients` as a merged, sort_order-sorted array of `row_type: 'ingredient'` and `row_type: 'section'` objects. Always filter to `row_type === 'ingredient'` before passing to `calculateDishCost()`.

### Soft delete queries
All `dishes` and `menus` queries must include `WHERE deleted_at IS NULL`. Records older than 7 days are hard-deleted on server startup.

### Photo paths
The stored `photo_path` is the relative URL `/uploads/dish-TIMESTAMP.ext` — not a filesystem path. Served by Express static middleware. Do not store absolute paths.

### Food cost colour thresholds (Menu Builder UI)
green ≤30% · yellow 30–35% · red >35%

### Responsive breakpoints
≥481px: sidebar nav, no bottom tab bar. ≤480px: bottom tab bar, no sidebar. Use these exact values; do not invent new breakpoints.

---

## CSS conventions

### Section headers
```css
/* ============================
   Section Name
   ============================ */
```
Sub-sections (responsive overrides, etc.):
```css
/* --- Section Name: sub-topic --- */
```

### Class naming prefixes
| Prefix | Feature |
|--------|---------|
| `.dv-` | Dish View |
| `.fp-` | Flavor Pairings |
| `.sn-` | Service Notes |
| `.po-` | Purchase Order |
| `.uc-` | Unit Converter |
| `.ing-` | Ingredient rows (dish form) |
| `.mb-` | Menu Builder |

Global components (`.btn`, `.card`, `.modal`, `.toast`, `.input`, `.drag-handle`) are unprefixed. New features with more than ~3 classes get a prefix; add it to this table.

### CSS variables
All design tokens in `:root` at top of `style.css`. Groups: Brand colours (`--primary-*`) · Semantic (`--danger`, `--warning`, `--success`) · Surface & text (`--bg`, `--surface`, `--text`, `--border`) · Elevation (`--shadow`, `--shadow-lg`) · Geometry (`--radius`, `--radius-sm`) · Layout (`--nav-height`, `--sidebar-width`) · Typography (`--font`).

Dark mode: `[data-theme="dark"]` block immediately below `:root`. Component-specific dark overrides go at the end of that block under `/* --- Component-specific dark overrides --- */`. Do not scatter dark mode rules through the file.

---

## Operations

### Local development
```
npm start        → http://localhost:3000
```

### Live deployment
- **Domain:** platestack.app
- **Server:** DigitalOcean Droplet (Ubuntu 24.04) · IP 165.245.135.54 · `/opt/menu-planner`
- **Process manager:** PM2 (`pm2 restart menu-planner`)
- **Reverse proxy:** nginx + HTTPS via Let's Encrypt. Must include `proxy_set_header X-Forwarded-Proto $scheme` for secure cookies.
- **Deploy:** `git push` → SSH → `cd /opt/menu-planner && git pull origin main && npm install && pm2 restart menu-planner`

### Environment variables
```
SESSION_SECRET=<random string>
GMAIL_USER=<gmail address>
GMAIL_APP_PASSWORD=<gmail app password>
APP_URL=https://platestack.app
DB_PATH=/opt/menu-planner/menu-planner.db
UPLOADS_PATH=/opt/menu-planner/uploads
SESSIONS_PATH=/opt/menu-planner/sessions
NODE_ENV=production
```

### npm scripts
```
npm start              Run the server
npm test               Run Jest unit tests (tests/ directory)
npm run seed-sample    Insert 5 sample dishes (safe to re-run)
```
