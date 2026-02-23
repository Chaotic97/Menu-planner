import { FLAVOR_PAIRINGS, CATEGORIES, searchPairings } from '../data/flavorPairings.js';

export function renderFlavorPairings(container) {
  let selectedItem = null;
  let filterCategory = '';
  let searchQuery = '';

  container.innerHTML = `
    <div class="page-header">
      <h1>Flavor Pairings</h1>
    </div>
    <p class="subtitle" style="margin-bottom:20px;color:var(--text-muted);">
      Based on general culinary knowledge and classic flavor principles.
      Use alongside resources like <em>The Flavor Bible</em> for deeper exploration.
    </p>

    <div class="fp-layout">
      <div class="fp-sidebar">
        <input type="text" id="fp-search" class="input" placeholder="Search ingredients...">
        <div class="fp-category-filters" id="fp-categories">
          <button class="fp-cat-btn active" data-cat="">All</button>
          ${CATEGORIES.map(c => `<button class="fp-cat-btn" data-cat="${c}">${c}</button>`).join('')}
        </div>
        <div id="fp-list" class="fp-list"></div>
      </div>

      <div class="fp-detail" id="fp-detail">
        <div class="fp-detail-placeholder">
          <div style="font-size:3rem;margin-bottom:12px;">🍋</div>
          <p>Select an ingredient to see flavor pairings</p>
        </div>
      </div>
    </div>
  `;

  function renderList() {
    let items = FLAVOR_PAIRINGS;
    if (filterCategory) items = items.filter(p => p.category === filterCategory);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      items = items.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.pairings.some(pair => pair.toLowerCase().includes(q))
      );
    }

    const list = document.getElementById('fp-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty-state" style="padding:30px 0;"><p>No results found.</p></div>';
      return;
    }

    list.innerHTML = items.map(item => `
      <button class="fp-list-item ${selectedItem?.id === item.id ? 'active' : ''}" data-id="${item.id}">
        <span class="fp-item-name">${item.name}</span>
        <span class="fp-item-cat">${item.category}</span>
      </button>
    `).join('');

    list.querySelectorAll('.fp-list-item').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedItem = FLAVOR_PAIRINGS.find(p => p.id === btn.dataset.id);
        renderList();
        renderDetail();
      });
    });
  }

  function renderDetail() {
    const detail = document.getElementById('fp-detail');
    if (!selectedItem) {
      detail.innerHTML = `<div class="fp-detail-placeholder">
        <div style="font-size:3rem;margin-bottom:12px;">🍋</div>
        <p>Select an ingredient to see flavor pairings</p>
      </div>`;
      return;
    }

    const item = selectedItem;

    detail.innerHTML = `
      <div class="fp-detail-header">
        <h2>${item.name}</h2>
        <span class="fp-cat-badge">${item.category}</span>
      </div>

      ${item.flavor_profile?.length ? `
        <div class="fp-section">
          <h3 class="fp-section-title">Flavor Profile</h3>
          <div class="fp-profile-tags">
            ${item.flavor_profile.map(f => `<span class="fp-profile-tag">${f}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      ${item.notes ? `
        <div class="fp-section">
          <p class="fp-notes">${item.notes}</p>
        </div>
      ` : ''}

      <div class="fp-section">
        <h3 class="fp-section-title">Pairs Well With</h3>
        <div class="fp-pairings-grid">
          ${item.pairings.map(pair => {
            const linked = FLAVOR_PAIRINGS.find(p =>
              p.name.toLowerCase() === pair.toLowerCase() ||
              p.id === pair.toLowerCase().replace(/\s+/g, '-')
            );
            return `<button class="fp-pairing-chip ${linked ? 'fp-linked' : ''}" data-id="${linked?.id || ''}" data-name="${pair}">
              ${pair}${linked ? ' →' : ''}
            </button>`;
          }).join('')}
        </div>
      </div>
    `;

    detail.querySelectorAll('.fp-pairing-chip.fp-linked').forEach(chip => {
      chip.addEventListener('click', () => {
        selectedItem = FLAVOR_PAIRINGS.find(p => p.id === chip.dataset.id);
        renderList();
        renderDetail();
        // Scroll detail to top on mobile
        detail.scrollTop = 0;
      });
    });
  }

  // Search
  document.getElementById('fp-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderList();
  });

  // Category filter
  document.getElementById('fp-categories').addEventListener('click', (e) => {
    const btn = e.target.closest('.fp-cat-btn');
    if (!btn) return;
    filterCategory = btn.dataset.cat;
    document.querySelectorAll('.fp-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  });

  renderList();
  renderDetail();
}
