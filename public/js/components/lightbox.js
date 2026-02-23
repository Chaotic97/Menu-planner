export function openLightbox(imageSrc, title) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `
    <button class="lightbox-close" aria-label="Close">&times;</button>
    <img src="${imageSrc}" class="lightbox-image" alt="${title || 'Photo'}">
    ${title ? `<div class="lightbox-title">${title}</div>` : ''}
  `;

  function close() {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener('keydown', handleKey);
  }

  function handleKey(e) {
    if (e.key === 'Escape') close();
  }

  overlay.querySelector('.lightbox-close').addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  // Prevent closing when clicking the image itself
  overlay.querySelector('.lightbox-image').addEventListener('click', (e) => {
    e.stopPropagation();
  });

  document.addEventListener('keydown', handleKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
}
