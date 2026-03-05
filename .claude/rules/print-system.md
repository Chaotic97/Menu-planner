---
globs: ["public/js/utils/printSheet.js", "public/js/pages/dishView.js", "public/js/pages/menuBuilder.js", "public/js/pages/shoppingList.js", "public/js/pages/todoView.js"]
---
# Print System — iOS-Critical Rules

Printing is used daily in a professional kitchen. `printSheet(html)` injects a static overlay, hides siblings, calls `window.print()`. **Any change must be tested on a real iOS device.**

## iOS constraints (non-negotiable)
1. **NEVER `position: fixed`** on the print overlay. iOS snapshots viewport before applying `@media print`. Use `position: static`.
2. **NEVER `overflow: auto/scroll`** on overlay or print containers. iOS clips to scroll viewport.
3. **NEVER rely solely on `@media print`** for layout changes. iOS may not apply them during snapshot.
4. **Always hide siblings unconditionally** — `body > *:not(#ps-print-overlay) { display: none !important; }` in all media.
5. **Force layout recalc** before `window.print()` — `void overlay.offsetHeight` + double `requestAnimationFrame`.
6. **Scroll to top** (`window.scrollTo(0, 0)`) before showing overlay.
7. **NEVER use `window.open()`** for print — silently blocked in iOS Safari/PWA.
8. **NEVER use `afterprint` for cleanup on iOS** — fires before user selects printer. Use Close button.

## Print content
- Each print function builds complete HTML with inline `<style>` tags (not wrapped in `@media print`).
- Global print CSS at end of `style.css` includes belt-and-suspenders `#ps-print-overlay` rule.
- Use `.no-print` class to hide elements when printing.
