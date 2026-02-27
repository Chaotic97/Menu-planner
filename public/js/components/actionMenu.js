/**
 * Action Menu — a positioned dropdown triggered by a "⋯" button.
 *
 * Usage:
 *   import { createActionMenu } from '../components/actionMenu.js';
 *
 *   const trigger = createActionMenu([
 *     { label: 'Edit', icon: '✏️', onClick: () => { ... } },
 *     { label: 'Delete', icon: '🗑', danger: true, onClick: () => { ... } },
 *   ]);
 *   parentEl.appendChild(trigger);
 */

let openMenu = null;

function closeOpenMenu() {
  if (openMenu) {
    openMenu.remove();
    openMenu = null;
  }
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onDocKey);
}

function onDocClick(e) {
  if (openMenu && !openMenu.contains(e.target)) {
    closeOpenMenu();
  }
}

function onDocKey(e) {
  if (e.key === 'Escape') {
    closeOpenMenu();
  }
}

/**
 * @param {Array<{label:string, icon?:string, danger?:boolean, onClick:Function}>} items
 * @param {object} [opts]
 * @param {string} [opts.triggerClass] — extra class for the trigger button
 * @returns {HTMLButtonElement} the trigger button (append it wherever you need)
 */
export function createActionMenu(items, opts = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = `action-menu-trigger${opts.triggerClass ? ' ' + opts.triggerClass : ''}`;
  trigger.setAttribute('aria-label', 'More actions');
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    // If this trigger's menu is already open, close it
    if (openMenu && openMenu._trigger === trigger) {
      closeOpenMenu();
      return;
    }

    closeOpenMenu();

    const menu = document.createElement('div');
    menu.className = 'action-menu';
    menu._trigger = trigger;

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-menu-item' + (item.danger ? ' action-menu-item--danger' : '');
      btn.innerHTML = (item.icon ? `<span class="action-menu-icon">${item.icon}</span>` : '') +
        `<span>${item.label}</span>`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeOpenMenu();
        item.onClick();
      });
      menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    openMenu = menu;

    // Position relative to trigger
    const rect = trigger.getBoundingClientRect();
    const menuW = 180;
    let left = rect.right - menuW;
    let top = rect.bottom + 4;

    // Flip up if near bottom
    if (top + 200 > window.innerHeight) {
      top = rect.top - 4;
      menu.style.transform = 'translateY(-100%)';
    }

    // Keep on screen horizontally
    if (left < 8) left = 8;

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Delay listener so the current click doesn't immediately close
    requestAnimationFrame(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onDocKey);
    });
  });

  return trigger;
}
