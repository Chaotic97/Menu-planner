# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# PlateStack — Project Reference

Chef-focused menu planning app: dishes with costed ingredients → menus → EU 14 allergen tracking → shopping lists → purchase orders → daily service notes. Single-user, password-gated.

## Tech Stack

| Layer | Technology | Key constraint |
|-------|-----------|----------------|
| Backend | Node.js + Express 4 | **CommonJS only** (`require`/`module.exports`) |
| Frontend | Vanilla JS | **ES modules only** (`import`/`export`), no bundler |
| Database | SQLite via sql.js | In-memory, 500ms debounced disk writes |
| Real-time | WebSocket (ws) | Broadcasts on every CRUD mutation |
| Auth | bcrypt + @simplewebauthn (server/browser) v13 | Password + passkey (WebAuthn) login |
| AI | Claude Haiku via @anthropic-ai/sdk | Function calling, context-aware command bar |
| CSS | Single stylesheet | `public/css/style.css`, CSS custom properties |
| PWA | service-worker.js | Cache-first static, network-only `/api/` |

## Commands

```
npm start              # Run server at http://localhost:3000
npm test               # Jest: unit + integration tests
npm run lint           # ESLint flat config (separate backend/frontend/test rules)
npm run init-db        # Initialize database
npm run seed-sample    # Insert 5 sample dishes
npm run test:e2e       # Playwright: browser smoke tests (Chromium)
```

## Project Structure

```
server.js                    — Express entry point, WebSocket, route mounting
db/database.js               — sql.js wrapper, schema, migrations, auto-purge
db/schema.sql                — Core tables
middleware/                   — auth.js, asyncHandler.js, rateLimit.js
services/                    — Business logic (allergens, costs, importers, exporters)
services/ai/                 — aiService.js, aiTools.js, aiContext.js, aiHistory.js
routes/                      — auth, dishes, ingredients, menus, todos, today, serviceNotes, notifications, settings, ai, calendar
public/index.html            — SPA shell with sidebar + mobile bottom tab bar
public/js/app.js             — Hash router, auth, theme, sidebar state
public/js/api.js             — SOLE HTTP layer (never call fetch() elsewhere)
public/js/sync.js            — WebSocket client, dispatches sync:TYPE events
public/js/pages/             — One file per page, each exports renderXxx(container)
public/js/components/        — Reusable UI: modal, toast, actionMenu, collapsible, commandBar, chatDrawer
public/js/utils/             — escapeHtml, notifications, printSheet
public/css/style.css         — All styles (~8000 lines)
tests/                       — Unit tests (pure functions)
tests/integration/           — Supertest + in-memory SQLite
tests/e2e/                   — Playwright smoke tests (Chromium)
tests/helpers/               — setupTestApp.js, auth.js
```

## Critical Rules

### Security
- **`escapeHtml()` is mandatory** on every user-supplied string in frontend template literals. No exceptions.
- Validate all inputs server-side before DB operations.

### Database
- `getDb()` returns sync `DbWrapper` inside routes — never `await` it in a route handler.
- All `dishes` and `menus` queries must include `WHERE deleted_at IS NULL`.
- `UNIQUE(dish_id, ingredient_id)` on `dish_ingredients` — duplicates throw.
- Migrations: append to `MIGRATIONS` array in `db/database.js`.

### WebSocket
- Server: `req.broadcast('event_type', payload, req.headers['x-client-id'])` on every mutation.
- Client: `window.addEventListener('sync:event_type', handler)` — clean up on `hashchange`.
- Event types: `dish_created/updated/deleted`, `menu_created/updated/deleted`, `task_created/updated/deleted`, `tasks_generated`, `tasks_batch_updated`, `ingredient_created/updated`, `ingredients_stock_cleared`, `service_note_created/updated/deleted`, `special_created/updated/deleted`

### Architecture Patterns
- **Tasks vs Shopping**: Separate systems. Tasks (`tasks` table, `#/todos`) = prep + custom. Shopping (`#/shopping`) = computed on-the-fly from menu ingredients.
- **Task promotion**: Editing content fields of `source='auto'` tasks promotes to `source='manual'`. Toggling `completed` does not.
- **Directions vs chefs_notes**: Structured steps in `dish_directions` table. Legacy `chefs_notes` is fallback. Adding steps clears `chefs_notes` on save.
- **Ingredient rows**: `GET /api/dishes/:id` returns mixed `row_type: 'ingredient'` and `row_type: 'section'` — filter before cost calcs.
- **Batch yield**: `dishes.batch_yield` (REAL, default 1) = portions per batch. `cost_per_portion = total_cost / batch_yield`.
- **Soft deletes**: Records with `deleted_at` older than 7 days are hard-deleted on startup.

### Session & Auth
- Login route must call `req.session.save(cb)` before `res.json()` — do not remove.
- Public endpoints: add to `PUBLIC_PATHS` in `middleware/auth.js`.

### UI Patterns
- Primary CTA as visible button; secondary actions in `createActionMenu()` overflow.
- Responsive: ≥481px sidebar, ≤480px bottom tab bar. No other breakpoints.
- Sidebar states: `expanded` (240px), `collapsed` (64px), `hidden` (0px). Use `setSidebarState()`.
- Food cost colours: green ≤30%, yellow 30–35%, red >35%.

### Notifications
- Client-side scheduling via `setTimeout`. Preferences in `settings` table as JSON.
- Deduplication tracked in `localStorage` with daily keys.

## Database Tables

| Table | Purpose |
|-------|---------|
| `dishes` | id, name, category, photo_path, chefs_notes, suggested_price, is_favorite, batch_yield, manual_costs (JSON), deleted_at |
| `ingredients` | id, name, unit_cost, base_unit, category, in_stock |
| `dish_ingredients` | dish_id, ingredient_id, quantity, unit, prep_note, sort_order |
| `dish_section_headers` | Visual dividers in ingredient list |
| `dish_directions` | type (step/section), text, sort_order |
| `dish_allergens` | dish_id, allergen, source (auto/manual) |
| `dish_substitutions` | Allergen substitution mappings |
| `dish_tags` / `tags` | Tagging system |
| `allergen_keywords` | keyword→allergen detection mappings |
| `menus` | id, name, sell_price, expected_covers, guest_allergies, allergen_covers, deleted_at |
| `menu_dishes` | menu_id, dish_id, sort_order, servings |
| `weekly_specials` | dish_id, week_start/end, notes, is_active |
| `tasks` | type (prep/custom), source (auto/manual), priority, timing_bucket, menu_id, source_dish_id |
| `service_notes` | date, shift (all/am/lunch/pm/prep), title, content |
| `settings` | key/value store (password, AI config, email, etc.) |
| `ai_history` | Undo snapshots, 24h auto-purge |
| `ai_usage` | Token tracking per API call |
| `ai_conversations` / `ai_messages` | Chat drawer, 7-day auto-purge |
| `passkey_credentials` | WebAuthn credentials (id, public_key, counter, transports) |

## EU 14 Allergens
celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites

## Shift Values
`all` · `am` · `lunch` · `pm` · `prep`

## Deployment
- **Domain**: platestack.app (DigitalOcean, PM2, nginx + HTTPS)
- **Deploy**: `git push` → SSH → `cd /opt/menu-planner && git pull && npm install && pm2 restart menu-planner`
- **PM2**: Must start with `NODE_ENV=production` for WebAuthn RP_ID to resolve to `platestack.app`
- **Env vars**: SESSION_SECRET, GMAIL_USER, GMAIL_APP_PASSWORD, APP_URL, DB_PATH, UPLOADS_PATH, SESSIONS_PATH, NODE_ENV, RP_ID
- **WebAuthn config**: `IS_PROD` detected from `NODE_ENV=production` OR `APP_URL=https://platestack.app`. RP_ID defaults to `platestack.app` (prod) or `localhost` (dev)

## Linting
ESLint 9 flat config (`eslint.config.js`). Three blocks: backend (`commonjs`, Node globals), frontend (`module`, browser globals), tests (`commonjs`, Node + Jest globals). Key rules: `no-var` (error), `prefer-const` (warn), `eqeqeq` (warn), `no-throw-literal` (error), `no-unused-vars` with `argsIgnorePattern: '^_'`.

## CI
GitHub Actions on push/PR to main: Node 20/22 matrix → `npm ci` → `npm run lint` → `npm test`

@.claude/rules/backend.md
@.claude/rules/frontend.md
@.claude/rules/css.md
@.claude/rules/tests.md
@.claude/rules/print-system.md
@.claude/rules/ai-system.md
