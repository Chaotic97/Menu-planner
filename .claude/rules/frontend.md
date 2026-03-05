---
globs: ["public/js/**"]
---
# Frontend Conventions

## Module system
- **ES modules only** — `import`/`export`. Never use `require()`. No bundler.

## Page modules
- Each page exports `async function renderXxx(container)`.
- Set `container.innerHTML` first, then attach listeners.
- **`escapeHtml()` is mandatory** on every user-supplied string in template literals. Import from `../utils/escapeHtml.js`. Skipping it is an XSS hole.
- **Never call `fetch()` directly.** Use functions from `../api.js`. Exception: binary blob downloads.

## API client (`api.js`)
- Only place `fetch()` is called. Two internal helpers: `request()` (authenticated) and `authRequest()` (public auth endpoints).
- Adding a function: `export const getMyThing = (id) => request('/my-thing/${id}');`
- Body as plain object → auto JSON.stringified. FormData → sent as-is.

## Components
- Toast: `showToast(message, type, duration, action)`. `type` is a string: `'error'`, `'success'`, `'warning'` — NOT an object.
- Modal: `openModal(title, contentHtml, onClose)` / `closeModal()`.
- Action menu: `createActionMenu(items)` returns a trigger button element. Items: `[{ label, icon?, danger?, onClick }]`. Secondary actions go in overflow menu; only primary CTA as visible button.
- Collapsible: `makeCollapsible(el, { open, storageKey })`. Pass `storageKey` to persist state.

## WebSocket sync
- Listen: `window.addEventListener('sync:event_type', e => { ... })` — payload in `e.detail`.
- **Cleanup required**: Pages with sync listeners must remove them on `hashchange` to prevent leaks.
```js
const syncHandler = () => { /* re-fetch */ };
for (const evt of syncEvents) window.addEventListener(evt, syncHandler);
const cleanup = () => {
  for (const evt of syncEvents) window.removeEventListener(evt, syncHandler);
  window.removeEventListener('hashchange', cleanup);
};
window.addEventListener('hashchange', cleanup);
```

## Adding a new page
1. Create `public/js/pages/myPage.js` exporting `renderMyPage(container)`.
2. In `app.js`: import and add route entry.
3. Add nav links in `index.html` (sidebar + bottom tab bar). Copy existing pattern with SVG icon slot + label.
4. Add backend route + `api.js` function if needed.
5. Add CSS with a feature prefix (e.g. `.mp-`).

## Architecture notes
- **Sidebar states**: `expanded` (240px), `collapsed` (64px icon rail), `hidden` (0px). Use `setSidebarState()` in `app.js`. State stored on `<html data-sidebar="...">` and in `localStorage('sidebarState')`.
- **Responsive**: ≥481px sidebar nav; ≤480px bottom tab bar. Do not invent new breakpoints.
- **Food cost colours**: green ≤30%, yellow 30–35%, red >35%.

### Directions vs chefs_notes
- Structured steps in `dish_directions` (type `'step'`/`'section'`, with `sort_order`). Old `chefs_notes` is legacy fallback.
- **Dish form**: Drag-and-drop steps UI. If dish has `chefs_notes` but no directions, shows read-only "Legacy Chef's Notes" box.
- **Dish view**: Renders structured directions when available; falls back to `chefs_notes` with `<br>` newlines.
- **Prep task generator**: One direction row = one prep task when `dish_directions` exist; falls back to sentence-splitting `chefs_notes`.
- **On save**: Adding ≥1 direction step clears `chefs_notes`. No steps → `chefs_notes` preserved.
- **Importers**: Both URL and docx importers return `directions[]` alongside legacy `instructions` string.

### Tasks vs Shopping (split architecture)
- **Tasks** (`#/todos`, `todoView.js`): Only prep + custom types. Shopping is NOT a task type.
  - `source='auto'` created by `POST /api/todos/generate/:menuId`. `source='manual'` = user-created/edited.
  - **Promotion**: Editing content fields of auto task promotes to `manual`. Toggling `completed` does NOT promote.
  - **Standalone tasks**: `menu_id = NULL` tasks survive independent of any menu.
  - **Completion**: Sets `completed=1` + `completed_at`. Toast shows 8-second Undo. Completed hidden by default.
  - **Tabs**: "All Tasks" (by due date), "Prep" (by timing bucket), "By Menu" (menu selector + regenerate).
- **Shopping** (`#/shopping`, `shoppingList.js`): Computed on-the-fly from menu ingredients via `generateShoppingList()`. NOT in `tasks` table.
  - `in_stock` flag on ingredients — in-stock items greyed out at bottom, not hidden.
  - Routes: `#/shopping` (all menus) and `#/menus/:id/shopping` (specific menu).
  - Legacy endpoints preserved: `GET /api/todos/menu/:id/shopping-list`, `scaled-shopping-list`, `prep-tasks`.

### Collapsible form sections
- Dish form collapses secondary sections (Allergens, Substitutions, etc.) with localStorage keys prefixed `dish_sec_`.
- Menu builder collapses "Guest Allergies & Covers" with key `mb_allergy_section`.

### Batch yield (recipe scaling)
- `dishes.batch_yield` (REAL, default 1) = portions per batch. Accepts any positive number (decimals OK).
- Dish cost: `cost_per_portion = total_cost / batch_yield`
- Menu totals: `total_portions = servings * batch_yield`
- Kitchen print: Ingredients multiplied by `servings` (batch count); includes `base_quantity`, `batch_yield`, `total_portions`
- Menu builder: `Math.ceil(target / batchYield)` = required batches
- Dish form input: step 0.5, min 0.5, parsed as float
