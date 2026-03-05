---
globs: ["public/css/**"]
---
# CSS Conventions

## Single stylesheet
- All styles in `public/css/style.css`. No preprocessor.

## Section headers
```css
/* ============================
   Section Name
   ============================ */
```
Sub-sections:
```css
/* --- Section Name: sub-topic --- */
```

## Class naming prefixes
| Prefix | Feature |
|--------|---------|
| `.dv-` | Dish View |
| `.fp-` | Flavor Pairings |
| `.sn-` | Service Notes |
| `.po-` | Purchase Order |
| `.uc-` | Unit Converter |
| `.ing-` | Ingredient rows |
| `.mb-` | Menu Builder |
| `.dir-` | Directions |
| `.td-` | Todo/Task system |
| `.sl-` | Shopping List |
| `.st-` | Settings |
| `.nt-` | Notifications |
| `.cb-` | Command Bar |
| `.ai-` | AI features |
| `.chat-` | Chat Drawer |

Global components (`.btn`, `.card`, `.modal`, `.toast`, etc.) are unprefixed. New features with >3 classes get a prefix.

## Design tokens
- All in `:root`. Use `--primary-rgb`, `--danger-rgb`, `--warning-rgb`, `--success-rgb` for `rgba()` tinted backgrounds.
- Dark mode: `[data-theme="dark"]` block below `:root`. Component-specific dark overrides at end of that block under `/* --- Component-specific dark overrides --- */`.

## Elevation hierarchy
- Content cards: `box-shadow: var(--shadow)`
- Inline panels (summary/filter bars): `border: 1px solid var(--border)` only
- Modals/overlays: `box-shadow: var(--shadow-lg)`
- Action menus: `box-shadow: var(--shadow-lg)` (position: fixed)
