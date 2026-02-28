import { getDishes, deleteDish, restoreDish, duplicateDish, importRecipeFromUrl, importRecipeFromDocx, bulkImportDocx, toggleFavorite, getAllTags } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { CATEGORIES } from '../data/categories.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export async function renderDishList(container) {
  // Load tags for filter
  let allTags = [];
  try { allTags = await getAllTags(); } catch {}

  container.innerHTML = `
    <div class="page-header">
      <h1>Dishes</h1>
      <div class="header-actions">
        <a href="#/dishes/new" class="btn btn-primary">+ New Dish</a>
        <span id="dish-list-overflow"></span>
      </div>
    </div>
    <div class="filter-bar">
      <input type="text" id="dish-search" placeholder="Search dishes..." class="input">
      <select id="dish-category-filter" class="input">
        <option value="">All Categories</option>
        ${CATEGORIES.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
      </select>
      ${allTags.length ? `
        <select id="dish-tag-filter" class="input" style="flex:0 0 140px;">
          <option value="">All Tags</option>
          ${allTags.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('')}
        </select>
      ` : ''}
      <button id="fav-filter-btn" class="filter-favorites-btn" title="Show favorites only">&hearts; Favorites</button>
    </div>
    <div id="dish-grid" class="card-grid">
      <div class="loading">Loading dishes...</div>
    </div>
  `;

  const grid = container.querySelector('#dish-grid');
  const searchInput = container.querySelector('#dish-search');
  const categoryFilter = container.querySelector('#dish-category-filter');
  const tagFilter = container.querySelector('#dish-tag-filter');
  const favBtn = container.querySelector('#fav-filter-btn');
  let showFavorites = false;

  let debounceTimer;

  async function loadDishes() {
    const params = {};
    const search = searchInput.value.trim();
    const category = categoryFilter.value;
    if (search) params.search = search;
    if (category) params.category = category;
    if (showFavorites) params.favorite = '1';
    if (tagFilter && tagFilter.value) params.tag = tagFilter.value;

    try {
      const dishes = await getDishes(params);
      if (!dishes.length) {
        grid.innerHTML = '<div class="empty-state"><p>No dishes found.</p><a href="#/dishes/new" class="btn btn-primary">Create your first dish</a></div>';
        return;
      }

      grid.innerHTML = dishes.map(dish => `
        <div class="card dish-card" data-id="${dish.id}">
          <div class="card-body">
            <div class="card-body-top">
              <span class="category-badge">${escapeHtml(dish.category)}</span>
              <button class="favorite-btn ${dish.is_favorite ? 'favorited' : ''}" data-id="${dish.id}" title="${dish.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">&hearts;</button>
            </div>
            <h3 class="card-title">${escapeHtml(dish.name)}</h3>
            ${dish.description ? `<p class="card-desc">${escapeHtml(dish.description.substring(0, 80))}${dish.description.length > 80 ? '...' : ''}</p>` : ''}
            ${renderAllergenBadges(dish.allergens, true)}
            ${dish.tags && dish.tags.length ? `
              <div class="tag-badges">${dish.tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>
            ` : ''}
            ${dish.suggested_price ? `<div class="card-price">$${Number(dish.suggested_price).toFixed(2)}</div>` : ''}
          </div>
          <div class="card-actions">
            <span class="card-overflow" data-id="${dish.id}"></span>
          </div>
        </div>
      `).join('');

      // Click card to view/edit
      grid.querySelectorAll('.dish-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions') || e.target.closest('.favorite-btn')) return;
          window.location.hash = `#/dishes/${card.dataset.id}`;
        });
      });

      // Favorite toggle
      grid.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const result = await toggleFavorite(btn.dataset.id);
            btn.classList.toggle('favorited', !!result.is_favorite);
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      // Card overflow action menus (Duplicate, Delete)
      grid.querySelectorAll('.card-overflow').forEach(slot => {
        const dishId = slot.dataset.id;
        const menuTrigger = createActionMenu([
          { label: 'Edit', icon: '✏️', onClick: () => { window.location.hash = `#/dishes/${dishId}/edit`; } },
          { label: 'Duplicate', icon: '⧉', onClick: async () => {
            try {
              const result = await duplicateDish(dishId);
              showToast('Dish duplicated');
              window.location.hash = `#/dishes/${result.id}`;
            } catch (err) {
              showToast(err.message, 'error');
            }
          }},
          { label: 'Delete', icon: '✕', danger: true, onClick: async () => {
            try {
              await deleteDish(dishId);
              loadDishes();
              showToast('Dish deleted', 'info', 8000, {
                label: 'Undo',
                onClick: async () => {
                  try {
                    await restoreDish(dishId);
                    showToast('Dish restored');
                    loadDishes();
                  } catch (err) {
                    showToast('Failed to restore', 'error');
                  }
                }
              });
            } catch (err) {
              showToast(err.message, 'error');
            }
          }},
        ]);
        slot.appendChild(menuTrigger);
      });
    } catch (err) {
      grid.innerHTML = `<div class="error">Failed to load dishes: ${escapeHtml(err.message)}</div>`;
    }
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadDishes, 300);
  });
  categoryFilter.addEventListener('change', loadDishes);
  if (tagFilter) tagFilter.addEventListener('change', loadDishes);

  // Favorites filter toggle
  favBtn.addEventListener('click', () => {
    showFavorites = !showFavorites;
    favBtn.classList.toggle('active', showFavorites);
    loadDishes();
  });

  // Import overflow menu
  const importSlot = container.querySelector('#dish-list-overflow');
  if (importSlot) {
    const importMenu = createActionMenu([
      { label: 'Import from URL', icon: '🔗', onClick: showImportUrlModal },
      { label: 'Import .docx', icon: '📄', onClick: showImportDocxModal },
      { label: 'Bulk Import .docx', icon: '📦', onClick: showBulkImportDocxModal },
    ]);
    importSlot.appendChild(importMenu);
  }

  function showImportUrlModal() {
    const modal = openModal('Import Recipe from URL', `
      <div class="form-group">
        <label for="import-url-input">Recipe URL</label>
        <input type="url" id="import-url-input" class="input" placeholder="https://www.example.com/recipe/...">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          Paste a URL from a recipe website. Works best with sites that use structured recipe data.
        </p>
      </div>
      <div id="import-status"></div>
      <button id="import-submit-btn" class="btn btn-primary" style="width:100%;">Import Recipe</button>
    `);

    const urlInput = modal.querySelector('#import-url-input');
    const submitBtn = modal.querySelector('#import-submit-btn');
    const statusDiv = modal.querySelector('#import-status');

    submitBtn.addEventListener('click', async () => {
      const url = urlInput.value.trim();
      if (!url) {
        showToast('Enter a URL', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing...';
      statusDiv.innerHTML = '<div class="loading" style="padding:12px;">Fetching and parsing recipe...</div>';

      try {
        const recipe = await importRecipeFromUrl(url);
        sessionStorage.setItem('importedRecipe', JSON.stringify(recipe));
        closeModal(modal);
        showToast('Recipe imported! Review and save below.');
        window.location.hash = '#/dishes/new';
      } catch (err) {
        statusDiv.innerHTML = `<div class="error" style="padding:12px;">${escapeHtml(err.message)}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import Recipe';
      }
    });

    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      }
    });
  }

  function showImportDocxModal() {
    const modal = openModal('Import Recipe from .docx', `
      <div class="form-group">
        <label for="import-docx-input">Meez Recipe Export (.docx)</label>
        <input type="file" id="import-docx-input" class="input" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          Upload a .docx recipe export from Meez. The file will be parsed and pre-filled into the dish form.
        </p>
      </div>
      <div id="import-docx-status"></div>
      <button id="import-docx-submit" class="btn btn-primary" style="width:100%;">Import Recipe</button>
    `);

    const fileInput = modal.querySelector('#import-docx-input');
    const submitBtn = modal.querySelector('#import-docx-submit');
    const statusDiv = modal.querySelector('#import-docx-status');

    submitBtn.addEventListener('click', async () => {
      const file = fileInput.files[0];
      if (!file) {
        showToast('Select a .docx file', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing...';
      statusDiv.innerHTML = '<div class="loading" style="padding:12px;">Parsing recipe...</div>';

      try {
        const formData = new FormData();
        formData.append('file', file);
        const recipe = await importRecipeFromDocx(formData);
        sessionStorage.setItem('importedRecipe', JSON.stringify(recipe));
        closeModal(modal);
        showToast('Recipe imported! Review and save below.');
        window.location.hash = '#/dishes/new';
      } catch (err) {
        statusDiv.innerHTML = `<div class="error" style="padding:12px;">${escapeHtml(err.message)}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import Recipe';
      }
    });
  }

  function showBulkImportDocxModal() {
    const modal = openModal('Bulk Import Dishes from .docx', `
      <div class="form-group">
        <label for="bulk-import-docx-input">Select .docx files (Meez exports)</label>
        <input type="file" id="bulk-import-docx-input" class="input" multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          Select one or more .docx recipe files. Each file will be imported as a separate dish.
        </p>
      </div>
      <div id="bulk-import-file-list" style="margin-bottom:12px;"></div>
      <div id="bulk-import-status"></div>
      <button id="bulk-import-submit" class="btn btn-primary" style="width:100%;">Import All</button>
    `);

    const fileInput = modal.querySelector('#bulk-import-docx-input');
    const fileListDiv = modal.querySelector('#bulk-import-file-list');
    const submitBtn = modal.querySelector('#bulk-import-submit');
    const statusDiv = modal.querySelector('#bulk-import-status');

    fileInput.addEventListener('change', () => {
      const files = fileInput.files;
      if (!files.length) {
        fileListDiv.innerHTML = '';
        return;
      }
      fileListDiv.innerHTML = `
        <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:4px;">${files.length} file${files.length === 1 ? '' : 's'} selected:</div>
        <ul style="margin:0;padding-left:20px;font-size:0.85rem;">
          ${Array.from(files).map(f => `<li>${escapeHtml(f.name)}</li>`).join('')}
        </ul>
      `;
    });

    submitBtn.addEventListener('click', async () => {
      const files = fileInput.files;
      if (!files.length) {
        showToast('Select at least one .docx file', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing...';
      statusDiv.innerHTML = `<div class="loading" style="padding:12px;">Importing ${files.length} file${files.length === 1 ? '' : 's'}...</div>`;

      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append('files', file);
        }
        const result = await bulkImportDocx(formData);

        let html = '';
        if (result.created.length) {
          html += `<div style="padding:8px 12px;background:rgba(var(--success-rgb),0.1);border-radius:var(--radius-sm);margin-bottom:8px;font-size:0.9rem;">
            <strong>${result.created.length} dish${result.created.length === 1 ? '' : 'es'} imported successfully</strong>
            <ul style="margin:4px 0 0;padding-left:20px;">
              ${result.created.map(d => `<li>${escapeHtml(d.name)}</li>`).join('')}
            </ul>
          </div>`;
        }
        if (result.errors.length) {
          html += `<div style="padding:8px 12px;background:rgba(var(--danger-rgb),0.1);border-radius:var(--radius-sm);margin-bottom:8px;font-size:0.9rem;">
            <strong>${result.errors.length} file${result.errors.length === 1 ? '' : 's'} failed</strong>
            <ul style="margin:4px 0 0;padding-left:20px;">
              ${result.errors.map(e => `<li>${escapeHtml(e.filename)}: ${escapeHtml(e.error)}</li>`).join('')}
            </ul>
          </div>`;
        }

        statusDiv.innerHTML = html;
        submitBtn.textContent = 'Done';

        if (result.created.length) {
          loadDishes();
          showToast(`${result.created.length} dish${result.created.length === 1 ? '' : 'es'} imported`);
        }
      } catch (err) {
        statusDiv.innerHTML = `<div class="error" style="padding:12px;">${escapeHtml(err.message)}</div>`;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import All';
      }
    });
  }

  // Real-time sync listeners
  const onDishChange = () => loadDishes();
  window.addEventListener('sync:dish_created', onDishChange);
  window.addEventListener('sync:dish_updated', onDishChange);
  window.addEventListener('sync:dish_deleted', onDishChange);

  const cleanup = () => {
    window.removeEventListener('sync:dish_created', onDishChange);
    window.removeEventListener('sync:dish_updated', onDishChange);
    window.removeEventListener('sync:dish_deleted', onDishChange);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  loadDishes();
}
