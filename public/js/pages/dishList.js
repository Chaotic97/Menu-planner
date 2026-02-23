import { getDishes, deleteDish, restoreDish, duplicateDish, importRecipeFromUrl, toggleFavorite, getAllTags } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { openLightbox } from '../components/lightbox.js';
import { CATEGORIES } from '../data/categories.js';

export async function renderDishList(container) {
  // Load tags for filter
  let allTags = [];
  try { allTags = await getAllTags(); } catch {}

  container.innerHTML = `
    <div class="page-header">
      <h1>Dishes</h1>
      <div class="header-actions">
        <button id="import-url-btn" class="btn btn-secondary">Import from URL</button>
        <a href="#/dishes/new" class="btn btn-primary">+ New Dish</a>
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
          ${allTags.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}
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
          <div class="card-image">
            ${dish.photo_path
              ? `<img src="${dish.photo_path}" alt="${dish.name}" loading="lazy">`
              : '<div class="no-image"><span>No Photo</span></div>'
            }
            <button class="favorite-btn ${dish.is_favorite ? 'favorited' : ''}" data-id="${dish.id}" title="${dish.is_favorite ? 'Remove from favorites' : 'Add to favorites'}">&hearts;</button>
          </div>
          <div class="card-body">
            <span class="category-badge">${dish.category}</span>
            <h3 class="card-title">${dish.name}</h3>
            ${dish.description ? `<p class="card-desc">${dish.description.substring(0, 80)}${dish.description.length > 80 ? '...' : ''}</p>` : ''}
            ${renderAllergenBadges(dish.allergens, true)}
            ${dish.tags && dish.tags.length ? `
              <div class="tag-badges">${dish.tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>
            ` : ''}
            ${dish.suggested_price ? `<div class="card-price">$${Number(dish.suggested_price).toFixed(2)}</div>` : ''}
          </div>
          <div class="card-actions">
            <a href="#/dishes/${dish.id}/edit" class="btn btn-sm">Edit</a>
            <button class="btn btn-sm btn-secondary duplicate-dish" data-id="${dish.id}">Duplicate</button>
            <button class="btn btn-sm btn-danger delete-dish" data-id="${dish.id}">Delete</button>
          </div>
        </div>
      `).join('');

      // Click card to view/edit
      grid.querySelectorAll('.dish-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions') || e.target.closest('.favorite-btn')) return;
          window.location.hash = `#/dishes/${card.dataset.id}/edit`;
        });
      });

      // Photo lightbox
      grid.querySelectorAll('.card-image img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          openLightbox(img.src, img.alt);
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

      // Duplicate buttons
      grid.querySelectorAll('.duplicate-dish').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const result = await duplicateDish(btn.dataset.id);
            showToast('Dish duplicated');
            window.location.hash = `#/dishes/${result.id}/edit`;
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      // Delete buttons (undo delete)
      grid.querySelectorAll('.delete-dish').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const dishId = btn.dataset.id;
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
        });
      });
    } catch (err) {
      grid.innerHTML = `<div class="error">Failed to load dishes: ${err.message}</div>`;
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

  // Import from URL button
  container.querySelector('#import-url-btn').addEventListener('click', () => {
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
        statusDiv.innerHTML = `<div class="error" style="padding:12px;">${err.message}</div>`;
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
  });

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
