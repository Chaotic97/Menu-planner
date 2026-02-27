/**
 * printSheet(html)
 *
 * Prints a full HTML document string using an in-page overlay instead of
 * window.open(). This works on iOS Safari and PWA/standalone mode where
 * window.open() is silently blocked or returns a window with a null document.
 *
 * Strategy:
 *  1. Extract the <style> block and <body> content from the HTML string.
 *  2. Inject a fixed full-viewport overlay <div> with the body content.
 *     The overlay covers the screen so the user can see a styled preview
 *     of what will be printed.
 *  3. Content styles apply in ALL media (not just print) so iOS Safari
 *     can render them correctly during its print snapshot. This also gives
 *     the user a proper on-screen preview.
 *  4. Hide all other body children immediately (not just at @media print) so
 *     iOS Safari cannot snapshot the underlying page when it re-renders for
 *     printer selection.
 *  5. A visible "Close" button lets the user dismiss the overlay manually —
 *     critical for iOS/PWA where window.print() may silently fail.
 *  6. Defer window.print() by two animation frames so the browser fully
 *     recalculates and paints the injected styles before taking its print
 *     snapshot — without the defer, Chrome/Safari may capture the page in
 *     a transitional state (showing the app screen instead of the sheet).
 *  7. At @media print the overlay resets to normal flow so it prints correctly.
 *  8. Clean up the overlay and injected styles via afterprint + 60s fallback.
 */
export function printSheet(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styleContent = styleMatch ? styleMatch[1] : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Overlay div — covers the full viewport on screen so the user sees the
  // print content, and resets to normal flow at @media print.
  const overlay = document.createElement('div');
  overlay.id = 'ps-print-overlay';
  overlay.innerHTML = `
    <div class="ps-toolbar">
      <button type="button" class="ps-close-btn">Close</button>
      <button type="button" class="ps-print-btn">Print</button>
    </div>
  ` + bodyContent;
  document.body.appendChild(overlay);

  const layoutStyle = document.createElement('style');
  layoutStyle.dataset.ps = 'layout';
  layoutStyle.textContent = `
    /* Hide all siblings in every media context — not just print.
       iOS Safari re-renders the page when the user selects a printer
       and may not apply @media print rules in that pass, so the
       underlying app page would bleed through. Hiding siblings
       unconditionally prevents that while the overlay covers the
       viewport anyway. */
    body > *:not(#ps-print-overlay) { display: none !important; }
    #ps-print-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: white;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 20px;
      padding-top: 0;
    }
    .ps-toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 0;
      background: white;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    .ps-close-btn, .ps-print-btn {
      padding: 8px 20px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    .ps-close-btn {
      background: #f5f5f5;
      border: 1px solid #ddd;
      color: #333;
    }
    .ps-print-btn {
      background: #2d6a4f;
      border: 1px solid #2d6a4f;
      color: white;
    }
    @media print {
      #ps-print-overlay {
        position: static;
        overflow: visible;
        z-index: auto;
        padding: 0;
      }
      .ps-toolbar { display: none !important; }
    }
  `;
  document.head.appendChild(layoutStyle);

  // Content style: apply in ALL media (not just print) so iOS Safari
  // renders the styles during its print snapshot and the user sees a
  // styled on-screen preview.
  const contentStyle = document.createElement('style');
  contentStyle.dataset.ps = 'content';
  contentStyle.textContent = styleContent;
  document.head.appendChild(contentStyle);

  function cleanup() {
    document.getElementById('ps-print-overlay')?.remove();
    document.querySelector('style[data-ps="layout"]')?.remove();
    document.querySelector('style[data-ps="content"]')?.remove();
  }

  // Close button — lets users dismiss the overlay manually (critical for
  // iOS PWA where window.print() may silently fail).
  overlay.querySelector('.ps-close-btn').addEventListener('click', cleanup);

  // Print button — lets users re-trigger print from the preview.
  overlay.querySelector('.ps-print-btn').addEventListener('click', () => window.print());

  // afterprint fires on iOS Safari 13+ after the print dialog is dismissed.
  // Delay cleanup slightly so iOS finishes its final render pass before we
  // restore the hidden page content — prevents a flash of the app page if
  // the event fires while iOS is still compositing the printed output.
  window.addEventListener('afterprint', () => setTimeout(cleanup, 300), { once: true });
  // Safety fallback in case afterprint doesn't fire
  setTimeout(cleanup, 120000);

  // Two rAFs ensure injected styles are recalculated and painted before
  // window.print() captures the render state. Calling print() synchronously
  // risks the browser snapshotting the page before styles are applied.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
