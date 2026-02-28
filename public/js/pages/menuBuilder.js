import { getMenu, updateMenu, getDishes, addDishToMenu, removeDishFromMenu, updateMenuDish, getScaledShoppingList, reorderMenuDishes, getMenuKitchenPrint, generateTasks } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { makeCollapsible, collapsibleHeader } from '../components/collapsible.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { ALLERGEN_LIST, CATEGORY_ORDER, capitalize } from '../data/allergens.js';
import { printSheet } from '../utils/printSheet.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function getNextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(mondayStr) {
  const mon = new Date(mondayStr + 'T12:00:00Z');
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(mon)} – ${fmt(sun)}`;
}

export async function renderMenuBuilder(container, menuId) {
  container.innerHTML = '<div class="loading">Loading menu...</div>';

  let menu;
  try {
    menu = await getMenu(menuId);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menu: ${escapeHtml(err.message)}</div>`;
    return;
  }

  function render() {
    // Re-derive guestAllergies from current menu state on every render
    const guestAllergies = menu.guest_allergies
      ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
      : [];

    // Parse schedule_days from menu
    let scheduleDays = [];
    try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch {}

    // Group dishes by category
    const grouped = {};
    for (const dish of menu.dishes) {
      const cat = dish.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(dish);
    }

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
          <span id="mb-overflow-menu"></span>
        </div>
      </div>

      <!-- Weekly Schedule -->
      <div class="mb-schedule-bar">
        <div class="mb-schedule-days">
          <label class="mb-schedule-label">Service Days</label>
          <div class="mb-day-toggles" id="schedule-day-toggles">
            ${DAY_NAMES.map((name, i) => {
              const active = scheduleDays.includes(i);
              return `<button type="button" class="mb-day-btn ${active ? 'active' : ''}" data-day="${i}">${escapeHtml(name)}</button>`;
            }).join('')}
          </div>
        </div>
        ${scheduleDays.length ? `
          <div class="mb-schedule-actions">
            <button id="prepare-week-btn" class="btn btn-primary">Prepare Week</button>
          </div>
        ` : `
          <div class="mb-schedule-hint">Select the days this menu runs to enable weekly prep task generation</div>
        `}
      </div>

      <!-- Guest Allergies (collapsible) -->
      <div class="collapsible-section" id="mb-allergy-section">
        ${collapsibleHeader('Guest Allergies', guestAllergies.length
          ? guestAllergies.length + ' allerg' + (guestAllergies.length > 1 ? 'ies' : 'y')
          : '')}
        <div class="collapsible-section__body">
          <div class="mb-info-bar">
            <div class="mb-info-group" style="flex:1;">
              <label>Guest Allergies</label>
              <div class="allergen-cover-grid" id="guest-allergy-toggles">
                ${ALLERGEN_LIST.map(a => `
                  <div class="allergen-cover-item">
                    <button type="button" class="allergen-toggle ${guestAllergies.includes(a) ? 'active' : ''}"
                            data-allergen="${a}">${capitalize(a)}</button>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
      </div>

      ${menu.dishes.length ? `
        ${(() => {
          const totalBatches = menu.dishes.reduce((s, d) => s + d.servings, 0);
          const totalPortions = menu.dishes.reduce((s, d) => s + (d.total_portions || d.servings), 0);
          const hasMultiPortion = menu.dishes.some(d => (d.batch_yield || 1) > 1);
          return `<div class="mb-summary-bar">
            <span>${menu.dishes.length} dish${menu.dishes.length !== 1 ? 'es' : ''}</span>
            <span>|</span>
            <span>Total batches: ${totalBatches}${hasMultiPortion ? ` (${totalPortions} portions)` : ''}</span>
            ${menu.all_allergens.length ? `
              <span>|</span>
              <span>Allergens: ${renderAllergenBadges(menu.all_allergens, true)}</span>
            ` : ''}
          </div>`;
        })()}

        <div class="menu-dishes" id="menu-dishes-list">
          ${CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => `
            <div class="mb-category-section">
              <h2 class="mb-category-heading">${capitalize(cat)}s</h2>
              ${grouped[cat].map(dish => {
                const hasConflict = dish.allergy_conflicts && dish.allergy_conflicts.length > 0;
                let dishActiveDays = null;
                try { dishActiveDays = dish.active_days ? JSON.parse(dish.active_days) : null; } catch {}
                return `
                <div class="mb-dish-row ${hasConflict ? 'allergy-conflict' : ''}" data-dish-id="${dish.id}" draggable="true">
                  <div class="drag-handle" title="Drag to reorder">&#8942;&#8942;</div>
                  <div class="mb-dish-info">
                    <a href="#/dishes/${dish.id}" class="dish-name-link"><strong>${escapeHtml(dish.name)}</strong></a>
                    ${renderAllergenBadges(dish.allergens, true)}
                    ${hasConflict ? `<div class="mb-allergy-warning">&#9888; Guest allergy: ${dish.allergy_conflicts.join(', ')}</div>` : ''}
                    ${dish.substitution_count > 0 ? `<span class="subs-badge" data-dish-id="${dish.id}" title="Has allergen substitutions">&#8644; ${dish.substitution_count} sub${dish.substitution_count > 1 ? 's' : ''}</span>` : ''}
                    ${scheduleDays.length ? `
                      <div class="mb-dish-days" data-dish-id="${dish.id}">
                        ${scheduleDays.map(d => {
                          const isActive = dishActiveDays === null || dishActiveDays.includes(d);
                          return `<button type="button" class="mb-dish-day-btn ${isActive ? 'active' : ''}" data-day="${d}" data-dish="${dish.id}">${escapeHtml(DAY_LETTERS[d])}</button>`;
                        }).join('')}
                      </div>
                    ` : ''}
                  </div>
                  <div class="mb-cost-info">
                    ${dish.cost_per_serving > 0 ? `
                      <span class="mb-cost-value">$${dish.cost_total.toFixed(2)}</span>
                      ${(dish.batch_yield || 1) > 1 ? `
                        <span class="mb-cost-detail">$${dish.cost_per_portion.toFixed(2)}/portion</span>
                      ` : ''}
                    ` : ''}
                  </div>
                  <div class="mb-servings">
                    <button class="btn btn-icon servings-dec" data-dish="${dish.id}">-</button>
                    <span class="mb-servings-count">${dish.servings}</span>
                    <button class="btn btn-icon servings-inc" data-dish="${dish.id}">+</button>
                    <span class="mb-servings-label">${(dish.batch_yield || 1) > 1 ? 'batches' : 'servings'}</span>
                    ${(dish.batch_yield || 1) > 1 ? `
                      <span class="mb-portions-label">(${dish.total_portions} portions)</span>
                      <input type="number" class="input mb-portion-target" data-dish="${dish.id}" data-yield="${dish.batch_yield}"
                             min="1" step="1" placeholder="target" title="Enter target portions to auto-calculate batches"
                             style="width:70px;padding:2px 6px;font-size:0.8rem;margin-left:4px;">
                    ` : ''}
                  </div>
                  <div class="mb-row-actions" data-dish-id="${dish.id}"></div>
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
      const modal = openModal('Edit Menu', `
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

    // Wire up schedule day toggles
    container.querySelectorAll('#schedule-day-toggles .mb-day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.classList.toggle('active');
        const newDays = [];
        container.querySelectorAll('#schedule-day-toggles .mb-day-btn.active').forEach(b => {
          newDays.push(parseInt(b.dataset.day));
        });
        try {
          await updateMenu(menuId, { schedule_days: newDays });
          menu.schedule_days = JSON.stringify(newDays);
          menu = await getMenu(menuId);
          render();
          showToast('Schedule updated');
        } catch (err) {
          showToast('Failed to update schedule', 'error');
        }
      });
    });

    // Wire up per-dish day toggles
    container.querySelectorAll('.mb-dish-day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => d.id == dishId);
        if (!dish) return;

        btn.classList.toggle('active');
        const dayBtns = container.querySelectorAll(`.mb-dish-day-btn[data-dish="${dishId}"]`);
        const activeDays = [];
        dayBtns.forEach(b => {
          if (b.classList.contains('active')) activeDays.push(parseInt(b.dataset.day));
        });

        // If all schedule days are active, store null (= all days)
        const allActive = scheduleDays.length === activeDays.length && scheduleDays.every(d => activeDays.includes(d));
        try {
          await updateMenuDish(menuId, dishId, { active_days: allActive ? null : activeDays });
          dish.active_days = allActive ? null : JSON.stringify(activeDays);
          showToast('Dish schedule updated');
        } catch (err) {
          showToast('Failed to update', 'error');
        }
      });
    });

    // Wire up "Prepare Week" button
    container.querySelector('#prepare-week-btn')?.addEventListener('click', showPrepareWeek);

    // Wire up guest allergy toggles
    container.querySelectorAll('.allergen-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.classList.toggle('active');
        await saveAllergyState();
      });
    });

    async function saveAllergyState() {
      const activeAllergens = [];
      container.querySelectorAll('.allergen-toggle.active').forEach(b => {
        activeAllergens.push(b.dataset.allergen);
      });
      const newVal = activeAllergens.join(',');
      try {
        await updateMenu(menuId, { guest_allergies: newVal });
        menu.guest_allergies = newVal;
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

    // Header overflow menu
    const mbOverflowSlot = container.querySelector('#mb-overflow-menu');
    if (mbOverflowSlot) {
      const menuBtn = createActionMenu([
        { label: 'Print Kitchen Sheet', icon: '🖨', onClick: showKitchenPrint },
        { label: 'Scale for Event', icon: '⚖', onClick: showScaleModal },
        { label: 'View Tasks', icon: '✓', onClick: () => { window.location.hash = `#/todos`; } },
      ]);
      mbOverflowSlot.appendChild(menuBtn);
    }

    // Collapsible allergy section
    makeCollapsible(container.querySelector('#mb-allergy-section'), { open: false, storageKey: 'mb_allergy_section' });

    // Servings controls
    container.querySelectorAll('.servings-inc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => d.id == dishId);
        if (dish) {
          btn.disabled = true;
          try {
            await updateMenuDish(menuId, dishId, { servings: dish.servings + 1 });
            menu = await getMenu(menuId);
            render();
          } catch (err) {
            btn.disabled = false;
            showToast(err.message || 'Failed to update servings', 'error');
          }
        }
      });
    });

    container.querySelectorAll('.servings-dec').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => d.id == dishId);
        if (dish && dish.servings > 1) {
          btn.disabled = true;
          try {
            await updateMenuDish(menuId, dishId, { servings: dish.servings - 1 });
            menu = await getMenu(menuId);
            render();
          } catch (err) {
            btn.disabled = false;
            showToast(err.message || 'Failed to update servings', 'error');
          }
        }
      });
    });

    // Portion target → auto-calculate batches
    container.querySelectorAll('.mb-portion-target').forEach(input => {
      let debounce;
      input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(async () => {
          const dishId = input.dataset.dish;
          const batchYield = parseFloat(input.dataset.yield) || 1;
          const targetPortions = parseInt(input.value);
          if (!targetPortions || targetPortions < 1) return;
          const neededBatches = Math.ceil(targetPortions / batchYield);
          try {
            await updateMenuDish(menuId, dishId, { servings: neededBatches });
            menu = await getMenu(menuId);
            showToast(`${neededBatches} batch${neededBatches !== 1 ? 'es' : ''} = ${neededBatches * batchYield} portions`);
            render();
          } catch (err) {
            showToast(err.message || 'Failed to update', 'error');
          }
        }, 600);
      });
    });

    // Dish row action menus (View, Remove)
    container.querySelectorAll('.mb-row-actions[data-dish-id]').forEach(slot => {
      const dishId = slot.dataset.dishId;
      const menuTrigger = createActionMenu([
        { label: 'View Dish', icon: '👁', onClick: () => { window.location.hash = `#/dishes/${dishId}`; } },
        { label: 'Edit Dish', icon: '✏️', onClick: () => { window.location.hash = `#/dishes/${dishId}/edit`; } },
        { label: 'Remove', icon: '✕', danger: true, onClick: async () => {
          try {
            await removeDishFromMenu(menuId, dishId);
            menu = await getMenu(menuId);
            showToast('Dish removed');
            render();
          } catch (err) {
            showToast(err.message, 'error');
          }
        }},
      ]);
      slot.appendChild(menuTrigger);
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

  // ---- Prepare Week ----
  async function showPrepareWeek() {
    let scheduleDays = [];
    try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch {}
    if (!scheduleDays.length) {
      showToast('Set service days first', 'warning');
      return;
    }

    const defaultMonday = getNextMonday();
    const dayOrder = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    const sortedDays = [...scheduleDays].sort((a, b) => dayOrder[a] - dayOrder[b]);

    const modal = openModal('Prepare Week', `
      <div class="form-group">
        <label for="week-start-input">Week Starting (Monday)</label>
        <input type="date" id="week-start-input" class="input" value="${defaultMonday}">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          ${formatWeekLabel(defaultMonday)}
        </p>
      </div>
      <div class="mb-week-preview">
        <h4 style="margin:0 0 8px;">Service days: ${sortedDays.map(d => DAY_NAMES[d]).join(', ')}</h4>
        <p style="margin:0 0 4px;font-size:0.9rem;">${menu.dishes.length} dish${menu.dishes.length !== 1 ? 'es' : ''} on this menu</p>
        ${(() => {
          const daySpecific = menu.dishes.filter(d => {
            let ad = null;
            try { ad = d.active_days ? JSON.parse(d.active_days) : null; } catch {}
            return ad !== null && ad.length < scheduleDays.length;
          });
          return daySpecific.length ? `<p style="margin:0;font-size:0.85rem;color:var(--text-secondary);">${daySpecific.length} dish${daySpecific.length !== 1 ? 'es' : ''} with day-specific schedules</p>` : '';
        })()}
      </div>
      <button id="generate-week-btn" class="btn btn-primary" style="width:100%;margin-top:16px;">Generate Prep Tasks</button>
    `);

    const weekInput = modal.querySelector('#week-start-input');
    const hintP = weekInput.nextElementSibling;
    weekInput.addEventListener('input', () => {
      if (weekInput.value) {
        hintP.textContent = formatWeekLabel(weekInput.value);
      }
    });

    modal.querySelector('#generate-week-btn').addEventListener('click', async () => {
      const weekStart = weekInput.value;
      if (!weekStart) {
        showToast('Select a week start date', 'error');
        return;
      }

      const btn = modal.querySelector('#generate-week-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      try {
        const result = await generateTasks(menuId, { week_start: weekStart });
        closeModal(modal);
        showToast(`Generated ${result.prep_count} prep task${result.prep_count !== 1 ? 's' : ''} for ${formatWeekLabel(weekStart)}`, 'success');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Generate Prep Tasks';
        showToast(err.message || 'Failed to generate tasks', 'error');
      }
    });
  }

  // ---- Scale Modal ----
  async function showScaleModal() {
    const totalPortions = menu.dishes.reduce((s, d) => s + (d.total_portions || d.servings), 0);
    const defaultCovers = menu.expected_covers || totalPortions;

    const modal = openModal('Scale for Event', `
      <div class="form-group">
        <label for="scale-covers">Number of Covers</label>
        <input type="number" id="scale-covers" class="input" min="1" value="${defaultCovers}" placeholder="e.g., 50">
        <p class="text-muted" style="margin-top:6px;font-size:0.85rem;">
          Current menu produces ${totalPortions} portions${menu.expected_covers ? ` (${menu.expected_covers} expected covers)` : ''}. Enter total covers needed.
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
            (${data.scale_factor}x from ${data.base_covers} ${data.base_covers_source === 'expected' ? 'expected' : 'base'} covers)<br>
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
          const html = `
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
          `;
          printSheet(html);
        });

      } catch (err) {
        resultDiv.innerHTML = `<div class="error" style="padding:12px;">${escapeHtml(err.message)}</div>`;
      }
    });
  }

  // ---- Kitchen Print ----
  async function showKitchenPrint() {
    try {
      const data = await getMenuKitchenPrint(menuId);

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
          ${data.guest_allergies.length ? ` &nbsp;·&nbsp; <span class="alert">&#9888; Guest Allergies: ${escapeHtml(data.guest_allergies.join(', ').toUpperCase())}</span>` : ''}
        </div>
      `;

      data.dishes.forEach((dish, i) => {
        const batchYield = dish.batch_yield || 1;
        const servings = dish.servings || 1;
        const batchInfo = servings > 1 || batchYield > 1
          ? ` &mdash; ${servings} batch${servings !== 1 ? 'es' : ''}${batchYield > 1 ? ` (${dish.total_portions || servings * batchYield} portions)` : ''}`
          : '';

        html += `<div class="dish-block">`;
        html += `<div><div class="course-num">Course ${i + 1}</div><div class="course-cat">${escapeHtml(dish.category || '')}</div></div>`;
        html += `<div>`;
        html += `<div class="dish-name">${escapeHtml(dish.name)}${batchInfo}</div>`;

        if (dish.allergens.length) {
          html += `<div class="allergens">${dish.allergens.map(a => `<span class="allergen-tag">${escapeHtml(a)}</span>`).join('')}</div>`;
        }

        if (dish.components && dish.components.length) {
          html += `<ul class="ingredients">${dish.components.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul>`;
        } else {
          html += `<p style="font-size:0.85rem;color:#888;margin:4px 0 8px;font-style:italic;">No service components added.</p>`;
        }

        // Scaled ingredient list (quantities pre-multiplied by servings on the server)
        if (dish.ingredients && dish.ingredients.length) {
          html += `<div style="margin:8px 0;"><div class="notes-label">Ingredients${servings > 1 ? ' (scaled &times;' + servings + ')' : ''}</div>`;
          html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:4px;">';
          for (const ing of dish.ingredients) {
            html += '<tr><td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;">' + escapeHtml(ing.ingredient_name) + '</td>';
            html += '<td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;"><strong>' + ing.quantity + '</strong> ' + escapeHtml(ing.unit || '') + '</td>';
            html += '<td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;color:#888;font-size:0.8rem;">' + escapeHtml(ing.prep_note || '') + '</td></tr>';
          }
          html += '</table></div>';
        }

        // Prep Directions
        if (dish.directions && dish.directions.length) {
          html += '<div style="margin:8px 0;"><div class="notes-label">Prep Method</div>';
          let stepNum = 0;
          for (const d of dish.directions) {
            if (d.type === 'section') {
              html += '<div style="font-weight:700;margin:8px 0 4px;border-bottom:1px solid #ddd;padding-bottom:2px;">' + escapeHtml(d.text) + '</div>';
            } else {
              stepNum++;
              html += '<div style="display:flex;gap:6px;margin-bottom:4px;font-size:0.85rem;"><span style="font-weight:700;color:#888;min-width:18px;">' + stepNum + '.</span><span>' + escapeHtml(d.text) + '</span></div>';
            }
          }
          html += '</div>';
        } else if (dish.chefs_notes) {
          html += '<div class="notes"><div class="notes-label">Chef\'s Notes</div>' + escapeHtml(dish.chefs_notes) + '</div>';
        }

        // Service Directions
        if (dish.service_directions && dish.service_directions.length) {
          html += '<div style="margin:8px 0;"><div class="notes-label">Service Process</div>';
          let stepNum = 0;
          for (const d of dish.service_directions) {
            if (d.type === 'section') {
              html += '<div style="font-weight:700;margin:8px 0 4px;border-bottom:1px solid #ddd;padding-bottom:2px;">' + escapeHtml(d.text) + '</div>';
            } else {
              stepNum++;
              html += '<div style="display:flex;gap:6px;margin-bottom:4px;font-size:0.85rem;"><span style="font-weight:700;color:#888;min-width:18px;">' + stepNum + '.</span><span>' + escapeHtml(d.text) + '</span></div>';
            }
          }
          html += '</div>';
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
      printSheet(html);
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
