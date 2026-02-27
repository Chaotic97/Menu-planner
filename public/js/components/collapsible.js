/**
 * Collapsible Section — a lightweight toggle for form sections.
 *
 * Usage:
 *   import { makeCollapsible } from '../components/collapsible.js';
 *
 *   // In your HTML template:
 *   <div class="collapsible-section" id="my-section">
 *     <button type="button" class="collapsible-section__header">
 *       <span>Section Title</span>
 *       <span class="collapsible-chevron">&#9662;</span>
 *     </button>
 *     <div class="collapsible-section__body">
 *       ...content...
 *     </div>
 *   </div>
 *
 *   makeCollapsible(document.getElementById('my-section'), { open: false });
 */

/**
 * @param {HTMLElement} sectionEl — the .collapsible-section wrapper
 * @param {object} [opts]
 * @param {boolean} [opts.open=true] — initial state
 * @param {string} [opts.storageKey] — localStorage key to persist state
 */
export function makeCollapsible(sectionEl, opts = {}) {
  const header = sectionEl.querySelector('.collapsible-section__header');
  const body = sectionEl.querySelector('.collapsible-section__body');
  if (!header || !body) return;

  let isOpen;
  if (opts.storageKey) {
    const stored = localStorage.getItem(opts.storageKey);
    isOpen = stored !== null ? stored === '1' : (opts.open !== false);
  } else {
    isOpen = opts.open !== false;
  }

  function apply() {
    if (isOpen) {
      sectionEl.classList.add('collapsible-section--open');
      body.style.display = '';
    } else {
      sectionEl.classList.remove('collapsible-section--open');
      body.style.display = 'none';
    }
    if (opts.storageKey) {
      localStorage.setItem(opts.storageKey, isOpen ? '1' : '0');
    }
  }

  header.addEventListener('click', () => {
    isOpen = !isOpen;
    apply();
  });

  apply();
}

/**
 * Helper to generate the HTML for a collapsible section header.
 * @param {string} title
 * @param {string} [subtitle] — optional summary shown next to title
 * @returns {string} HTML string
 */
export function collapsibleHeader(title, subtitle) {
  return `<button type="button" class="collapsible-section__header">
    <span class="collapsible-section__title">${title}</span>
    ${subtitle ? `<span class="collapsible-section__subtitle">${subtitle}</span>` : ''}
    <span class="collapsible-chevron">&#9662;</span>
  </button>`;
}
