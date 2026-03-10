let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

const TOAST_ICONS = {
  success: `<svg class="toast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="16 9 10.5 14.5 8 12"/></svg>`,
  error: `<svg class="toast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  warning: `<svg class="toast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  info: `<svg class="toast-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
};

const MAX_TOASTS = 3;

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} type - 'success' | 'error' | 'info' | 'warning'
 * @param {number} duration - ms before auto-dismiss
 * @param {object} [action] - optional { label, onClick } to render an action button (e.g. Undo)
 */
export function showToast(message, type = 'success', duration = 3000, action = null) {
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  // Icon
  const iconHtml = TOAST_ICONS[type] || TOAST_ICONS.info;
  const iconWrapper = document.createElement('span');
  iconWrapper.className = 'toast-icon-wrap';
  iconWrapper.innerHTML = iconHtml;
  toast.appendChild(iconWrapper);

  // Message text
  const textSpan = document.createElement('span');
  textSpan.className = 'toast-text';
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (action && action.label && action.onClick) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.onClick();
      dismissToast(toast);
    });
    toast.appendChild(btn);
    // Extend duration for action toasts
    if (duration < 8000) duration = 8000;
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissToast(toast);
  });
  toast.appendChild(closeBtn);

  // Enforce max toast limit — remove oldest first
  while (c.children.length >= MAX_TOASTS) {
    c.firstChild.remove();
  }

  c.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  const autoTimer = setTimeout(() => dismissToast(toast), duration);
  toast._autoTimer = autoTimer;
}

function dismissToast(toast) {
  if (toast._autoTimer) clearTimeout(toast._autoTimer);
  toast.classList.remove('show');
  setTimeout(() => toast.remove(), 300);
}
