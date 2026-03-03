# Codebase Improvements Plan

All changes verified against actual code. Organized into 6 phases, roughly ordered by impact.

---

## Phase 1: Backend Data Integrity (routes)

### 1A. Soft-delete filter on menu list cost calculation
**File:** `routes/menus.js:28-36`
**Problem:** `GET /api/menus` fetches `menu_dishes` without filtering deleted dishes. Deleted dishes still inflate `total_food_cost` and `menu_food_cost_percent`. The COUNT query at line 28-31 also counts deleted dishes.
**Fix:** Join `dishes` and add `AND d.deleted_at IS NULL` to both the COUNT query and the cost-calculation query:
```sql
SELECT COUNT(*) AS dish_count
FROM menu_dishes md
JOIN dishes d ON d.id = md.dish_id
WHERE md.menu_id = ? AND d.deleted_at IS NULL
```
```sql
SELECT md.dish_id, md.servings
FROM menu_dishes md
JOIN dishes d ON d.id = md.dish_id
WHERE md.menu_id = ? AND d.deleted_at IS NULL
```

### 1B. Missing existence checks — service notes
**File:** `routes/serviceNotes.js:77, 85`
**Problem:** PUT returns `{ success: true }` even when the ID doesn't exist (line 77 doesn't capture `.run()` result). DELETE at line 85 same issue.
**Fix:** Capture the `result` from `.run()` and check `result.changes === 0` → return 404. Pattern already used in `todos.js:275` and `ingredients.js:91`.

### 1C. Missing existence checks — ingredients update
**File:** `routes/ingredients.js:79`
**Problem:** `PUT /api/ingredients/:id` runs an UPDATE without checking if the ingredient exists.
**Fix:** Capture `result` from `.run()`, check `result.changes === 0` → 404.

### 1D. Missing existence checks — menu dish operations
**File:** `routes/menus.js:375, 384`
**Problem:** `PUT /:id/dishes/:dishId` and `DELETE /:id/dishes/:dishId` don't check if the row exists. DELETE at line 384 always returns success.
**Fix:** Capture `.run()` result, check `.changes === 0` → 404.

### 1E. Missing existence checks — menu dish reorder
**File:** `routes/menus.js:297-312`
**Problem:** Reorder endpoint doesn't verify the menu exists before looping through updates. Silently succeeds on non-existent menus.
**Fix:** Add a menu existence check at the top (same pattern as line 57-58):
```js
const menu = db.prepare('SELECT id FROM menus WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
if (!menu) return res.status(404).json({ error: 'Menu not found' });
```

### 1F. Batch-complete returns misleading count
**File:** `routes/todos.js:292-299`
**Problem:** `POST /batch-complete` returns `{ updated: task_ids.length }` (input array length) not the actual rows changed. If some IDs don't exist, the response lies.
**Fix:** Capture `result.changes` from the UPDATE statement and return that instead:
```js
const result = db.prepare(`UPDATE tasks SET ...`).run(completedVal, ...task_ids);
res.json({ success: true, updated: result.changes });
```

### 1G. Transactions on multi-step dish create/update
**File:** `routes/dishes.js:172-213` (create), `routes/dishes.js:426-491` (update)
**Problem:** Dish create runs ~7 separate DB operations (INSERT dish → saveIngredients → saveTags → saveSubs → saveComponents → saveDirections → saveServiceDirections → updateAllergens). If any step fails midway, the dish exists with partial data. Dish update deletes all ingredients then re-inserts — a failure mid-way leaves the dish with no ingredients.
**Fix:** Wrap both handlers in `db.exec('BEGIN')` / `db.exec('COMMIT')` with a try/catch that calls `db.exec('ROLLBACK')`. sql.js supports this. Pattern:
```js
try {
  db.exec('BEGIN');
  // ... all operations ...
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
```

**Tests:** Run existing `tests/integration/dishes.test.js` — all create/update tests should still pass. Add a test that verifies partial failure rolls back (e.g., create dish with an invalid ingredient that triggers a constraint violation).

---

## Phase 2: Backend Consistency (routes + services)

### 2A. Use round2() consistently in menus.js
**File:** `routes/menus.js:44, 47, 101, 105, 110, 114, 119`
**Problem:** 7 instances of inline `Math.round(x * 100) / 100` despite `round2` being imported at line 7. The percentage calculations at lines 47, 114, 119 use a different formula (`Math.round(x * 10000) / 100`) which is equivalent to `round2(x * 100)` but inconsistent.
**Fix:** Replace each instance:
- `Math.round(totalFoodCost * 100) / 100` → `round2(totalFoodCost)`
- `Math.round((totalFoodCost / menu.sell_price) * 10000) / 100` → `round2((totalFoodCost / menu.sell_price) * 100)`
- Same for lines 101, 105, 119

**Tests:** Run `tests/integration/menus.test.js` — cost rollup tests should pass unchanged since the math is equivalent.

### 2B. Shopping list incompatible unit warning
**File:** `services/shoppingListGenerator.js:56-62`
**Problem:** When the same ingredient appears with incompatible units (e.g., "2 bunches basil" + "500g basil"), the raw quantities are silently added together producing nonsense (502 bunches).
**Fix:** When `converted === null`, instead of adding the raw quantity to the total, track it separately. Add a `mixed_units` array to the ingredient entry listing the incompatible contributions. The main `total_quantity` should only accumulate compatible quantities. The frontend can then display a warning badge for mixed-unit items.
```js
if (converted !== null) {
  entry.total_quantity += converted;
} else {
  if (!entry.mixed_units) entry.mixed_units = [];
  entry.mixed_units.push({ quantity: adjustedQty, unit: row.unit, dish: row.dish_name });
}
```

**Tests:** Add unit test in new `tests/shoppingListGenerator.test.js` (see Phase 6).

### 2C. DNS resolution timeout in recipe importer
**File:** `services/recipeImporter.js:37`
**Problem:** `dnsResolve(hostname)` has no timeout. The 10s `FETCH_TIMEOUT_MS` only covers the HTTP fetch, not the DNS lookup phase. Slow/malicious DNS can hang the import endpoint.
**Fix:** Wrap dnsResolve in a Promise.race with a 5-second timeout:
```js
const DNS_TIMEOUT_MS = 5000;
const addresses = await Promise.race([
  dnsResolve(hostname),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT_MS)
  )
]);
```

---

## Phase 3: Frontend Robustness

### 3A. Sync listener cleanup — use robust pattern
**Files:**
- `public/js/pages/dishView.js:237-240`
- `public/js/pages/dishForm.js:920-923`
- `public/js/pages/menuBuilder.js:880-883`

**Problem:** These three pages use the fragile `{ once: true }` pattern for hashchange cleanup. The `once` flag means the cleanup handler self-removes after the first hashchange, but on that first hashchange it correctly removes the sync listener. The real fragility is: if the sync handler itself throws, the cleanup still works, but the pattern is inconsistent with the rest of the codebase and harder to extend to multiple sync events.
**Fix:** Replace with the robust pattern already used in `todoView.js`, `shoppingList.js`, `serviceNotes.js`, and `specials.js`:
```js
const cleanup = () => {
  window.removeEventListener('sync:dish_updated', onUpdate);
  window.removeEventListener('hashchange', cleanup);
};
window.addEventListener('hashchange', cleanup);
```
This pattern is self-cleaning (removes both listeners) and matches the documented convention in CLAUDE.md.

### 3B. API fetch timeout
**File:** `public/js/api.js:26`
**Problem:** `fetch(url, config)` has no timeout. On flaky kitchen WiFi, requests hang indefinitely with no user feedback.
**Fix:** Add `AbortSignal.timeout(15000)` to the fetch config:
```js
const res = await fetch(url, { ...config, signal: AbortSignal.timeout(15000) });
```
This gives a 15-second timeout and throws an `AbortError` which the existing error handling will surface as a toast. `AbortSignal.timeout()` is supported in all modern browsers.

---

## Phase 4: Database Performance

### 4A. Add missing indexes
**File:** `db/database.js` (add to MIGRATIONS array)
**Problem:** Two commonly-joined foreign keys lack indexes:
- `menu_dishes(dish_id)` — joined in shopping list, menu detail, kitchen print
- `dish_ingredients(ingredient_id)` — joined in "which dishes use this ingredient?" lookups

**Fix:** Add a new migration entry:
```js
{
  name: 'add_reverse_fk_indexes',
  sql: `
    CREATE INDEX IF NOT EXISTS idx_menu_dishes_dish_id ON menu_dishes(dish_id);
    CREATE INDEX IF NOT EXISTS idx_dish_ingredients_ingredient_id ON dish_ingredients(ingredient_id);
  `
}
```

### 4B. Reduce N+1 queries on dish list
**File:** `routes/dishes.js:86-93`
**Problem:** For each dish in the list, two separate queries fetch allergens and tags individually (2N extra queries for N dishes).
**Fix:** After fetching the dish list, run two batch queries:
```sql
-- Batch allergens
SELECT dish_id, GROUP_CONCAT(allergen) AS allergen_list
FROM dish_allergens
WHERE dish_id IN (?, ?, ...)
GROUP BY dish_id

-- Batch tags
SELECT dt.dish_id, GROUP_CONCAT(t.name) AS tag_list
FROM dish_tags dt JOIN tags t ON t.id = dt.tag_id
WHERE dt.dish_id IN (?, ?, ...)
GROUP BY dt.dish_id
```
Then build lookup maps and merge in JS. This reduces 2N+1 queries to 3.

### 4C. Reduce N+1 queries on menu list
**File:** `routes/menus.js:27-49`
**Problem:** For each menu: 1 COUNT query + 1 SELECT menu_dishes + N getDishCost calls (each doing 1 query). Total: 1 + N*(2+M) queries.
**Fix:** Replace the per-menu loop with a single aggregate query:
```sql
SELECT
  md.menu_id,
  COUNT(DISTINCT md.dish_id) AS dish_count,
  COALESCE(SUM(
    (SELECT COALESCE(SUM(di.quantity * i.unit_cost), 0)
     FROM dish_ingredients di
     JOIN ingredients i ON i.id = di.ingredient_id
     WHERE di.dish_id = md.dish_id)
    * md.servings
  ), 0) AS total_food_cost
FROM menu_dishes md
JOIN dishes d ON d.id = md.dish_id
WHERE d.deleted_at IS NULL
GROUP BY md.menu_id
```
Build a lookup map keyed by menu_id, then merge into the menu list. This replaces the entire N+1 loop with one query. Note: this simplifies cost calculation (skips unit conversion that `calculateDishCost` does), so verify results match for existing test data.

---

## Phase 5: Accessibility

### 5A. Offline banner — add ARIA live region
**File:** `public/index.html:23`
**Fix:** Add `role="alert" aria-live="assertive"`:
```html
<div id="offline-banner" class="offline-banner" role="alert" aria-live="assertive" style="display:none;">
```

### 5B. Sidebar toggle — add aria-expanded
**File:** `public/index.html:46` + `public/js/app.js` (setSidebarState function)
**Fix:** Add initial `aria-expanded="true"` to the button in HTML. Then in `setSidebarState()`, update dynamically:
```js
const toggleBtn = document.getElementById('sidebar-toggle-btn');
if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(state === 'expanded'));
```

### 5C. Bottom nav — add aria-labels
**File:** `public/index.html` (bottom nav section, lines ~187-233)
**Fix:** Add `aria-label` to each `<a class="bottom-nav-link">` element. These links use icons with text labels that may be hidden by CSS, so the aria-label ensures screen reader access:
```html
<a href="#/today" class="bottom-nav-link" data-route="/today" title="Today" aria-label="Today">
```
Apply to all bottom nav links.

---

## Phase 6: Test Coverage (highest-gap areas)

### 6A. Weekly specials integration tests
**Missing:** All 5 specials endpoints (list, create, update, delete, export-docx) have zero test coverage.
**Fix:** Create `tests/integration/specials.test.js` following the existing pattern in `serviceNotes.test.js`. Test CRUD operations, week_start filtering, and broadcast events.

### 6B. Menu dish management tests
**Missing:** PUT /:id/dishes/:dishId (update servings), DELETE /:id/dishes/:dishId (remove), PUT /:id/dishes/reorder — all untested.
**Fix:** Add test cases to existing `tests/integration/menus.test.js` covering: update servings, remove dish, reorder, and the new 404 checks added in Phase 1.

### 6C. Shopping list generator unit tests
**Missing:** `services/shoppingListGenerator.js` has no tests.
**Fix:** Create `tests/shoppingListGenerator.test.js` testing: basic aggregation, unit conversion between compatible units, incompatible unit handling (new mixed_units from Phase 2B), in-stock flag passthrough, auto-upscaling (g→kg, ml→l), and category grouping.

### 6D. Allergen detector unit tests
**Missing:** `services/allergenDetector.js` has no unit tests.
**Fix:** Create `tests/allergenDetector.test.js` testing: keyword matching with word boundaries, case insensitivity, multiple allergens on one ingredient, and the getAllergenKeywords/addAllergenKeyword functions.

---

## Execution Order & Dependencies

```
Phase 1 (Data Integrity)    — no dependencies, can start immediately
  1A  Soft-delete filter
  1B  Service notes existence checks
  1C  Ingredients existence check
  1D  Menu dish existence checks
  1E  Menu reorder existence check
  1F  Batch-complete count fix
  1G  Transactions on dish create/update
       └→ run tests/integration/dishes.test.js after

Phase 2 (Consistency)       — no dependencies on Phase 1
  2A  round2() consistency
  2B  Shopping list unit warnings
  2C  DNS timeout
       └→ run npm test after

Phase 3 (Frontend)          — no dependencies on Phase 1-2
  3A  Sync listener cleanup (3 files)
  3B  API fetch timeout
       └→ run npm run lint after

Phase 4 (Performance)       — 4B/4C should come after 1A (soft-delete fix)
  4A  Missing indexes
  4B  Dish list N+1 → batch queries
  4C  Menu list N+1 → aggregate query
       └→ run npm test after

Phase 5 (Accessibility)     — no dependencies
  5A  Offline banner ARIA
  5B  Sidebar aria-expanded
  5C  Bottom nav aria-labels
       └→ run npm run lint after

Phase 6 (Tests)             — should come after Phases 1-2 (tests verify new behavior)
  6A  Specials integration tests
  6B  Menu dish management tests
  6C  Shopping list generator tests
  6D  Allergen detector tests
       └→ run npm test after
```

Phases 1, 2, 3, and 5 are independent and can be done in any order. Phase 4B/4C depend on 1A. Phase 6 should come last to test the new behavior.

---

## Files Modified

| File | Phases | Changes |
|------|--------|---------|
| `routes/menus.js` | 1A, 1D, 1E, 2A, 4C | Soft-delete filter, existence checks, round2, N+1 fix |
| `routes/serviceNotes.js` | 1B | Existence checks on PUT/DELETE |
| `routes/ingredients.js` | 1C | Existence check on PUT |
| `routes/todos.js` | 1F | Batch-complete result.changes |
| `routes/dishes.js` | 1G, 4B | Transactions, N+1 batch queries |
| `services/shoppingListGenerator.js` | 2B | Mixed unit tracking |
| `services/recipeImporter.js` | 2C | DNS timeout |
| `public/js/pages/dishView.js` | 3A | Sync cleanup pattern |
| `public/js/pages/dishForm.js` | 3A | Sync cleanup pattern |
| `public/js/pages/menuBuilder.js` | 3A | Sync cleanup pattern |
| `public/js/api.js` | 3B | Fetch timeout |
| `db/database.js` | 4A | New migration for indexes |
| `public/index.html` | 5A, 5B, 5C | ARIA attributes |
| `public/js/app.js` | 5B | aria-expanded update in setSidebarState |
| `tests/integration/specials.test.js` | 6A | **New file** |
| `tests/integration/menus.test.js` | 6B | Additional test cases |
| `tests/shoppingListGenerator.test.js` | 6C | **New file** |
| `tests/allergenDetector.test.js` | 6D | **New file** |

---

## Verified False Positives (NOT included in plan)

These were initially reported but confirmed as non-issues:
- ~~Missing asyncHandler on async routes~~ — All async routes are already wrapped
- ~~Shopping list section headers in cost calc~~ — Section headers are in a separate table (`dish_section_headers`), never in `dish_ingredients`
- ~~WS reconnect backoff bug~~ — Delay logic is correct (increments after callback fires)
- ~~deleteAllergenKeyword broken~~ — Table does have an `id` column (schema.sql line 41)
- ~~batch_yield INTEGER vs REAL~~ — SQLite is dynamically typed; works correctly

---

## Testing Strategy

After each phase:
1. `npm run lint` — catch syntax/style issues
2. `npm test` — verify no regressions
3. For Phase 1G (transactions): manually test creating a dish and verify all sub-records are saved atomically
4. For Phase 4B/4C (N+1 fixes): verify menu list and dish list responses match before/after
