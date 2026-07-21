# Codebase Review — Remaining Fixes Plan

Status: 5 quick-win fixes already landed in commit `bef0041`. This doc covers the remaining work.

---

## 1. Silent Error Swallowing in Frontend

**What it fixes:** Users get no feedback when certain operations fail silently — AI settings fail to load during task generation, and chat messages fail to save to the database without any indication. This means users could lose conversation history or get degraded AI features without knowing why.

### 1a. Empty catch on AI settings check
- **File:** `public/js/pages/todoView.js:75`
- **Problem:** `getAiSettings()` failure is silently swallowed — AI task generation falls back without telling the user
- **Fix:** Add `console.warn` + set a flag so the UI can show a subtle indicator that AI is unavailable

### 1b. Silent `.catch(() => {})` on conversation persistence (3 instances)
- **File:** `public/js/components/chatDrawer.js:722, 749, 796`
- **Problem:** `addConversationMessage()` failures are silently swallowed — users think their chat is saved when it isn't
- **Fix:** Add `.catch(err => console.warn('Failed to save message:', err.message))` — don't toast (too noisy) but log for debugging

---

## 2. Mega Render Functions (>500 lines)

**What it fixes:** These functions are extremely difficult to maintain, test, or debug. A single typo or logic error in a 1,700-line function is hard to locate. Extracting helpers improves readability, makes individual pieces testable, and reduces merge conflicts when multiple features touch the same page.

| File | Function | Lines | Priority |
|------|----------|-------|----------|
| `public/js/pages/dishForm.js` | `renderDishForm` | 1,713 | High |
| `public/js/pages/menuBuilder.js` | `renderMenuBuilder` | 1,640 | High |
| `public/js/pages/settings.js` | `renderSettings` | 1,065 | Medium |
| `public/js/pages/today.js` | `renderToday` | 658 | Low |
| `public/js/pages/todoView.js` | `renderTodoView` | 577 | Low |

### Approach
- Extract logical sections into helper functions **in the same file** (no new files unless a section is reused elsewhere)
- Candidates for extraction: HTML template builders, event listener setup, data fetching/transformation
- Do one file per PR to keep diffs reviewable
- Start with `dishForm.js` and `menuBuilder.js` (highest line counts)

---

## 3. Jest Worker Leak

**What it fixes:** The "worker process has failed to exit gracefully" warning on every test run. While tests still pass, this indicates resource leaks (timers, open handles) that slow down CI and could mask real issues if the warning count grows.

### Root cause
The test `DbWrapper` in `tests/helpers/setupTestApp.js` doesn't have `cancelPendingSave()`. Any DB write during tests schedules `setTimeout` timers (500ms debounce + 5s max) that are never cleared, keeping the Node process alive past Jest's shutdown window.

### Fix
- Add `cancelPendingSave()` to the test DbWrapper class in `setupTestApp.js`
- Call `db.cancelPendingSave()` in the `cleanup()` function
- This matches the production DbWrapper API

### Secondary cause (lower priority)
- `services/recipeImporter.js:39-43` — DNS timeout `setTimeout` in `Promise.race()` is never cleared when DNS resolves first. Fix: clear the timer after the race settles.

---

## 4. CSS File Size (Informational)

**What it fixes:** `public/css/style.css` is 7,633 lines — not broken, but increasingly hard to navigate and maintain. No immediate action needed, but future features should consider whether extracted component styles make sense.

### Possible future approach
- No preprocessor (project constraint), but could split into multiple CSS files loaded via `<link>` tags
- Would require updating the service worker precache list
- Not urgent — the single-file approach works fine for now

---

## Execution Order

| Step | Task | Effort | Risk |
|------|------|--------|------|
| 1 | Fix silent error swallowing (§1a, §1b) | Small | Low |
| 2 | Fix Jest worker leak (§3) | Small | Low |
| 3 | Extract helpers from `dishForm.js` (§2) | Medium | Medium |
| 4 | Extract helpers from `menuBuilder.js` (§2) | Medium | Medium |
| 5 | Extract helpers from `settings.js` (§2) | Medium | Low |
| 6 | Extract helpers from `today.js` / `todoView.js` (§2) | Small | Low |

Steps 1–2 are standalone fixes. Steps 3–6 are incremental refactors best done one file per PR.
