# PlateStack UI Declutter — Implementation Plan

## Overview

A systematic UI overhaul to reduce visual clutter, establish consistent patterns, and make PlateStack feel calmer and more focused. Based on a full audit of all 12 pages, 4,353 lines of CSS, and your design preferences:

- **Collapsible sections** for the dish form
- **Three-dot overflow menus** for card/row actions
- **Navigation stays as-is**

---

## Phase 1: CSS Foundation & Reusable Components

> Establish the building blocks that every page will use. ~300-400 lines of CSS changes.

### 1A. Design Token Cleanup

**Add missing tokens to `:root`:**
- Spacing scale: `--space-xs: 4px`, `--space-sm: 8px`, `--space-md: 12px`, `--space-lg: 16px`, `--space-xl: 24px`
- Typography scale: `--text-xs: 0.7rem`, `--text-sm: 0.8rem`, `--text-base: 0.9rem`, `--text-md: 1rem`, `--text-lg: 1.125rem`
- Semantic RGB variants: `--danger-rgb`, `--warning-rgb`, `--success-rgb` (for `rgba()` usage)

**Consolidate font sizes:** Replace the 15+ sub-1rem sizes scattered across the file with the 5 token values above. No visual change should be perceptible — the differences between e.g. `0.82rem` and `0.8rem` are sub-pixel.

**Fix `.btn-sm` duplicate:** Remove the second definition (line ~1565) and keep the first.

### 1B. Action Menu Component (new)

A reusable positioned dropdown — the key enabler for decluttering every page.

```
.action-menu-trigger  — the "⋯" button
.action-menu          — positioned dropdown container
.action-menu-item     — each action row (icon + label)
.action-menu-item--danger — red variant for delete actions
```

Behavior: click trigger → toggle dropdown. Click outside or Escape → close. Positioned below-right of trigger by default, flips up if near bottom of viewport.

**Implementation:** New JS component `public/js/components/actionMenu.js` (~60 lines) exporting a simple `createActionMenu(triggerEl, items[])` function. Pure vanilla JS, no dependencies.

### 1C. Collapsible Section Component (new)

For the dish form and anywhere else sections need to collapse.

```
.collapsible-section           — wrapper
.collapsible-section__header   — clickable header (title + chevron)
.collapsible-section__body     — content area (animated open/close)
.collapsible-section--open     — expanded state
```

**Implementation:** CSS-only with a thin JS helper `toggleCollapsible(sectionEl)` added to a new `public/js/components/collapsible.js` (~30 lines). Uses `max-height` transition for smooth animation.

### 1D. Visual Noise Reduction

- **Reduce shadow saturation:** Remove `box-shadow` from non-card containers (summary bars, pricing bars, filter bars, info bars). Reserve `--shadow` for true cards and `--shadow-lg` for modals/overlays. Approximately 15 shadow removals.
- **Reduce double-boundaries:** Where an element has both `border` AND `box-shadow`, keep only one. Cards keep shadow, inline rows keep border.
- **Consolidate ghost button pattern:** Create `.btn-ghost` for the ~10 places that independently define `background: none; border: none; cursor: pointer;` (remove buttons, edit icons, nav buttons, etc.)

### 1E. Print Stylesheet Consolidation

- Merge the 3 scattered `@media print` blocks into one block at the end of the file
- Fix sidebar offset: `body { padding-left: 0 !important; }`
- Hide all navigation (sidebar, bottom nav, reveal button)
- Hide all interactive controls (`.btn`, filter bars, action menus)
- Add `.no-print` utility class for markup-level hiding
- Consistent card print style: no shadows, thin border, `break-inside: avoid`

---

## Phase 2: Page-by-Page Declutter

> Apply the new components to each page, starting with the worst offenders.

### 2A. Dish Form (Clutter score: 5/5 → target 2/5)

**The biggest single improvement in the whole plan.**

Changes:
1. **Collapsible sections** — These sections start **collapsed** by default:
   - Allergens (auto-detected + manual toggles)
   - Allergen Substitutions
   - Service Components
   - Additional Cost Items
   - Service Notes

   These sections stay **always open**:
   - Basic info (name, category, price, yield, tags, description)
   - Photo
   - Ingredients
   - Directions
   - Cost Breakdown (read-only summary)

2. **Ingredient row simplification:**
   - Hide the unit-cost sub-row by default. Show a small "cost: $X" chip instead. Click to expand the cost editing row.
   - The convert button stays (it's useful) but becomes a small icon button instead of a text button.

3. **Header action cleanup:**
   - "Duplicate" moves into an overflow menu (three-dot) alongside any future secondary actions
   - "Save Changes" stays prominent as the primary CTA
   - Back arrow stays

4. **Allergen toggles:** When the Allergens section is expanded, the 14-toggle grid remains as-is (it's a reasonable UI when you're actively working with allergens — the problem is it being visible when you're NOT).

### 2B. Menu Builder (Clutter score: 5/5 → target 2/5)

Changes:
1. **Header actions:** Only "+ Add Dish" stays as a visible button. "Print Kitchen Sheet", "Scale for Event", and "Generate Todos" move into a three-dot overflow menu.

2. **Allergen/covers section:** Collapsed by default behind a collapsible "Guest Allergies & Covers" header. Shows a summary line when collapsed (e.g., "3 allergies tracked, 45 covers").

3. **Dish row simplification:**
   - Remove per-portion cost and % of price from the default view. Show only total cost per dish.
   - "Remove" button moves to a three-dot overflow menu on each row (which could later hold "View dish", "Edit dish", etc.)
   - Servings controls stay as-is (these are high-frequency interactions).

4. **Reduce top bars:** Merge the pricing bar and summary bar into a single compact stats row.

### 2C. Dish List (Clutter score: 3/5 → target 1/5)

Changes:
1. **Header:** "Import from URL" and "Import .docx" collapse into a single "Import" button with a dropdown (URL | Docx). "+ New Dish" stays prominent.
2. **Card actions:** Remove the "View" button (card is already clickable). "Duplicate" and "Delete" move into a three-dot overflow menu on each card.

### 2D. Menu List (Clutter score: 2/5 → target 1/5)

Changes:
1. **Card actions:** Remove "Open" button (card is already clickable). "Delete" moves to a three-dot overflow menu.
2. **New Menu modal:** Simplify to just name + description + sell price + covers. The allergen grid moves to the menu builder where it has more context.

### 2E. Todo View (Clutter score: 3/5 → target 2/5)

Changes:
1. **Header:** "Print" and "Prep Sheet" move into a three-dot overflow menu. "+ Add Task" stays prominent.
2. **Per-task actions:** Edit and delete already use hover-reveal (good!). No change needed.
3. **Filter bar:** Minor layout tightening — group priority + menu dropdowns more compactly.

### 2F. Other Pages (minor tweaks)

- **Service Notes (2/5):** Collapse Share/Edit/Delete into three-dot overflow per note card.
- **Specials (2/5):** Move "Export .docx" into overflow menu, keep "+ Add Special" prominent.
- **Shopping List (2/5):** Group scale controls (covers input + Scale button) more tightly. Move "Clear all in-stock" behind the overflow menu or a less prominent position.
- **Settings, Flavor Pairings, Login, Dish View:** No changes needed — already clean.

---

## Phase 3: Polish & Consistency Pass

### 3A. Card consistency
Standardize all card patterns to use the same base:
- Content cards (dishes, menus, specials, notes): `--shadow` + `--radius` + `--surface` bg
- Inline panels (cost breakdown, summary bars): border only, no shadow
- Modals/overlays: `--shadow-lg`

### 3B. Spacing consistency
Replace hardcoded gap values with spacing tokens throughout. Not a visual change — just code cleanup for maintainability.

### 3C. Color consistency
Replace remaining hardcoded colors with CSS variables:
- `#e53935` → `var(--danger-light)`
- `#e65100` / `#fff3e0` → new `--warning-*` variables
- Inline `rgba(45,106,79,...)` → `rgba(var(--primary-rgb), ...)`

---

## Files Touched

| File | Type of Change |
|------|---------------|
| `public/css/style.css` | Design tokens, new components, per-page declutter, print consolidation |
| `public/js/components/actionMenu.js` | **New file** — reusable dropdown menu |
| `public/js/components/collapsible.js` | **New file** — collapsible section helper |
| `public/js/pages/dishForm.js` | Collapsible sections, ingredient row simplification, header cleanup |
| `public/js/pages/dishList.js` | Import dropdown, card overflow menus |
| `public/js/pages/menuBuilder.js` | Header overflow, collapsible allergens, dish row cleanup, bar merge |
| `public/js/pages/menuList.js` | Card overflow, simplified create modal |
| `public/js/pages/todoView.js` | Header overflow, filter bar tightening |
| `public/js/pages/shoppingList.js` | Controls grouping, clear-stock repositioning |
| `public/js/pages/serviceNotes.js` | Card overflow menus |
| `public/js/pages/specials.js` | Header overflow menu |
| `public/index.html` | No changes (nav stays as-is) |

---

## Execution Order

1. **CSS tokens + `.btn-sm` fix + `.btn-ghost`** — zero visual change, just foundation
2. **Action menu component** (JS + CSS) — build and test in isolation
3. **Collapsible section component** (JS + CSS) — build and test in isolation
4. **Dish Form declutter** — biggest impact page, uses both new components
5. **Dish List declutter** — uses action menu
6. **Menu Builder declutter** — uses both components
7. **Menu List, Todo View, Service Notes, Specials, Shopping List** — smaller changes using action menu
8. **Visual noise pass** — shadow/border/card consistency across all pages
9. **Print stylesheet consolidation**
10. **Color and spacing token migration** — code cleanup

Steps 1-3 are foundational. Steps 4-7 are the main declutter. Steps 8-10 are polish.

---

## What This Does NOT Change

- No backend changes — all routes, DB, services untouched
- No new pages or routes
- No functionality removed — everything still works, just organized differently
- No navigation changes
- No breaking changes to the API or WebSocket events

## Testing

- Run `npm run lint` after each phase to catch issues
- Run `npm test` at the end to verify no integration breakage
- Manual visual testing on desktop (expanded + collapsed sidebar) and mobile (480px) at each page step
