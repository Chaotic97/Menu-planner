export function openModal(title, contentHtml, onClose) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${contentHtml}</div>
    </div>
  `;

  overlay.querySelector('.modal-close').addEventListener('click', () => {
    closeModal(overlay);
    if (onClose) onClose();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal(overlay);
      if (onClose) onClose();
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  return overlay;
}

export function closeModal(overlay) {
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.remove(), 200);
}
