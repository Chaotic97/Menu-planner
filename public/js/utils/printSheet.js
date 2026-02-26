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
 *     The overlay covers the screen so the user can see what will be printed,
 *     and eliminates the need to hide the underlying app before print renders.
 *  3. Defer window.print() by two animation frames so the browser fully
 *     recalculates and paints the injected styles before taking its print
 *     snapshot — without the defer, Chrome/Safari may capture the page in
 *     a transitional state (showing the app screen instead of the sheet).
 *  4. At @media print the overlay resets to normal flow and the rest of the
 *     page is hidden, so only the sheet content appears in the printout.
 *  5. Clean up the overlay and injected styles via afterprint + 60s fallback.
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
  overlay.innerHTML = bodyContent;
  document.body.appendChild(overlay);

  const layoutStyle = document.createElement('style');
  layoutStyle.dataset.ps = 'layout';
  layoutStyle.textContent = `
    #ps-print-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: white;
      overflow-y: auto;
      color: #1a1a1a;
      font-family: -apple-system, sans-serif;
    }
    @media print {
      body > *:not(#ps-print-overlay) { display: none !important; }
      #ps-print-overlay {
        position: static;
        overflow: visible;
        z-index: auto;
      }
    }
  `;
  document.head.appendChild(layoutStyle);

  // Content style: the sheet's own CSS, scoped to print media.
  const contentStyle = document.createElement('style');
  contentStyle.dataset.ps = 'content';
  contentStyle.media = 'print';
  contentStyle.textContent = styleContent;
  document.head.appendChild(contentStyle);

  function cleanup() {
    document.getElementById('ps-print-overlay')?.remove();
    document.querySelector('style[data-ps="layout"]')?.remove();
    document.querySelector('style[data-ps="content"]')?.remove();
  }

  // afterprint fires on iOS Safari 13+ after the print dialog is dismissed
  window.addEventListener('afterprint', cleanup, { once: true });
  // Safety fallback in case afterprint doesn't fire
  setTimeout(cleanup, 60000);

  // Two rAFs ensure injected styles are recalculated and painted before
  // window.print() captures the render state. Calling print() synchronously
  // risks the browser snapshotting the page before @media print rules apply.
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}
