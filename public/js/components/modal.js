import { escapeHtml } from '../utils/escapeHtml.js';

export function openModal(title, contentHtml, onClose) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-header">
        <h2>${escapeHtml(title)}</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${contentHtml}</div>
    </div>
  `;

  function handleClose() {
    closeModal(overlay);
    if (onClose) onClose();
    if (previousFocus && previousFocus.focus) previousFocus.focus();
  }

  overlay.querySelector('.modal-close').addEventListener('click', handleClose);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) handleClose();
  });

  // Close on Escape key
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleClose();
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('show');
    // Focus the first focusable element inside the modal
    const focusable = overlay.querySelector('input, select, textarea, button:not(.modal-close), [tabindex]:not([tabindex="-1"])');
    if (focusable) focusable.focus();
    else overlay.querySelector('.modal-close').focus();
  });

  return overlay;
}

export function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.remove(), 200);
}
