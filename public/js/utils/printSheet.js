/**
 * printSheet(html)
 *
 * Prints a full HTML document string using an in-page overlay. Works reliably
 * on iOS Safari and PWA/standalone mode where window.open() is silently blocked.
 *
 * Strategy:
 *  1. Extract <style> and <body> content from the HTML string.
 *  2. Hide all other body children so the overlay is the only visible content.
 *  3. Insert the overlay as a STATIC element in normal document flow — not
 *     position:fixed. This is the critical iOS fix: iOS Safari snapshots the
 *     document for printing by capturing the laid-out page, not just the
 *     viewport. Fixed-positioned elements with overflow:auto cause iOS to
 *     print only the visible viewport (a "screenshot"), because the overflow
 *     content isn't part of the page flow. Static positioning ensures the
 *     full content is in document flow and prints completely.
 *  4. Scroll to the top so the preview starts at the beginning.
 *  5. A sticky toolbar with Close and Print buttons stays accessible while
 *     scrolling through the preview.
 *  6. Before calling window.print(), explicitly force a synchronous layout
 *     recalc (read offsetHeight) so iOS has the final geometry committed.
 *  7. At @media print the toolbar hides and padding is removed.
 *  8. Clean up: on desktop via afterprint; on iOS via the Close button only
 *     (afterprint fires too early on iOS — before printer selection completes).
 */
export function printSheet(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styleContent = styleMatch ? styleMatch[1] : '';

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Save scroll position so we can restore it on cleanup.
  const savedScrollX = window.scrollX;
  const savedScrollY = window.scrollY;

  // Remove any leftover overlay from a previous print (safety).
  const stale = document.getElementById('ps-print-overlay');
  if (stale) {
    stale.remove();
    document.querySelector('style[data-ps="layout"]')?.remove();
    document.querySelector('style[data-ps="content"]')?.remove();
  }

  // Overlay div — normal document flow (position: static), NOT fixed.
  // Since all siblings are hidden, this is the only visible content.
  const overlay = document.createElement('div');
  overlay.id = 'ps-print-overlay';
  overlay.innerHTML = `
    <div class="ps-toolbar">
      <button type="button" class="ps-close-btn">Close</button>
      <button type="button" class="ps-print-btn">Print</button>
    </div>
  ` + bodyContent;
  document.body.appendChild(overlay);

  // Layout style — static overlay so content is in normal page flow.
  const layoutStyle = document.createElement('style');
  layoutStyle.dataset.ps = 'layout';
  layoutStyle.textContent = `
    /* Hide every sibling in ALL media (not just print). iOS Safari
       re-renders when the user picks a printer and may not apply
       @media print rules on that pass — hiding unconditionally
       prevents the app page from bleeding through. */
    body > *:not(#ps-print-overlay) { display: none !important; }

    /* Reset body to ensure no leftover padding from the sidebar */
    body {
      padding-left: 0 !important;
      margin: 0;
    }

    #ps-print-overlay {
      /* Static positioning — the entire overlay is in normal document
         flow. iOS prints the full document, not just the viewport.
         This is the key difference from the old fixed-position approach. */
      position: static;
      background: white;
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      padding: 20px;
      padding-top: 0;
      min-height: 100vh;
      /* Prevent iOS from inheriting any transforms or containment
         from parent elements that could break print rendering. */
      transform: none !important;
      contain: none !important;
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
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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
      #ps-print-overlay { padding: 0; }
      .ps-toolbar { display: none !important; }
    }
  `;
  document.head.appendChild(layoutStyle);

  // Content style: apply in ALL media so iOS sees the styles during its
  // print snapshot and the user gets a styled on-screen preview.
  const contentStyle = document.createElement('style');
  contentStyle.dataset.ps = 'content';
  contentStyle.textContent = styleContent;
  document.head.appendChild(contentStyle);

  // Scroll to the top so the user sees the beginning of the preview
  // and iOS captures from the top of the document.
  window.scrollTo(0, 0);

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    document.getElementById('ps-print-overlay')?.remove();
    document.querySelector('style[data-ps="layout"]')?.remove();
    document.querySelector('style[data-ps="content"]')?.remove();
    // Restore the user's scroll position in the app.
    window.scrollTo(savedScrollX, savedScrollY);
  }

  // Close button — dismisses the overlay without printing.
  overlay.querySelector('.ps-close-btn').addEventListener('click', cleanup);

  // Print button — triggers print from the preview.
  overlay.querySelector('.ps-print-btn').addEventListener('click', () => {
    triggerPrint();
  });

  // afterprint is unreliable on iOS Safari: it fires when the share-sheet
  // dismisses (before the user picks a printer and iOS does its second render
  // pass). If we clean up at that point, iOS prints the underlying app page
  // instead of the overlay. On desktop browsers afterprint is fine, so we
  // only use it there. The Close button is always the primary exit path.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) {
    window.addEventListener('afterprint', () => setTimeout(cleanup, 300), { once: true });
  }
  // Safety fallback in case afterprint never fires or user forgets Close btn.
  setTimeout(cleanup, 120000);

  // Trigger print with robust timing for iOS.
  function triggerPrint() {
    // Force a synchronous layout recalc so the browser has fully committed
    // the overlay geometry before taking its print snapshot.
    void overlay.offsetHeight;
    // Two rAF ensures styles are recalculated and painted. The first rAF
    // schedules work for the next frame; the second runs after that frame
    // is painted — giving the browser two full
    // compositing cycles to finalize the layout.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // One more forced layout read right before print.
        void overlay.offsetHeight;
        window.print();
      });
    });
  }

  // Auto-trigger print on open.
  triggerPrint();
}
