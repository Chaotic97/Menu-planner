/**
 * printSheet(html)
 *
 * Prints a full HTML document string using an in-page overlay instead of
 * window.open(). This works on iOS Safari and PWA/standalone mode where
 * window.open() is silently blocked or returns a window with a null document.
 *
 * Strategy:
 *  1. Extract the <style> block and <body> content from the HTML string.
 *  2. Inject an overlay <div> with the body content into the current page.
 *  3. Add print-only CSS that hides everything except the overlay.
 *  4. Call window.print() on the main window.
 *  5. Clean up the overlay and injected styles once printing is done.
 */
export function printSheet(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styleContent = styleMatch ? styleMatch[1] : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Overlay div — holds the print content, hidden on screen
  const overlay = document.createElement('div');
  overlay.id = 'ps-print-overlay';
  overlay.innerHTML = bodyContent;
  document.body.appendChild(overlay);

  // Layout style: hide everything except the overlay during printing
  const layoutStyle = document.createElement('style');
  layoutStyle.dataset.ps = 'layout';
  layoutStyle.textContent = `
    #ps-print-overlay { display: none; }
    @media print {
      body > *:not(#ps-print-overlay) { display: none !important; }
      #ps-print-overlay { display: block !important; }
    }
  `;
  document.head.appendChild(layoutStyle);

  // Content style: the sheet's own CSS, applied only during printing
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

  window.print();
}
