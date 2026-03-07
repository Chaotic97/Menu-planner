import { getIngredients, updateIngredient, updateIngredientAllergen } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { ALLERGEN_LIST, capitalize } from '../data/allergens.js';

const CATEGORIES = [
  'produce', 'protein', 'dairy', 'dry goods', 'spices',
  'oils & fats', 'sauces', 'bakery', 'frozen', 'beverages', 'other',
];

function formatCost(val) {
  if (val === null || val === undefined || val === 0) return '-';
  return `$${Number(val).toFixed(2)}`;
}

export async function renderIngredientList(container) {
  let ingredients = [];
  let searchQuery = '';
  let sortField = 'name';
  let sortDir = 'asc';

  container.innerHTML = '<div class="loading">Loading...</div>';

  async function load() {
    try {
      ingredients = await getIngredients(searchQuery || undefined, { include_usage: true });
    } catch (err) {
      container.innerHTML = `<div class="error">Failed to load ingredients: ${escapeHtml(err.message)}</div>`;
      return;
    }
    render();
  }

  function sorted(list) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let va = a[sortField];
      let vb = b[sortField];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

  function sortIcon(field) {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' &#9650;' : ' &#9660;';
  }

  function render() {
    const sortedList = sorted(ingredients);
    const totalCount = ingredients.length;

    container.innerHTML = `
      <div class="page-header">
        <h1>Ingredients</h1>
      </div>

      <div class="il-controls">
        <div class="il-search-wrap">
          <input type="search" class="input il-search" id="il-search" placeholder="Search ingredients..." value="${escapeHtml(searchQuery)}">
        </div>
        <div class="il-summary">
          ${totalCount} ingredient${totalCount !== 1 ? 's' : ''}
        </div>
      </div>

      ${sortedList.length === 0 ? `
        <div class="empty-state">
          <p>${searchQuery ? 'No ingredients match your search.' : 'No ingredients yet. Add ingredients when creating dishes.'}</p>
        </div>
      ` : `
        <div class="il-table-wrap">
          <table class="il-table">
            <thead>
              <tr>
                <th class="il-th il-th-sortable" data-sort="name">Name${sortIcon('name')}</th>
                <th class="il-th il-th-sortable il-th-cost" data-sort="unit_cost">Unit Cost${sortIcon('unit_cost')}</th>
                <th class="il-th il-th-unit">Unit</th>
                <th class="il-th il-th-sortable il-th-cat" data-sort="category">Category${sortIcon('category')}</th>
                <th class="il-th il-th-sortable il-th-usage" data-sort="dish_count">Used In${sortIcon('dish_count')}</th>
                <th class="il-th il-th-actions"></th>
              </tr>
            </thead>
            <tbody>
              ${sortedList.map(ing => `
                <tr class="il-row" data-id="${ing.id}">
                  <td class="il-td il-td-name">${escapeHtml(ing.name)}</td>
                  <td class="il-td il-td-cost">${formatCost(ing.unit_cost)}</td>
                  <td class="il-td il-td-unit">${escapeHtml(ing.base_unit || '-')}</td>
                  <td class="il-td il-td-cat">${escapeHtml(ing.category || 'other')}</td>
                  <td class="il-td il-td-usage">${ing.dish_count || 0}</td>
                  <td class="il-td il-td-actions">
                    <button class="il-edit-btn" data-id="${ing.id}" title="Edit" aria-label="Edit ${escapeHtml(ing.name)}">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    // Search
    let searchTimer = null;
    const searchInput = container.querySelector('#il-search');
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        load();
      }, 300);
    });

    // Sort
    container.querySelectorAll('.il-th-sortable').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (sortField === field) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = field;
          sortDir = 'asc';
        }
        render();
      });
    });

    // Edit
    container.querySelectorAll('.il-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const ing = ingredients.find(i => String(i.id) === String(id));
        if (ing) openEditModal(ing);
      });
    });
  }

  function openEditModal(ing) {
    const allergens = ing.allergens || [];
    const autoAllergens = allergens.filter(a => a.source === 'auto');
    const manualAllergens = allergens.filter(a => a.source === 'manual');

    const html = `
      <form id="il-edit-form" class="il-edit-form">
        <div class="st-form-group">
          <label class="st-label" for="il-edit-name">Name</label>
          <input type="text" id="il-edit-name" class="input" value="${escapeHtml(ing.name)}" required>
        </div>
        <div class="il-edit-row">
          <div class="st-form-group" style="flex:1">
            <label class="st-label" for="il-edit-cost">Unit Cost ($)</label>
            <input type="number" id="il-edit-cost" class="input" value="${ing.unit_cost || 0}" min="0" step="0.01">
          </div>
          <div class="st-form-group" style="flex:1">
            <label class="st-label" for="il-edit-unit">Base Unit</label>
            <input type="text" id="il-edit-unit" class="input" value="${escapeHtml(ing.base_unit || '')}" placeholder="g, kg, ml...">
          </div>
        </div>
        <div class="st-form-group">
          <label class="st-label" for="il-edit-cat">Category</label>
          <select id="il-edit-cat" class="input">
            ${CATEGORIES.map(c => `<option value="${c}"${(ing.category || 'other') === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
        </div>
        <div class="st-form-group">
          <label class="st-label">Allergens</label>
          ${autoAllergens.length ? `
            <div class="il-allergen-auto-label">Auto-detected:</div>
            <div class="allergen-badges" style="margin-bottom:8px">
              ${autoAllergens.map(a => `<span class="allergen-badge">${escapeHtml(capitalize(a.allergen))}</span>`).join('')}
            </div>
          ` : ''}
          <div class="il-allergen-manual-label">Manual overrides:</div>
          <div class="allergen-toggle-grid" id="il-allergen-toggles">
            ${ALLERGEN_LIST.filter(a => !autoAllergens.some(aa => aa.allergen === a)).map(a => {
              const isManual = manualAllergens.some(ma => ma.allergen === a);
              return `<button type="button" class="allergen-toggle${isManual ? ' active' : ''}" data-allergen="${a}">${capitalize(a)}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="st-form-actions">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-secondary" id="il-edit-cancel">Cancel</button>
        </div>
      </form>
    `;

    const overlay = openModal(`Edit ${ing.name}`, html);

    const form = overlay.querySelector('#il-edit-form');
    const cancelBtn = overlay.querySelector('#il-edit-cancel');

    cancelBtn.addEventListener('click', closeModal);

    // Allergen toggle handler
    const allergenGrid = overlay.querySelector('#il-allergen-toggles');
    if (allergenGrid) {
      allergenGrid.addEventListener('click', async (e) => {
        const btn = e.target.closest('.allergen-toggle');
        if (!btn) return;
        const allergen = btn.dataset.allergen;
        const isActive = btn.classList.contains('active');
        try {
          await updateIngredientAllergen(ing.id, { allergen, action: isActive ? 'remove' : 'add' });
          btn.classList.toggle('active');
          showToast(isActive ? `Removed ${allergen}` : `Added ${allergen}`);
        } catch (err) {
          showToast(err.message || 'Failed to update allergen', 'error');
        }
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = overlay.querySelector('#il-edit-name').value.trim();
      const unit_cost = parseFloat(overlay.querySelector('#il-edit-cost').value) || 0;
      const base_unit = overlay.querySelector('#il-edit-unit').value.trim();
      const category = overlay.querySelector('#il-edit-cat').value;

      if (!name) {
        showToast('Name is required', 'error');
        return;
      }

      try {
        await updateIngredient(ing.id, { name, unit_cost, base_unit, category });
        closeModal();
        showToast('Ingredient updated');
        await load();
      } catch (err) {
        showToast(err.message || 'Failed to update', 'error');
      }
    });
  }

  await load();

  // Sync listeners
  const syncEvents = ['sync:ingredient_created', 'sync:ingredient_updated'];
  const syncHandler = () => load();
  for (const evt of syncEvents) window.addEventListener(evt, syncHandler);
  const cleanup = () => {
    for (const evt of syncEvents) window.removeEventListener(evt, syncHandler);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
