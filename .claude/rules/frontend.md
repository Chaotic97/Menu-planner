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
- **Sidebar states**: `expanded` (240px), `collapsed` (64px icon rail), `hidden` (0px). Use `setSidebarState()` in `app.js`.
- **Responsive**: ≥481px sidebar nav; ≤480px bottom tab bar. Do not invent new breakpoints.
- **Directions vs chefs_notes**: Structured steps in `dish_directions` table. Old `chefs_notes` is legacy fallback. If user adds direction steps, `chefs_notes` is cleared on save.
- **Tasks vs Shopping**: Separate pages. Tasks (`#/todos`) = prep + custom tasks in `tasks` table. Shopping (`#/shopping`) = computed on-the-fly from menu ingredients, not stored.
- **Food cost colours**: green ≤30%, yellow 30–35%, red >35%.
- **Batch yield**: `dishes.batch_yield` (REAL, default 1) = portions per batch. `cost_per_portion = total_cost / batch_yield`. Menu builder: `Math.ceil(target / batchYield)` = required batches.
