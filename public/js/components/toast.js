let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {string} type - 'success' | 'error' | 'info'
 * @param {number} duration - ms before auto-dismiss
 * @param {object} [action] - optional { label, onClick } to render an action button (e.g. Undo)
 */
export function showToast(message, type = 'success', duration = 3000, action = null) {
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (action && action.label && action.onClick) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      action.onClick();
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    });
    toast.appendChild(btn);
    // Extend duration for action toasts
    if (duration < 8000) duration = 8000;
  }

  c.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}
