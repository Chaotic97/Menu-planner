# PlateStack — Project Reference

## What is this?
PlateStack is a chef-focused menu planning web app. It handles the full workflow from creating dishes with costed ingredients, building menus from those dishes, tracking allergens, generating shopping lists and purchase orders, and managing daily service notes. It runs as a single-user app behind a password gate.

## Live deployment
- **Domain:** platestack.app
- **Server:** DigitalOcean Droplet (Ubuntu 24.04), IP 165.245.135.54
- **App location on Droplet:** /opt/menu-planner
- **Process manager:** PM2 (`pm2 restart menu-planner`)
- **Reverse proxy:** nginx with HTTPS via Let's Encrypt/Certbot
- **Deploy workflow:** `git push` → SSH in → `cd /opt/menu-planner && git pull origin main && npm install && pm2 restart menu-planner`

## Tech stack
- **Backend:** Node.js + Express 4
- **Database:** SQLite via sql.js (loaded into memory, persisted to `menu-planner.db` on disk via a debounced write). DB path is `process.env.DB_PATH` or falls back to project root.
- **Auth:** Single-user password gate. bcrypt (SALT_ROUNDS=12) for hashing, express-session with session-file-store for persistence. Recovery email via Gmail SMTP (nodemailer).
- **Real-time sync:** WebSocket (ws) — multiple browser tabs stay in sync. Broadcast on dish/menu CRUD.
- **Frontend:** Vanilla JS (ES modules), hash-based SPA router, no framework. All UI built with template literals and DOM manipulation.
- **PWA:** manifest.json + service-worker.js. Cache-first for static, network-first for /api/. Offline banner shown when connectivity is lost.
- **CSS:** Single stylesheet (`public/css/style.css`), CSS custom properties, responsive (sidebar on desktop ≥481px, bottom tab bar on mobile ≤480px).

## Project structure

```
server.js                        — Express server, session, WebSocket, route mounting
db/
  database.js                    — sql.js wrapper (DbWrapper/StmtWrapper), schema migrations, auto-purge
  schema.sql                     — Core table definitions
  seed.sql                       — EU 14 allergen keyword mappings
  seed-sample.js                 — Optional: inserts 5 sample dishes (run once with `npm run seed-sample`)
middleware/
  auth.js                        — Session-based auth middleware (skips /api/auth/* and static files)
services/
  emailService.js                — Gmail SMTP for password reset emails
routes/
  auth.js                        — Login, logout, setup, forgot/reset password, change password
  dishes.js                      — Full CRUD + photo upload, duplicate, favorites, tags, import from URL, allergen detection
  ingredients.js                 — Ingredient CRUD with unit_cost for costing
  menus.js                       — Menu CRUD, add/remove/reorder dishes, weekly specials, kitchen print, scaling
  todos.js                       — Shopping list and prep task generation from menu data
  serviceNotes.js                — Daily kitchen notes CRUD with date/shift filtering
public/
  index.html                     — SPA shell (nav, bottom tab bar, offline banner, SW registration)
  manifest.json                  — PWA manifest
  service-worker.js              — Cache strategies
  favicon.svg
  css/style.css                  — All styles (~2600 lines): layout, cards, forms, modals, calendar, pairings, converter, PO table, print, dark mode, responsive
  js/
    app.js                       — SPA router, auth check, theme toggle, route definitions
    api.js                       — Fetch wrapper with 401 handling and sync client ID headers
    sync.js                      — WebSocket client for real-time multi-tab sync
    pages/
      dishList.js                — Dish grid with search, category/tag/favorite filters, import from URL
      dishForm.js                — Create/edit dish: ingredients (with inline ⇄ unit converter), allergen detection, substitutions, tags, photo upload, costing
      menuList.js                — Menu grid with allergen cover count badges
      menuBuilder.js             — Menu editor: add/remove/reorder dishes, allergen conflict warnings, guest allergy covers, pricing, scaling, kitchen print
      todoView.js                — Shopping list, prep tasks, and purchase order tabs (all printable)
      serviceNotes.js            — Calendar-based daily kitchen notes (shift types: All Day/AM/Lunch/PM/Prep)
      flavorPairings.js          — Built-in ingredient pairing reference (~60 ingredients) with search and category filter
      specials.js                — Weekly specials management
      login.js                   — Login, first-time setup, forgot/reset password
    components/
      modal.js                   — Generic modal overlay
      toast.js                   — Toast notifications with optional undo action
      allergenBadges.js          — Colored allergen badge renderer
      lightbox.js                — Image lightbox for dish photos
      unitConverter.js           — Standalone unit converter modal (weight/volume/temperature)
    data/
      categories.js              — Dish category list
      units.js                   — Unit options for ingredient inputs
      allergenKeywords.js        — Client-side allergen detection from ingredient names
      flavorPairings.js          — Curated flavor pairing data (~60 ingredients)
```

## Database tables

**Core schema** (schema.sql):
- `dishes` — id, name, description, category, photo_path, chefs_notes, suggested_price, created_at, updated_at
- `ingredients` — id, name, unit_cost, base_unit, category
- `dish_ingredients` — dish_id, ingredient_id, quantity, unit, prep_note (UNIQUE dish+ingredient)
- `allergen_keywords` — keyword → allergen mapping for auto-detection
- `dish_allergens` — dish_id, allergen, source (auto/manual)
- `menus` — id, name, description, is_active, sell_price, created_at, updated_at
- `menu_dishes` — menu_id, dish_id, sort_order, servings
- `weekly_specials` — dish_id, week_start, week_end, notes, is_active

**Added via migrations** (database.js):
- `menus.sell_price` — menu selling price for food cost % calculation
- `menus.expected_covers` — guest count
- `menus.guest_allergies` — comma-separated allergen names
- `menus.allergen_covers` — JSON string, per-allergen cover counts (e.g. `{"gluten":3,"milk":2}`)
- `menus.deleted_at` — soft delete
- `dishes.is_favorite` — boolean
- `dishes.deleted_at` — soft delete
- `tags` / `dish_tags` — tagging system
- `dish_substitutions` — allergen substitution suggestions per dish
- `settings` — key-value store (password_hash, email, reset tokens)
- `service_notes` — date, shift, title, content for daily kitchen log

## Key patterns

- **Allergen detection:** When ingredients are added to a dish, their names are matched against `allergen_keywords` (both server-side and client-side preview). Detected allergens stored in `dish_allergens` with source='auto'. Chef can also manually toggle allergens.
- **Soft delete:** Dishes and menus get `deleted_at` set instead of being removed. Auto-purged after 7 days on server startup. Undo via restore endpoint.
- **Inline unit converter:** Each ingredient row in the dish form has a ⇄ button. Weight (g/kg/oz/lb) and volume (ml/L/tsp/tbsp/cup) are interconvertible. Non-convertible units (each, bunch, sprig, pinch) disable the button.
- **Food costing:** Ingredients have optional `unit_cost` + `base_unit`. Menu builder calculates per-dish and total menu food cost, shows food cost % against sell price (green ≤30%, yellow 30-35%, red >35%).
- **Session fix (important):** Login route uses `req.session.save(callback)` before responding. Without this, the session file may not be written before the browser receives the cookie, causing login to appear broken. Nginx must also send `proxy_set_header X-Forwarded-Proto $scheme` for the Secure cookie to work over HTTPS.

## Environment variables (on Droplet)
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

## npm scripts
- `npm start` — Run the server
- `npm run seed-sample` — Insert 5 sample dishes (safe to re-run; skips if dishes exist)

## EU 14 Allergens tracked
celery, gluten, crustaceans, eggs, fish, lupin, milk, molluscs, mustard, nuts, peanuts, sesame, soy, sulphites
