import { FLAVOR_PAIRINGS, CATEGORIES } from '../data/flavorPairings.js';

// Category colour palette — dark enough to read as text on light backgrounds
const CATEGORY_COLORS = {
  'Poultry':            '#d97706',
  'Protein':            '#dc2626',
  'Fish':               '#2563eb',
  'Shellfish':          '#0891b2',
  'Vegetable':          '#16a34a',
  'Vegetable / Fruit':  '#65a30d',
  'Starch':             '#7c3aed',
  'Herb':               '#65a30d',
  'Aromatic':           '#7c3aed',
  'Aromatic / Spice':   '#ea580c',
  'Spice':              '#ea580c',
  'Fat / Dairy':        '#ca8a04',
  'Dairy':              '#ca8a04',
  'Acid / Citrus':      '#ca8a04',
  'Acid':               '#65a30d',
  'Condiment / Umami':  '#be123c',
  'Luxury / Umami':     '#b45309',
  'Fruit':              '#db2777',
  'Fruit / Citrus':     '#c2410c',
  'Nut':                '#92400e',
  'Legume':             '#4b5563',
  'Sweet / Bitter':     '#374151',
  'Sweet / Aromatic':   '#be185d',
  'Sweet':              '#be185d',
  'Grain':              '#92400e',
};

function getCatColor(category) {
  return CATEGORY_COLORS[category] || 'var(--primary)';
}

export function renderFlavorPairings(container) {
  let selectedItem = null;
  let filterCategory = '';
  let searchQuery = '';
  let navHistory = []; // breadcrumb stack for linked-chip navigation

  container.innerHTML = `
    <div class="page-header">
      <h1>Flavor Pairings</h1>
    </div>
    <p class="fp-subtitle">
      Based on general culinary knowledge and classic flavor principles.
      Use alongside resources like <em>The Flavor Bible</em> for deeper exploration.
    </p>

    <div class="fp-layout">
      <div class="fp-sidebar">
        <div class="fp-search-bar">
          <input type="text" id="fp-search" class="input" placeholder="Search ingredients...">
        </div>
        <div class="fp-category-bar" id="fp-categories">
          <button class="fp-cat-btn active" data-cat="">All</button>
          ${CATEGORIES.map(c => `<button class="fp-cat-btn" data-cat="${c}">${c}</button>`).join('')}
        </div>
        <div id="fp-list" class="fp-ingredient-list"></div>
      </div>

      <div class="fp-detail" id="fp-detail">
        <div class="fp-detail-placeholder">
          <div style="font-size:3rem;margin-bottom:12px;">🍋</div>
          <p>Select an ingredient to see its flavor pairings</p>
        </div>
      </div>
    </div>
  `;

  const listEl = container.querySelector('#fp-list');
  const detailEl = container.querySelector('#fp-detail');

  // ── List helpers ────────────────────────────────────────────────────────────

  function ingredientItemHtml(item) {
    const isActive = selectedItem?.id === item.id;
    const color = getCatColor(item.category);
    return `
      <button class="fp-ingredient-item${isActive ? ' active' : ''}"
              data-id="${item.id}"
              style="border-left-color:${isActive ? color : 'transparent'}">
        <span class="fp-ingredient-name">${item.name}</span>
        <span class="fp-ingredient-cat">${item.category}</span>
      </button>
    `;
  }

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

    if (!items.length) {
      listEl.innerHTML = '<div class="fp-empty"><p>No results found.</p></div>';
      return;
    }

    if (!filterCategory && !searchQuery) {
      // Group by category with sticky section headers
      const grouped = {};
      for (const item of items) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }
      listEl.innerHTML = Object.entries(grouped).map(([cat, catItems]) => `
        <div class="fp-category-group">
          <div class="fp-category-header" style="border-left-color:${getCatColor(cat)}">${cat}</div>
          ${catItems.map(item => ingredientItemHtml(item)).join('')}
        </div>
      `).join('');
    } else {
      listEl.innerHTML = items.map(item => ingredientItemHtml(item)).join('');
    }

    listEl.querySelectorAll('.fp-ingredient-item').forEach(btn => {
      btn.addEventListener('click', () => {
        navHistory = []; // reset breadcrumb when navigating from list
        selectedItem = FLAVOR_PAIRINGS.find(p => p.id === btn.dataset.id);
        updateActiveItems();
        renderDetail();
      });
    });
  }

  function updateActiveItems() {
    listEl.querySelectorAll('.fp-ingredient-item').forEach(btn => {
      const isActive = btn.dataset.id === selectedItem?.id;
      btn.classList.toggle('active', isActive);
      btn.style.borderLeftColor = isActive ? getCatColor(selectedItem.category) : 'transparent';
    });
  }

  // ── Detail panel ─────────────────────────────────────────────────────────────

  function renderDetail() {
    if (!selectedItem) {
      detailEl.innerHTML = `
        <div class="fp-detail-placeholder">
          <div style="font-size:3rem;margin-bottom:12px;">🍋</div>
          <p>Select an ingredient to see its flavor pairings</p>
        </div>`;
      return;
    }

    const item = selectedItem;
    const color = getCatColor(item.category);
    const prevItem = navHistory.length ? navHistory[navHistory.length - 1] : null;

    detailEl.innerHTML = `
      ${prevItem ? `
        <div class="fp-breadcrumb">
          <button class="fp-back-btn" id="fp-back-btn">← Back to ${prevItem.name}</button>
        </div>
      ` : ''}

      <div class="fp-detail-header" style="border-left-color:${color}">
        <div class="fp-detail-name">${item.name}</div>
        <div class="fp-detail-cat" style="color:${color}">${item.category}</div>
      </div>

      ${item.flavor_profile?.length ? `
        <div class="fp-section">
          <h3>Flavor Profile</h3>
          <div class="fp-flavor-tags">
            ${item.flavor_profile.map(f => `
              <span class="fp-flavor-tag"
                    style="background:${color}18; color:${color}; border-color:${color}40;">${f}</span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${item.notes ? `
        <div class="fp-section">
          <p class="fp-notes" style="border-left-color:${color}">${item.notes}</p>
        </div>
      ` : ''}

      <div class="fp-section">
        <h3>Pairs Well With</h3>
        <div class="fp-pairings-grid">
          ${item.pairings.map(pair => {
            const linked = FLAVOR_PAIRINGS.find(p =>
              p.name.toLowerCase() === pair.toLowerCase() ||
              p.id === pair.toLowerCase().replace(/\s+/g, '-')
            );
            const chipColor = linked ? getCatColor(linked.category) : '';
            return `<button
              class="fp-pairing-chip${linked ? ' has-detail' : ''}"
              data-id="${linked?.id || ''}"
              ${linked ? `style="border-color:${chipColor}; color:${chipColor};"` : ''}
            >${pair}${linked ? '<span class="fp-chip-arrow">→</span>' : ''}</button>`;
          }).join('')}
        </div>
      </div>
    `;

    // Back button
    detailEl.querySelector('#fp-back-btn')?.addEventListener('click', () => {
      selectedItem = navHistory.pop();
      updateActiveItems();
      renderDetail();
      detailEl.scrollTop = 0;
    });

    // Navigate via linked pairing chips
    detailEl.querySelectorAll('.fp-pairing-chip.has-detail').forEach(chip => {
      chip.addEventListener('click', () => {
        const next = FLAVOR_PAIRINGS.find(p => p.id === chip.dataset.id);
        if (!next) return;
        navHistory.push(item);
        selectedItem = next;
        updateActiveItems();
        renderDetail();
        detailEl.scrollTop = 0;
      });
    });
  }

  // ── Events ───────────────────────────────────────────────────────────────────

  container.querySelector('#fp-search').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderList();
  });

  container.querySelector('#fp-categories').addEventListener('click', (e) => {
    const btn = e.target.closest('.fp-cat-btn');
    if (!btn) return;
    filterCategory = btn.dataset.cat;
    container.querySelectorAll('.fp-cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderList();
  });

  renderList();
  renderDetail();
}
