import { getMenu, updateMenu, getDishes, addDishToMenu, removeDishFromMenu, updateMenuDish, getScaledShoppingList, reorderMenuDishes, getMenuKitchenPrint } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { openLightbox } from '../components/lightbox.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { ALLERGEN_LIST, CATEGORY_ORDER, capitalize } from '../data/allergens.js';

export async function renderMenuBuilder(container, menuId) {
  container.innerHTML = '<div class="loading">Loading menu...</div>';

  let menu;
  try {
    menu = await getMenu(menuId);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menu: ${err.message}</div>`;
    return;
  }

  function render() {
    // Re-derive guestAllergies from current menu state on every render
    const guestAllergies = menu.guest_allergies
      ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
      : [];

    // Group dishes by category
    const grouped = {};
    for (const dish of menu.dishes) {
      const cat = dish.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(dish);
    }

    const hasSellPrice = menu.sell_price && menu.sell_price > 0;
    const foodCostClass = menu.menu_food_cost_percent > 35
      ? 'text-danger' : menu.menu_food_cost_percent > 30
      ? 'text-warning' : 'text-success';

    container.innerHTML = `
      <div class="page-header">
        <a href="#/menus" class="btn btn-back">&larr; Back</a>
        <div class="menu-title-area">
          <div class="menu-title-row">
            <h1 id="menu-title">${escapeHtml(menu.name)}</h1>
            <button id="edit-menu-name-btn" class="btn btn-icon" title="Edit menu name">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
          ${menu.description ? `<p class="subtitle">${escapeHtml(menu.description)}</p>` : ''}
        </div>
        <div class="header-actions">
          <button id="add-dish-btn" class="btn btn-primary">+ Add Dish</button>
          <button id="kitchen-print-btn" class="btn btn-secondary">Print Kitchen Sheet</button>
          <button id="scale-btn" class="btn btn-secondary">Scale for Event</button>
          <a href="#/menus/${menuId}/todos" class="btn btn-secondary">Generate Todos</a>
        </div>
      </div>

      <!-- Menu Sell Price -->
      <div class="mb-pricing-bar">
        <div class="mb-pricing-group">
          <label for="menu-sell-price">Menu Sell Price ($)</label>
          <input type="number" id="menu-sell-price" class="input" step="0.01" min="0"
                 value="${menu.sell_price || ''}" placeholder="e.g., 120.00">
        </div>
        ${hasSellPrice ? `
          <div class="mb-pricing-stats">
            <div class="mb-pricing-stat">
              <span class="mb-pricing-label">Total Food Cost</span>
              <span class="mb-pricing-value">$${menu.total_food_cost.toFixed(2)}</span>
            </div>
            <div class="mb-pricing-stat">
              <span class="mb-pricing-label">Food Cost %</span>
              <span class="mb-pricing-value ${foodCostClass}">${menu.menu_food_cost_percent}%</span>
            </div>
            <div class="mb-pricing-stat">
              <span class="mb-pricing-label">Profit</span>
              <span class="mb-pricing-value">$${(menu.sell_price - menu.total_food_cost).toFixed(2)}</span>
            </div>
          </div>
        ` : `
          <div class="mb-pricing-hint">Set a sell price to see cost breakdown per dish</div>
        `}
      </div>

      <!-- Expected Covers & Guest Allergies -->
      <div class="mb-info-bar">
        <div class="mb-info-group">
          <label for="menu-covers">Expected Covers</label>
          <input type="number" id="menu-covers" class="input" style="max-width:120px;" min="0"
                 value="${menu.expected_covers || ''}" placeholder="0">
        </div>
        <div class="mb-info-group" style="flex:1;">
          <label>Guest Allergies &amp; Cover Counts</label>
          <div class="allergen-cover-grid" id="guest-allergy-toggles">
            ${(() => {
              let covers = {};
              try { covers = JSON.parse(menu.allergen_covers || '{}'); } catch {}
              return ALLERGEN_LIST.map(a => `
                <div class="allergen-cover-item">
                  <button type="button" class="allergen-toggle ${guestAllergies.includes(a) ? 'active' : ''}"
                          data-allergen="${a}">${capitalize(a)}</button>
                  <input type="number" class="allergen-cover-count" data-allergen="${a}" placeholder="# covers"
                         min="0" max="999" value="${covers[a] || ''}"
                         style="display:${guestAllergies.includes(a) ? 'block' : 'none'};">
                </div>
              `).join('');
            })()}
          </div>
        </div>
      </div>

      ${menu.dishes.length ? `
        <div class="mb-summary-bar">
          <span>${menu.dishes.length} dish${menu.dishes.length !== 1 ? 'es' : ''}</span>
          <span>|</span>
          <span>Total servings: ${menu.dishes.reduce((s, d) => s + d.servings, 0)}</span>
          ${menu.all_allergens.length ? `
            <span>|</span>
            <span>Allergens: ${renderAllergenBadges(menu.all_allergens, true)}</span>
          ` : ''}
        </div>

        <div class="menu-dishes" id="menu-dishes-list">
          ${CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => `
            <div class="mb-category-section">
              <h2 class="mb-category-heading">${capitalize(cat)}s</h2>
              ${grouped[cat].map(dish => {
                const hasConflict = dish.allergy_conflicts && dish.allergy_conflicts.length > 0;
                return `
                <div class="mb-dish-row ${hasConflict ? 'allergy-conflict' : ''}" data-dish-id="${dish.id}" draggable="true">
                  <div class="drag-handle" title="Drag to reorder">&#8942;&#8942;</div>
                  <div class="mb-dish-thumb">
                    ${dish.photo_path
                      ? `<img src="${escapeHtml(dish.photo_path)}" alt="${escapeHtml(dish.name)}">`
                      : '<div class="mb-no-thumb"></div>'
                    }
                  </div>
                  <div class="mb-dish-info">
                    <a href="#/dishes/${dish.id}" class="dish-name-link"><strong>${escapeHtml(dish.name)}</strong></a>
                    ${renderAllergenBadges(dish.allergens, true)}
                    ${hasConflict ? `<div class="mb-allergy-warning">&#9888; Guest allergy: ${dish.allergy_conflicts.join(', ')}</div>` : ''}
                    ${dish.substitution_count > 0 ? `<span class="subs-badge" data-dish-id="${dish.id}" title="Has allergen substitutions">&#8644; ${dish.substitution_count} sub${dish.substitution_count > 1 ? 's' : ''}</span>` : ''}
                  </div>
                  <div class="mb-cost-info">
                    ${dish.cost_per_serving > 0 ? `
                      <span class="mb-cost-value">$${dish.cost_total.toFixed(2)}</span>
                      ${hasSellPrice && dish.percent_of_menu_price !== null ? `
                        <span class="mb-cost-percent">${dish.percent_of_menu_price}% of price</span>
                      ` : ''}
                    ` : ''}
                  </div>
                  <div class="mb-servings">
                    <button class="btn btn-icon servings-dec" data-dish="${dish.id}">-</button>
                    <span class="mb-servings-count">${dish.servings}</span>
                    <button class="btn btn-icon servings-inc" data-dish="${dish.id}">+</button>
                    <span class="mb-servings-label">servings</span>
                  </div>
                  <div class="mb-row-actions">
                    <button class="btn btn-sm btn-danger remove-from-menu" data-dish="${dish.id}">Remove</button>
                  </div>
                </div>
              `}).join('')}
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <p>This menu has no dishes yet.</p>
          <button id="add-dish-empty" class="btn btn-primary">+ Add Dishes</button>
        </div>
      `}
    `;

    // Edit menu name / description
    container.querySelector('#edit-menu-name-btn').addEventListener('click', () => {
      const modal = openModal(`
        <div class="modal-header">
          <h2>Edit Menu</h2>
          <button class="modal-close">&times;</button>
        </div>
        <form id="edit-menu-form" class="form">
          <div class="form-group">
            <label for="edit-menu-name">Menu Name *</label>
            <input type="text" id="edit-menu-name" class="input" required value="${escapeHtml(menu.name)}">
          </div>
          <div class="form-group">
            <label for="edit-menu-desc">Description</label>
            <textarea id="edit-menu-desc" class="input" rows="2">${escapeHtml(menu.description || '')}</textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      `);

      modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));

      modal.querySelector('#edit-menu-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = modal.querySelector('#edit-menu-name').value.trim();
        if (!name) return;
        const description = modal.querySelector('#edit-menu-desc').value.trim();
        try {
          await updateMenu(menuId, { name, description });
          menu.name = name;
          menu.description = description;
          closeModal(modal);
          showToast('Menu updated');
          render();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Wire up sell price input
    const priceInput = container.querySelector('#menu-sell-price');
    let priceDebounce;
    priceInput.addEventListener('input', () => {
      clearTimeout(priceDebounce);
      priceDebounce = setTimeout(async () => {
        const newPrice = parseFloat(priceInput.value) || 0;
        try {
          await updateMenu(menuId, { sell_price: newPrice });
          menu.sell_price = newPrice;
          if (newPrice > 0) {
            menu.menu_food_cost_percent = Math.round((menu.total_food_cost / newPrice) * 10000) / 100;
            for (const dish of menu.dishes) {
              dish.percent_of_menu_price = Math.round((dish.cost_total / newPrice) * 10000) / 100;
            }
          }
          render();
          showToast('Price updated');
        } catch (err) {
          showToast('Failed to update price', 'error');
        }
      }, 800);
    });

    // Wire up expected covers
    const coversInput = container.querySelector('#menu-covers');
    let coversDebounce;
    coversInput.addEventListener('input', () => {
      clearTimeout(coversDebounce);
      coversDebounce = setTimeout(async () => {
        const covers = parseInt(coversInput.value) || 0;
        try {
          await updateMenu(menuId, { expected_covers: covers });
          menu.expected_covers = covers;
          showToast('Covers updated');
        } catch (err) {
          showToast('Failed to update', 'error');
        }
      }, 800);
    });

    // Wire up guest allergy toggles
    container.querySelectorAll('.allergen-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.classList.toggle('active');
        const countInput = btn.closest('.allergen-cover-item').querySelector('.allergen-cover-count');
        if (countInput) {
          countInput.style.display = btn.classList.contains('active') ? 'block' : 'none';
          if (!btn.classList.contains('active')) countInput.value = '';
        }
        await saveAllergyState();
      });
    });

    // Wire up allergen cover count changes
    container.querySelectorAll('.allergen-cover-count').forEach(input => {
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(saveAllergyState, 600);
      });
    });

    async function saveAllergyState() {
      const activeAllergens = [];
      const allergenCovers = {};
      container.querySelectorAll('.allergen-toggle.active').forEach(b => {
        const allergen = b.dataset.allergen;
        activeAllergens.push(allergen);
        const countInput = b.closest('.allergen-cover-item').querySelector('.allergen-cover-count');
        if (countInput && countInput.value) {
          allergenCovers[allergen] = parseInt(countInput.value) || 0;
        }
      });
      const newVal = activeAllergens.join(',');
      try {
        await updateMenu(menuId, { guest_allergies: newVal, allergen_covers: JSON.stringify(allergenCovers) });
        menu.guest_allergies = newVal;
        menu.allergen_covers = JSON.stringify(allergenCovers);
        // Refresh to update conflict highlighting
        menu = await getMenu(menuId);
        render();
        showToast('Guest allergies updated');
      } catch (err) {
        showToast('Failed to update', 'error');
      }
    }

    // Wire up events
    container.querySelector('#add-dish-btn')?.addEventListener('click', showDishPicker);
    container.querySelector('#add-dish-empty')?.addEventListener('click', showDishPicker);
    container.querySelector('#scale-btn')?.addEventListener('click', showScaleModal);
    container.querySelector('#kitchen-print-btn')?.addEventListener('click', showKitchenPrint);

    // Photo lightbox
    container.querySelectorAll('.mb-dish-thumb img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(img.src, img.alt);
      });
    });

    // Servings controls
    container.querySelectorAll('.servings-inc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => d.id == dishId);
        if (dish) {
          dish.servings++;
          await updateMenuDish(menuId, dishId, { servings: dish.servings });
          menu = await getMenu(menuId);
          render();
        }
      });
    });

    container.querySelectorAll('.servings-dec').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => d.id == dishId);
        if (dish && dish.servings > 1) {
          dish.servings--;
          await updateMenuDish(menuId, dishId, { servings: dish.servings });
          menu = await getMenu(menuId);
          render();
        }
      });
    });

    // Remove dish
    container.querySelectorAll('.remove-from-menu').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        try {
          await removeDishFromMenu(menuId, dishId);
          menu = await getMenu(menuId);
          showToast('Dish removed');
          render();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Drag and drop reorder
    setupDragDrop();
  }

  // ---- Drag and Drop ----
  function setupDragDrop() {
    const dishRows = container.querySelectorAll('.mb-dish-row[draggable]');
    let draggedId = null;

    dishRows.forEach(row => {
      row.addEventListener('dragstart', (e) => {
        draggedId = row.dataset.dishId;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedId);
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (row.dataset.dishId !== draggedId) {
          container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
          row.classList.add('drag-over');
        }
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const targetId = row.dataset.dishId;
        if (draggedId === targetId) return;

        // Reorder dishes array
        const fromIndex = menu.dishes.findIndex(d => d.id == draggedId);
        const toIndex = menu.dishes.findIndex(d => d.id == targetId);
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = menu.dishes.splice(fromIndex, 1);
        menu.dishes.splice(toIndex, 0, moved);

        // Update sort_order and send to server
        const order = menu.dishes.map((d, i) => ({ dish_id: d.id, sort_order: i }));
        try {
          await reorderMenuDishes(menuId, order);
          render();
        } catch (err) {
          showToast('Failed to reorder', 'error');
        }
      });
    });

    // Touch support for drag handles
    let touchDragId = null;
    let touchStartY = 0;

    dishRows.forEach(row => {
      const handle = row.querySelector('.drag-handle');
      if (!handle) return;

      handle.addEventListener('touchstart', (e) => {
        touchDragId = row.dataset.dishId;
        touchStartY = e.touches[0].clientY;
        row.classList.add('dragging');
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        e.preventDefault();
      }, { passive: false });

      handle.addEventListener('touchend', async (e) => {
        row.classList.remove('dragging');
        if (!touchDragId) return;

        const touchEndY = e.changedTouches[0].clientY;
        const diff = touchEndY - touchStartY;
        const fromIndex = menu.dishes.findIndex(d => d.id == touchDragId);

        let toIndex = fromIndex;
        if (diff > 40 && fromIndex < menu.dishes.length - 1) toIndex = fromIndex + 1;
        else if (diff < -40 && fromIndex > 0) toIndex = fromIndex - 1;

        if (toIndex !== fromIndex) {
          const [moved] = menu.dishes.splice(fromIndex, 1);
          menu.dishes.splice(toIndex, 0, moved);
          const order = menu.dishes.map((d, i) => ({ dish_id: d.id, sort_order: i }));
          try {
            await reorderMenuDishes(menuId, order);
            render();
          } catch (err) {
            showToast('Failed to reorder', 'error');
          }
        }
        touchDragId = null;
      });
    });
  }

  // ---- Scale Modal ----
  async function showScaleModal() {
    const defaultCovers = menu.expected_covers || menu.dishes.reduce((s, d) => s + d.servings, 0);
    const totalServings = menu.dishes.reduce((s, d) => s + d.servings, 0);

    const modal = openModal('Scale for Event', `
      <div class="form-group">
        <label for="scale-covers">Number of Covers</label>
        <input type="number" id="scale-covers" class="input" min="1" value="${defaultCovers}" placeholder="e.g., 50">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          Current menu base: ${totalServings} servings. Enter total covers needed.
        </p>
      </div>
      <button id="scale-calculate-btn" class="btn btn-primary" style="width:100%;margin-bottom:16px;">Calculate Scaled List</button>
      <div id="scaled-result"></div>
    `);

    const coversInput = modal.querySelector('#scale-covers');
    const calcBtn = modal.querySelector('#scale-calculate-btn');
    const resultDiv = modal.querySelector('#scaled-result');

    calcBtn.addEventListener('click', async () => {
      const covers = parseInt(coversInput.value);
      if (!covers || covers < 1) {
        showToast('Enter a valid cover count', 'error');
        return;
      }

      resultDiv.innerHTML = '<div class="loading" style="padding:12px;">Calculating...</div>';

      try {
        const data = await getScaledShoppingList(menuId, covers);

        let html = `
          <div class="shopping-summary" style="margin-bottom:16px;">
            <strong>Scaled for ${data.covers} covers</strong>
            (${data.scale_factor}x from ${data.base_covers} base servings)<br>
            <strong>Estimated Total: $${data.total_estimated_cost.toFixed(2)}</strong>
          </div>
        `;

        for (const group of data.groups) {
          html += `<div class="todo-group">
            <h3 class="todo-group-title">${capitalize(group.category)}</h3>`;
          for (const item of group.items) {
            html += `<div class="todo-item" style="cursor:default;">
              <span class="todo-text">
                <strong>${escapeHtml(item.ingredient)}</strong>
                <span class="todo-qty">${item.total_quantity} ${item.unit}</span>
                ${item.estimated_cost !== null ? `<span class="todo-cost">$${item.estimated_cost.toFixed(2)}</span>` : ''}
              </span>
            </div>`;
          }
          html += '</div>';
        }

        html += '<button id="scale-print-btn" class="btn btn-secondary" style="width:100%;margin-top:16px;">Print Scaled List</button>';

        resultDiv.innerHTML = html;

        modal.querySelector('#scale-print-btn').addEventListener('click', () => {
          const printWin = window.open('', '_blank');
          printWin.document.write(`
            <html><head><title>Scaled Shopping List - ${escapeHtml(data.menu_name)}</title>
            <style>
              body { font-family: -apple-system, sans-serif; padding: 20px; }
              h1 { font-size: 1.4rem; margin-bottom: 4px; }
              h3 { margin-top: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
              .item { padding: 4px 0; display: flex; justify-content: space-between; }
              .summary { margin: 12px 0; padding: 8px; background: #f5f5f0; }
            </style></head><body>
            <h1>Scaled Shopping List: ${escapeHtml(data.menu_name)}</h1>
            <div class="summary">
              <strong>${data.covers} covers</strong> (${data.scale_factor}x scale) |
              Estimated Total: <strong>$${data.total_estimated_cost.toFixed(2)}</strong>
            </div>
            ${data.groups.map(g => `
              <h3>${capitalize(g.category)}</h3>
              ${g.items.map(i => `
                <div class="item">
                  <span>${escapeHtml(i.ingredient)} &mdash; ${i.total_quantity} ${i.unit}</span>
                  <span>${i.estimated_cost !== null ? '$' + i.estimated_cost.toFixed(2) : ''}</span>
                </div>
              `).join('')}
            `).join('')}
            </body></html>
          `);
          printWin.document.close();
          printWin.print();
        });

      } catch (err) {
        resultDiv.innerHTML = `<div class="error" style="padding:12px;">${err.message}</div>`;
      }
    });
  }

  // ---- Kitchen Print ----
  async function showKitchenPrint() {
    try {
      const data = await getMenuKitchenPrint(menuId);
      const printWin = window.open('', '_blank');

      let html = `
        <html><head><title>Service Sheet - ${escapeHtml(data.menu.name)}</title>
        <style>
          body { font-family: -apple-system, sans-serif; padding: 20px; color: #1a1a1a; }
          h1 { font-size: 1.6rem; margin-bottom: 4px; border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; }
          .meta { font-size: 0.9rem; color: #555; margin: 8px 0 20px; }
          .meta .alert { color: #d32f2f; font-weight: 700; }
          .dish-block { margin: 0 0 20px; padding-bottom: 20px; border-bottom: 1px solid #ddd; page-break-inside: avoid; display: grid; grid-template-columns: 120px 1fr; gap: 0 16px; }
          .course-num { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding-top: 3px; }
          .course-cat { font-size: 0.7rem; color: #aaa; margin-top: 2px; text-transform: capitalize; }
          .dish-name { font-size: 1.15rem; font-weight: 700; margin-bottom: 6px; }
          .allergens { margin-bottom: 6px; }
          .allergen-tag { display: inline-block; padding: 2px 8px; font-size: 0.72rem; font-weight: 700; background: #ffcdd2; color: #b71c1c; border-radius: 10px; margin-right: 3px; margin-bottom: 3px; }
          .ingredients { margin: 4px 0 8px; padding-left: 0; list-style: none; }
          .ingredients li { font-size: 0.9rem; font-weight: 600; color: #1a1a1a; padding: 2px 0; border-bottom: 1px solid #f0f0f0; }
          .notes { font-size: 0.85rem; color: #333; margin-top: 6px; padding: 6px 10px; background: #f5f5f0; border-left: 3px solid #999; }
          .notes-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 2px; }
          .subs { font-size: 0.82rem; margin-top: 6px; padding: 5px 10px; background: #fff3e0; border-left: 3px solid #e65100; }
          .subs strong { color: #e65100; }
          @media print { body { padding: 0; } }
        </style></head><body>
        <h1>${escapeHtml(data.menu.name)}</h1>
        <div class="meta">
          Printed: ${new Date().toLocaleDateString()}
          ${data.expected_covers ? ` &nbsp;·&nbsp; <strong>Covers: ${data.expected_covers}</strong>` : ''}
          ${data.guest_allergies.length ? ` &nbsp;·&nbsp; <span class="alert">&#9888; Guest Allergies: ${data.guest_allergies.join(', ').toUpperCase()}</span>` : ''}
        </div>
      `;

      data.dishes.forEach((dish, i) => {
        html += `<div class="dish-block">`;
        html += `<div><div class="course-num">Course ${i + 1}</div><div class="course-cat">${escapeHtml(dish.category || '')}</div></div>`;
        html += `<div>`;
        html += `<div class="dish-name">${escapeHtml(dish.name)}</div>`;

        if (dish.allergens.length) {
          html += `<div class="allergens">${dish.allergens.map(a => `<span class="allergen-tag">${escapeHtml(a)}</span>`).join('')}</div>`;
        }

        if (dish.components && dish.components.length) {
          html += `<ul class="ingredients">${dish.components.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul>`;
        } else {
          html += `<p style="font-size:0.85rem;color:#888;margin:4px 0 8px;font-style:italic;">No service components added.</p>`;
        }

        if (dish.substitutions && dish.substitutions.length) {
          html += `<div class="subs"><strong>Subs:</strong> `;
          html += dish.substitutions.map(s =>
            `${escapeHtml(s.allergen)}: ${escapeHtml(s.original_ingredient)} &rarr; ${escapeHtml(s.substitute_ingredient)}${s.notes ? ' (' + escapeHtml(s.notes) + ')' : ''}`
          ).join('; ');
          html += `</div>`;
        }

        if (dish.service_notes) {
          html += `<div class="notes"><div class="notes-label">Service Notes</div>${escapeHtml(dish.service_notes)}</div>`;
        }

        html += `</div></div>`;
      });

      html += `</body></html>`;
      printWin.document.write(html);
      printWin.document.close();
      printWin.print();
    } catch (err) {
      showToast('Failed to generate service sheet: ' + err.message, 'error');
    }
  }

  // ---- Dish Picker ----
  async function showDishPicker() {
    let allDishes;
    try {
      allDishes = await getDishes();
    } catch (err) {
      showToast('Failed to load dishes', 'error');
      return;
    }

    const existingIds = new Set(menu.dishes.map(d => d.id));
    const available = allDishes.filter(d => !existingIds.has(d.id));

    if (!available.length) {
      showToast('All dishes are already in this menu', 'info');
      return;
    }

    const modal = openModal('Add Dishes', `
      <input type="text" id="dish-picker-search" class="input" placeholder="Search dishes...">
      <div class="mb-picker-list" id="mb-picker-list">
        ${available.map(d => `
          <div class="mb-picker-item" data-id="${d.id}">
            <div class="mb-picker-info">
              <strong>${escapeHtml(d.name)}</strong>
              <span class="category-badge">${escapeHtml(d.category)}</span>
              ${renderAllergenBadges(d.allergens, true)}
            </div>
            <button class="btn btn-sm btn-primary add-to-menu-btn" data-id="${d.id}">Add</button>
          </div>
        `).join('')}
      </div>
    `);

    const searchInput = modal.querySelector('#dish-picker-search');
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      modal.querySelectorAll('.mb-picker-item').forEach(item => {
        const name = item.querySelector('strong').textContent.toLowerCase();
        item.style.display = name.includes(query) ? '' : 'none';
      });
    });

    modal.querySelectorAll('.add-to-menu-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.id;
        try {
          await addDishToMenu(menuId, { dish_id: parseInt(dishId), servings: 1 });
          btn.textContent = 'Added';
          btn.disabled = true;
          btn.classList.remove('btn-primary');
          menu = await getMenu(menuId);
          showToast('Dish added');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    const origClose = modal.querySelector('.modal-close');
    origClose.addEventListener('click', () => render(), { once: true });
  }

  // Real-time sync listeners
  const onMenuUpdate = async (e) => {
    if (e.detail && e.detail.id == menuId) {
      try {
        menu = await getMenu(menuId);
        render();
      } catch {}
    }
  };
  window.addEventListener('sync:menu_updated', onMenuUpdate);
  window.addEventListener('hashchange', () => {
    window.removeEventListener('sync:menu_updated', onMenuUpdate);
  }, { once: true });

  render();
}
