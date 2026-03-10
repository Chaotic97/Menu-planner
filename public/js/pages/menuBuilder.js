import { getMenu, updateMenu, getDishes, getDish, createDish, updateDish, deleteDish, updateDishAllergen, addDishToMenu, removeDishFromMenu, updateMenuDish, getScaledShoppingList, reorderMenuDishes, getMenuKitchenPrint, generateTasks, createCourse, updateCourse, deleteCourse, reorderCourses, applyCoursesTemplate } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { openLightbox } from '../components/lightbox.js';
import { createActionMenu } from '../components/actionMenu.js';
import { makeCollapsible, collapsibleHeader } from '../components/collapsible.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { ALLERGEN_LIST, CATEGORY_ORDER, capitalize } from '../data/allergens.js';
import { printSheet } from '../utils/printSheet.js';
import { loadingHTML } from '../utils/loadingState.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isHouseMenu(menu) { return menu.menu_type === 'standard'; }
function isEventPast(eventDate) {
  if (!eventDate) return false;
  return eventDate < new Date().toISOString().slice(0, 10);
}
function formatEventDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

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

// ---- State Parsing ----

function parseMenuState(menu) {
  const guestAllergies = menu.guest_allergies
    ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
    : [];

  let scheduleDays = [];
  try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch { /* ignore */ }

  let allergenCovers = {};
  try { allergenCovers = JSON.parse(menu.allergen_covers || '{}'); } catch { /* ignore */ }

  const courses = menu.courses || [];
  const serviceStyle = menu.service_style || 'alacarte';
  const isCoursed = serviceStyle === 'coursed';
  const styleLabel = isCoursed ? 'Course' : 'Section';

  // Group dishes by course_id
  const courseDishMap = {};
  const unassignedDishes = [];
  for (const dish of menu.dishes) {
    if (dish.course_id && courses.some(c => c.id === dish.course_id)) {
      if (!courseDishMap[dish.course_id]) courseDishMap[dish.course_id] = [];
      courseDishMap[dish.course_id].push(dish);
    } else {
      unassignedDishes.push(dish);
    }
  }

  // Group unassigned by category (for legacy/fallback display)
  const grouped = {};
  for (const dish of unassignedDishes) {
    const cat = dish.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(dish);
  }

  const isHouse = isHouseMenu(menu);
  const past = !isHouse && isEventPast(menu.event_date);

  return {
    guestAllergies,
    scheduleDays,
    allergenCovers,
    courses,
    serviceStyle,
    isCoursed,
    styleLabel,
    courseDishMap,
    unassignedDishes,
    grouped,
    isHouse,
    past,
  };
}

// ---- HTML Building ----

function buildMenuBuilderHTML(menu, state) {
  const {
    guestAllergies, scheduleDays, allergenCovers, courses,
    isCoursed, styleLabel, courseDishMap, unassignedDishes,
    grouped, isHouse, past,
  } = state;

  return `
    <div class="page-header">
      <a href="#/menus" class="btn btn-back">&larr; Back</a>
      <div class="menu-title-area">
        <div class="menu-title-row">
          ${isHouse ? '<span class="ml-house-badge" style="margin-right:8px;">House Menu</span>' : ''}
          ${!isHouse && menu.event_date ? `<span class="ml-event-date ${past ? 'ml-event-past' : ''}" style="margin-right:8px;">${escapeHtml(formatEventDate(menu.event_date))}${past ? ' <span class="ml-past-label">Past</span>' : ''}</span>` : ''}
          <h1 id="menu-title">${escapeHtml(menu.name)}</h1>
          <button id="edit-menu-name-btn" class="btn btn-icon" title="Edit menu details">
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

    <!-- Service Style Toggle -->
    <div class="mc-style-toggle-bar">
      <div class="mc-style-toggle">
        <button type="button" class="mc-style-btn ${!isCoursed ? 'active' : ''}" data-style="alacarte">&Agrave; la carte</button>
        <button type="button" class="mc-style-btn ${isCoursed ? 'active' : ''}" data-style="coursed">Coursed</button>
      </div>
    </div>

    ${!isHouse && menu.expected_covers ? `
      <div class="mb-event-covers-bar">
        <strong>${menu.expected_covers} covers</strong>
        ${menu.sell_price ? `<span> &middot; $${Number(menu.sell_price).toFixed(2)}</span>` : ''}
        ${menu.event_date ? `<span> &middot; ${escapeHtml(formatEventDate(menu.event_date))}</span>` : ''}
      </div>
    ` : ''}

    ${isHouse ? `
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
    ` : ''}

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
              ${ALLERGEN_LIST.map(a => {
                const isActive = guestAllergies.includes(a);
                const count = allergenCovers[a] || '';
                return `
                  <div class="allergen-cover-item">
                    <button type="button" class="allergen-toggle ${isActive ? 'active' : ''}"
                            data-allergen="${a}">${capitalize(a)}</button>
                    ${isActive ? `<input type="number" class="allergen-cover-count" data-allergen="${a}"
                                        min="1" step="1" value="${count || 1}" placeholder="#"
                                        title="Number of covers needing ${a}-free">` : ''}
                  </div>
                `;
              }).join('')}
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
          ${courses.length ? `<span>|</span><span>${courses.length} ${styleLabel.toLowerCase()}${courses.length !== 1 ? 's' : ''}</span>` : ''}
          <span>|</span>
          <span>Total batches: ${totalBatches}${hasMultiPortion ? ` (${totalPortions} portions)` : ''}</span>
          ${menu.all_allergens.length ? `
            <span>|</span>
            <span>Allergens: ${renderAllergenBadges(menu.all_allergens, true)}</span>
          ` : ''}
        </div>`;
      })()}
    ` : ''}

    <!-- Courses / Sections -->
    <div class="mc-courses-container" id="mc-courses-container">
      ${courses.length ? courses.map(course => renderCourseSection(course, courseDishMap[course.id] || [], isHouse, scheduleDays, isCoursed)).join('') : ''}

      ${/* Unassigned dishes */ ''}
      ${unassignedDishes.length ? `
        <div class="mc-unassigned-section">
          ${courses.length ? `<h2 class="mb-category-heading mc-unassigned-heading">Unassigned Dishes</h2>` : ''}
          <div class="menu-dishes" data-course-id="">
            ${CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => `
              <div class="mb-category-section">
                ${!courses.length ? `<h2 class="mb-category-heading">${capitalize(cat)}s</h2>` : ''}
                ${grouped[cat].map(dish => renderDishRow(dish, isHouse, scheduleDays)).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${!menu.dishes.length && !courses.length ? `
        <div class="empty-state">
          <p>This menu has no dishes yet.</p>
          <button id="add-dish-empty" class="btn btn-primary">+ Add Dishes</button>
        </div>
      ` : ''}
    </div>

    <!-- Add Course/Section + Template buttons -->
    <div class="mc-add-course-bar">
      <button id="add-course-btn" class="btn btn-secondary">+ Add ${styleLabel}</button>
      ${!courses.length ? `
        <div class="mc-template-group">
          <span class="mc-template-label">or use template:</span>
          <button class="btn btn-sm mc-template-btn" data-template="3-course">3-Course</button>
          <button class="btn btn-sm mc-template-btn" data-template="5-course">5-Course</button>
          <button class="btn btn-sm mc-template-btn" data-template="tasting">Tasting</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ---- Event Setup Functions ----

function setupServiceStyleToggle(container, menuId, ctx) {
  const serviceStyle = ctx.menu.service_style || 'alacarte';
  container.querySelectorAll('.mc-style-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStyle = btn.dataset.style;
      if (newStyle === serviceStyle) return;
      try {
        await updateMenu(menuId, { service_style: newStyle });
        ctx.menu = await getMenu(menuId);
        ctx.render();
        showToast(`Switched to ${newStyle === 'coursed' ? 'coursed' : 'à la carte'} mode`);
      } catch (err) {
        console.warn('Service style switch failed:', err);
        showToast('Could not change service style. Please try again.', 'error');
      }
    });
  });
}

function setupEditMenuModal(container, menuId, isHouse, ctx) {
  container.querySelector('#edit-menu-name-btn').addEventListener('click', () => {
    const menu = ctx.menu;
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
        ${!isHouse ? `
          <div class="form-group">
            <label for="edit-event-date">Event Date</label>
            <input type="date" id="edit-event-date" class="input" value="${menu.event_date || ''}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="edit-sell-price">Sell Price ($)</label>
              <input type="number" id="edit-sell-price" class="input" step="0.01" min="0" value="${menu.sell_price || ''}">
            </div>
            <div class="form-group">
              <label for="edit-covers">Expected Covers</label>
              <input type="number" id="edit-covers" class="input" min="0" value="${menu.expected_covers || ''}">
            </div>
          </div>
        ` : ''}
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
      const updates = { name, description };
      if (!isHouse) {
        updates.event_date = modal.querySelector('#edit-event-date').value || null;
        updates.sell_price = parseFloat(modal.querySelector('#edit-sell-price').value) || 0;
        updates.expected_covers = parseInt(modal.querySelector('#edit-covers').value) || 0;
      }
      try {
        await updateMenu(menuId, updates);
        ctx.menu = await getMenu(menuId);
        closeModal(modal);
        showToast('Menu updated');
        ctx.render();
      } catch (err) {
        console.warn('Menu update failed:', err);
        showToast('Could not update menu. Please try again.', 'error');
      }
    });
  });
}

function setupScheduleDayToggles(container, menuId, isHouse, scheduleDays, ctx) {
  if (!isHouse) return;

  container.querySelectorAll('#schedule-day-toggles .mb-day-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.classList.toggle('active');
      const newDays = [];
      container.querySelectorAll('#schedule-day-toggles .mb-day-btn.active').forEach(b => {
        newDays.push(parseInt(b.dataset.day));
      });
      try {
        await updateMenu(menuId, { schedule_days: newDays });
        ctx.menu.schedule_days = JSON.stringify(newDays);
        ctx.menu = await getMenu(menuId);
        ctx.render();
        showToast('Schedule updated');
      } catch (err) {
        showToast('Failed to update schedule', 'error');
      }
    });
  });

  // Per-dish day toggles
  container.querySelectorAll('.mb-dish-day-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dishId = btn.dataset.dish;
      const dish = ctx.menu.dishes.find(d => String(d.id) === String(dishId));
      if (!dish) return;

      btn.classList.toggle('active');
      const dayBtns = container.querySelectorAll(`.mb-dish-day-btn[data-dish="${dishId}"]`);
      const activeDays = [];
      dayBtns.forEach(b => {
        if (b.classList.contains('active')) activeDays.push(parseInt(b.dataset.day));
      });

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

  // "Prepare Week" button
  container.querySelector('#prepare-week-btn')?.addEventListener('click', () => showPrepareWeek(ctx));
}

function setupAllergyToggles(container, menuId, ctx) {
  async function saveAllergyState() {
    const activeAllergens = [];
    const newCovers = {};
    container.querySelectorAll('.allergen-toggle.active').forEach(b => {
      const allergen = b.dataset.allergen;
      activeAllergens.push(allergen);
      const countInput = container.querySelector(`.allergen-cover-count[data-allergen="${allergen}"]`);
      if (countInput) {
        const val = parseInt(countInput.value) || 1;
        newCovers[allergen] = val;
      } else {
        newCovers[allergen] = 1;
      }
    });
    const newVal = activeAllergens.join(',');
    try {
      await updateMenu(menuId, { guest_allergies: newVal, allergen_covers: newCovers });
      ctx.menu.guest_allergies = newVal;
      ctx.menu.allergen_covers = JSON.stringify(newCovers);
      ctx.menu = await getMenu(menuId);
      ctx.render();
      showToast('Guest allergies updated');
    } catch (err) {
      showToast('Failed to update', 'error');
    }
  }

  container.querySelectorAll('.allergen-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.classList.toggle('active');
      await saveAllergyState();
    });
  });

  container.querySelectorAll('.allergen-cover-count').forEach(input => {
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => saveAllergyState(), 500);
    });
  });

  // Collapsible allergy section
  makeCollapsible(container.querySelector('#mb-allergy-section'), { open: false, storageKey: 'mb_allergy_section' });
}

function setupHeaderActions(container, menuId, isHouse, ctx) {
  // Add dish buttons
  container.querySelector('#add-dish-btn')?.addEventListener('click', () => showDishPicker(menuId, ctx));
  container.querySelector('#add-dish-empty')?.addEventListener('click', () => showDishPicker(menuId, ctx));

  // Set back-navigation context when clicking dish name links
  container.addEventListener('click', (e) => {
    const link = e.target.closest('.dish-name-link');
    if (link) sessionStorage.setItem('dishNav_backTo', `#/menus/${menuId}`);
  });

  // Per-course "Add Dish" buttons
  container.querySelectorAll('.mc-course-add-dish').forEach(btn => {
    btn.addEventListener('click', () => {
      showDishPicker(menuId, ctx, parseInt(btn.dataset.courseId));
    });
  });

  // Header overflow menu
  const mbOverflowSlot = container.querySelector('#mb-overflow-menu');
  if (mbOverflowSlot) {
    const overflowItems = [
      { label: 'Print Kitchen Sheet', icon: '🖨', onClick: () => showKitchenPrint(menuId) },
      { label: 'Scale for Event', icon: '⚖', onClick: () => showScaleModal(menuId, ctx) },
      { label: 'View Tasks', icon: '✓', onClick: () => { window.location.hash = '#/todos'; } },
    ];
    if (isHouse) {
      overflowItems.push({ label: 'Convert to Event Menu', icon: '📅', onClick: async () => {
        try {
          await updateMenu(menuId, { menu_type: 'event' });
          ctx.menu = await getMenu(menuId);
          showToast('Converted to event menu');
          ctx.render();
        } catch (err) { console.warn('Convert to event menu failed:', err); showToast('Could not convert menu. Please try again.', 'error'); }
      }});
    } else {
      overflowItems.push({ label: 'Set as House Menu', icon: '⭐', onClick: async () => {
        try {
          await updateMenu(menuId, { menu_type: 'standard' });
          ctx.menu = await getMenu(menuId);
          showToast('Set as house menu');
          ctx.render();
        } catch (err) { console.warn('Set as house menu failed:', err); showToast('Could not set as house menu. Please try again.', 'error'); }
      }});
    }
    mbOverflowSlot.appendChild(createActionMenu(overflowItems));
  }

  // Photo lightbox
  container.querySelectorAll('.mb-dish-thumb img').forEach(img => {
    img.style.cursor = 'zoom-in';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(img.src, img.alt);
    });
  });
}

function setupServingsControls(container, menuId, ctx) {
  // Servings controls — inc/dec buttons
  container.querySelectorAll('.servings-inc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dishId = btn.dataset.dish;
      const dish = ctx.menu.dishes.find(d => String(d.id) === String(dishId));
      if (dish) {
        btn.disabled = true;
        try {
          await updateMenuDish(menuId, dishId, { servings: dish.servings + 1 });
          ctx.menu = await getMenu(menuId);
          ctx.render();
        } catch (err) {
          btn.disabled = false;
          console.warn('Update servings failed:', err);
          showToast('Could not update servings. Please try again.', 'error');
        }
      }
    });
  });

  container.querySelectorAll('.servings-dec').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dishId = btn.dataset.dish;
      const dish = ctx.menu.dishes.find(d => String(d.id) === String(dishId));
      if (dish && dish.servings > 1) {
        btn.disabled = true;
        try {
          await updateMenuDish(menuId, dishId, { servings: dish.servings - 1 });
          ctx.menu = await getMenu(menuId);
          ctx.render();
        } catch (err) {
          btn.disabled = false;
          console.warn('Update servings failed:', err);
          showToast('Could not update servings. Please try again.', 'error');
        }
      }
    });
  });

  // Servings — direct number input
  container.querySelectorAll('.mb-servings-input').forEach(input => {
    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const dishId = input.dataset.dish;
        const val = parseInt(input.value);
        if (!val || val < 1) return;
        try {
          await updateMenuDish(menuId, dishId, { servings: val });
          ctx.menu = await getMenu(menuId);
          ctx.render();
        } catch (err) {
          console.warn('Update servings failed:', err);
          showToast('Could not update servings. Please try again.', 'error');
        }
      }, 500);
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
          ctx.menu = await getMenu(menuId);
          showToast(`${neededBatches} batch${neededBatches !== 1 ? 'es' : ''} = ${neededBatches * batchYield} portions`);
          ctx.render();
        } catch (err) {
          console.warn('Update portions failed:', err);
          showToast('Could not update portions. Please try again.', 'error');
        }
      }, 600);
    });
  });
}

function setupDishNotes(container, menuId, ctx) {
  // Dish note toggle
  container.querySelectorAll('.mc-dish-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteArea = btn.closest('.mb-dish-row').querySelector('.mc-dish-note-area');
      if (noteArea) {
        noteArea.classList.toggle('mc-note-open');
        if (noteArea.classList.contains('mc-note-open')) {
          noteArea.querySelector('textarea')?.focus();
        }
      }
    });
  });

  // Dish note save
  container.querySelectorAll('.mc-dish-note-textarea').forEach(textarea => {
    let debounce;
    textarea.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const dishId = textarea.dataset.dish;
        try {
          await updateMenuDish(menuId, dishId, { notes: textarea.value });
          const dish = ctx.menu.dishes.find(d => String(d.id) === String(dishId));
          if (dish) dish.menu_dish_notes = textarea.value;
          showToast('Note saved');
        } catch (err) {
          showToast('Failed to save note', 'error');
        }
      }, 600);
    });
  });
}

function setupDishRowActions(container, menuId, ctx) {
  container.querySelectorAll('.mb-row-actions[data-dish-id]').forEach(slot => {
    const dishId = slot.dataset.dishId;
    const row = slot.closest('.mb-dish-row');
    const isTemp = row && row.dataset.temporary === '1';

    const actions = isTemp
      ? [
        { label: 'Edit', icon: '✏️', onClick: () => showTempDishEditModal(dishId, menuId, ctx) },
        { label: 'Remove', icon: '✕', danger: true, onClick: async () => {
          try {
            await removeDishFromMenu(menuId, dishId);
            await deleteDish(dishId);
            ctx.menu = await getMenu(menuId);
            showToast('Temp dish removed');
            ctx.render();
          } catch (err) {
            console.warn('Remove temp dish failed:', err);
            showToast('Could not remove dish. Please try again.', 'error');
          }
        }},
      ]
      : [
        { label: 'View Dish', icon: '👁', onClick: () => { sessionStorage.setItem('dishNav_backTo', `#/menus/${menuId}`); window.location.hash = `#/dishes/${dishId}`; } },
        { label: 'Edit Dish', icon: '✏️', onClick: () => { sessionStorage.setItem('dishNav_backTo', `#/menus/${menuId}`); window.location.hash = `#/dishes/${dishId}/edit`; } },
        { label: 'Remove', icon: '✕', danger: true, onClick: async () => {
          try {
            await removeDishFromMenu(menuId, dishId);
            ctx.menu = await getMenu(menuId);
            showToast('Dish removed');
            ctx.render();
          } catch (err) {
            console.warn('Remove dish failed:', err);
            showToast('Could not remove dish. Please try again.', 'error');
          }
        }},
      ];

    slot.appendChild(createActionMenu(actions));
  });

  // Temp dish edit buttons (click on name)
  container.querySelectorAll('.mb-temp-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      showTempDishEditModal(parseInt(btn.dataset.dishId), menuId, ctx);
    });
  });
}

function setupCourseManagement(container, menuId, courses, isCoursed, styleLabel, ctx) {
  // Course action menus (edit name, add notes, delete)
  container.querySelectorAll('.mc-course-actions[data-course-id]').forEach(slot => {
    const courseId = parseInt(slot.dataset.courseId);
    const course = courses.find(c => c.id === courseId);
    if (!course) return;
    const trigger = createActionMenu([
      { label: 'Edit Name', icon: '✏️', onClick: () => showEditCourse(courseId, course.name, course.notes, menuId, styleLabel, ctx) },
      { label: `Delete ${styleLabel}`, icon: '✕', danger: true, onClick: async () => {
        try {
          await deleteCourse(menuId, courseId);
          ctx.menu = await getMenu(menuId);
          showToast(`${styleLabel} deleted`, 'success');
          ctx.render();
        } catch (err) {
          console.warn('Delete course failed:', err);
          showToast(`Could not delete ${styleLabel}. Please try again.`, 'error');
        }
      }},
    ]);
    slot.appendChild(trigger);
  });

  // Course note toggle
  container.querySelectorAll('.mc-course-note-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteArea = btn.closest('.mc-course-header').nextElementSibling;
      if (noteArea && noteArea.classList.contains('mc-course-note-area')) {
        noteArea.classList.toggle('mc-note-open');
        if (noteArea.classList.contains('mc-note-open')) {
          noteArea.querySelector('textarea')?.focus();
        }
      }
    });
  });

  // Course note save
  container.querySelectorAll('.mc-course-note-textarea').forEach(textarea => {
    let debounce;
    textarea.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const courseId = textarea.dataset.courseId;
        try {
          await updateCourse(menuId, courseId, { notes: textarea.value });
          const course = courses.find(c => String(c.id) === String(courseId));
          if (course) course.notes = textarea.value;
          showToast('Note saved');
        } catch (err) {
          showToast('Failed to save note', 'error');
        }
      }, 600);
    });
  });

  // Add course button
  container.querySelector('#add-course-btn')?.addEventListener('click', async () => {
    const defaultName = isCoursed
      ? `Course ${courses.length + 1}`
      : `Section ${courses.length + 1}`;
    const modal = openModal(`Add ${styleLabel}`, `
      <form id="add-course-form" class="form">
        <div class="form-group">
          <label for="course-name-input">${styleLabel} Name *</label>
          <input type="text" id="course-name-input" class="input" required value="${escapeHtml(defaultName)}" placeholder="e.g., ${isCoursed ? 'Starter' : 'Small Plates'}">
        </div>
        <div class="form-group">
          <label for="course-notes-input">Notes</label>
          <textarea id="course-notes-input" class="input" rows="2" placeholder="e.g., Fire after speeches, 15 min gap..."></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add ${styleLabel}</button>
        </div>
      </form>
    `);

    modal.querySelector('#course-name-input').select();

    modal.querySelector('#add-course-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = modal.querySelector('#course-name-input').value.trim();
      if (!name) return;
      const notes = modal.querySelector('#course-notes-input').value.trim();
      try {
        await createCourse(menuId, { name, notes });
        ctx.menu = await getMenu(menuId);
        closeModal(modal);
        showToast(`${styleLabel} added`);
        ctx.render();
      } catch (err) {
        console.warn('Create course failed:', err);
        showToast(`Could not add ${styleLabel}. Please try again.`, 'error');
      }
    });
  });

  // Template buttons
  container.querySelectorAll('.mc-template-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const template = btn.dataset.template;
      btn.disabled = true;
      try {
        // Switch to coursed if using template
        if (!isCoursed) {
          await updateMenu(menuId, { service_style: 'coursed' });
        }
        await applyCoursesTemplate(menuId, template);
        ctx.menu = await getMenu(menuId);
        showToast(`Applied ${template} template`);
        ctx.render();
      } catch (err) {
        btn.disabled = false;
        console.warn('Apply template failed:', err);
        showToast('Could not apply template. Please try again.', 'error');
      }
    });
  });
}

function setupDragDrop(container, menuId, ctx) {
  // Dish drag and drop (within and between courses)
  const dishRows = container.querySelectorAll('.mb-dish-row[draggable]');
  let draggedId = null;
  let dragType = null; // 'dish' or 'course'

  dishRows.forEach(row => {
    row.addEventListener('dragstart', (e) => {
      draggedId = row.dataset.dishId;
      dragType = 'dish';
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `dish:${draggedId}`);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      container.querySelectorAll('.drag-over, .mc-drop-target').forEach(r => r.classList.remove('drag-over', 'mc-drop-target'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragType === 'dish' && row.dataset.dishId !== draggedId) {
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
      if (dragType !== 'dish') return;
      const targetId = row.dataset.dishId;
      if (draggedId === targetId) return;

      const targetCourseId = row.dataset.courseId || null;
      const fromIndex = ctx.menu.dishes.findIndex(d => String(d.id) === String(draggedId));
      const toIndex = ctx.menu.dishes.findIndex(d => String(d.id) === String(targetId));
      if (fromIndex === -1 || toIndex === -1) return;

      const [moved] = ctx.menu.dishes.splice(fromIndex, 1);
      moved.course_id = targetCourseId ? parseInt(targetCourseId) : null;
      ctx.menu.dishes.splice(toIndex, 0, moved);

      const order = ctx.menu.dishes.map((d, i) => ({
        dish_id: d.id,
        sort_order: i,
        course_id: d.course_id === undefined ? undefined : (d.course_id || null)
      }));
      try {
        await reorderMenuDishes(menuId, order);
        ctx.menu = await getMenu(menuId);
        ctx.render();
      } catch (err) {
        showToast('Failed to reorder', 'error');
      }
    });
  });

  // Course drop zones (drop dish into empty course)
  container.querySelectorAll('.mc-course-dishes').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      if (dragType !== 'dish') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('mc-drop-target');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('mc-drop-target');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('mc-drop-target');
      if (dragType !== 'dish' || !draggedId) return;
      // If dropped on the zone itself (not on a dish row), move to end of this course
      if (e.target.closest('.mb-dish-row')) return; // handled by dish drop

      const targetCourseId = zone.dataset.courseId ? parseInt(zone.dataset.courseId) : null;
      const dish = ctx.menu.dishes.find(d => String(d.id) === String(draggedId));
      if (!dish) return;

      try {
        await updateMenuDish(menuId, draggedId, { course_id: targetCourseId });
        ctx.menu = await getMenu(menuId);
        ctx.render();
        showToast('Dish moved');
      } catch (err) {
        showToast('Failed to move dish', 'error');
      }
    });
  });

  // Course section drag and drop (reorder courses)
  const courseSections = container.querySelectorAll('.mc-course-section[draggable]');
  courseSections.forEach(section => {
    const handle = section.querySelector('.mc-course-drag');
    if (!handle) return;

    handle.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      draggedId = section.dataset.courseId;
      dragType = 'course';
      section.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `course:${draggedId}`);
    });

    section.addEventListener('dragend', () => {
      section.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    });

    section.addEventListener('dragover', (e) => {
      if (dragType !== 'course') return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (section.dataset.courseId !== draggedId) {
        container.querySelectorAll('.mc-course-section.drag-over').forEach(r => r.classList.remove('drag-over'));
        section.classList.add('drag-over');
      }
    });

    section.addEventListener('dragleave', () => {
      section.classList.remove('drag-over');
    });

    section.addEventListener('drop', async (e) => {
      e.preventDefault();
      section.classList.remove('drag-over');
      if (dragType !== 'course') return;
      const targetCourseId = section.dataset.courseId;
      if (draggedId === targetCourseId) return;

      const courses = ctx.menu.courses || [];
      const fromIdx = courses.findIndex(c => String(c.id) === String(draggedId));
      const toIdx = courses.findIndex(c => String(c.id) === String(targetCourseId));
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = courses.splice(fromIdx, 1);
      courses.splice(toIdx, 0, moved);

      const order = courses.map((c, i) => ({ course_id: c.id, sort_order: i }));
      try {
        await reorderCourses(menuId, order);
        ctx.menu = await getMenu(menuId);
        ctx.render();
      } catch (err) {
        showToast('Failed to reorder', 'error');
      }
    });
  });

  // Touch support for dish drag handles
  let touchDragId = null;
  let touchStartY = 0;

  dishRows.forEach(row => {
    const handle = row.querySelector('.drag-handle:not(.mc-course-drag)');
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
      const fromIndex = ctx.menu.dishes.findIndex(d => String(d.id) === String(touchDragId));

      let toIndex = fromIndex;
      if (diff > 40 && fromIndex < ctx.menu.dishes.length - 1) toIndex = fromIndex + 1;
      else if (diff < -40 && fromIndex > 0) toIndex = fromIndex - 1;

      if (toIndex !== fromIndex) {
        const [moved] = ctx.menu.dishes.splice(fromIndex, 1);
        ctx.menu.dishes.splice(toIndex, 0, moved);
        const order = ctx.menu.dishes.map((d, i) => ({ dish_id: d.id, sort_order: i }));
        try {
          await reorderMenuDishes(menuId, order);
          ctx.render();
        } catch (err) {
          showToast('Failed to reorder', 'error');
        }
      }
      touchDragId = null;
    });
  });
}

// ---- Rendering Helpers ----

function renderDishRow(dish, isHouse, scheduleDays) {
  const hasConflict = dish.allergy_conflicts && dish.allergy_conflicts.length > 0;
  const isTemp = !!dish.is_temporary;
  let dishActiveDays = null;
  try { dishActiveDays = dish.active_days ? JSON.parse(dish.active_days) : null; } catch { /* ignore */ }
  const hasNote = dish.menu_dish_notes && dish.menu_dish_notes.trim();
  return `
    <div class="mb-dish-row ${hasConflict ? 'allergy-conflict' : ''} ${isTemp ? 'mb-temp-dish' : ''}" data-dish-id="${dish.id}" data-course-id="${dish.course_id || ''}" data-temporary="${isTemp ? '1' : '0'}" draggable="true">
      <div class="drag-handle" title="Drag to reorder">&#8942;&#8942;</div>
      <div class="mb-dish-thumb">
        ${dish.photo_path
          ? `<img src="${escapeHtml(dish.photo_path)}" alt="${escapeHtml(dish.name)}">`
          : '<div class="mb-no-thumb"></div>'
        }
      </div>
      <div class="mb-dish-info">
        ${isTemp
          ? `<button type="button" class="dish-name-link mb-temp-edit-btn" data-dish-id="${dish.id}"><strong>${escapeHtml(dish.name)}</strong></button>`
          : `<a href="#/dishes/${dish.id}" class="dish-name-link"><strong>${escapeHtml(dish.name)}</strong></a>`
        }
        ${isTemp ? '<span class="mb-temp-badge">Temp</span>' : ''}
        ${renderAllergenBadges(dish.allergens, true)}
        ${hasConflict ? `<div class="mb-allergy-warning">&#9888; Guest allergy: ${escapeHtml(dish.allergy_conflicts.join(', '))}</div>` : ''}
        ${!isTemp && dish.substitution_count > 0 ? `<span class="subs-badge" data-dish-id="${dish.id}" title="Has allergen substitutions">&#8644; ${dish.substitution_count} sub${dish.substitution_count > 1 ? 's' : ''}</span>` : ''}
        ${isHouse && scheduleDays.length ? `
          <div class="mb-dish-days" data-dish-id="${dish.id}">
            ${scheduleDays.map(d => {
              const isActive = dishActiveDays === null || dishActiveDays.includes(d);
              return `<button type="button" class="mb-dish-day-btn ${isActive ? 'active' : ''}" data-day="${d}" data-dish="${dish.id}">${escapeHtml(DAY_LETTERS[d])}</button>`;
            }).join('')}
          </div>
        ` : ''}
      </div>
      ${!isTemp ? `
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
        <input type="number" class="mb-servings-input" data-dish="${dish.id}" value="${dish.servings}" min="1" step="1" title="Number of batches">
        <button class="btn btn-icon servings-inc" data-dish="${dish.id}">+</button>
        <span class="mb-servings-label">${(dish.batch_yield || 1) > 1 ? 'batches' : 'servings'}</span>
        ${(dish.batch_yield || 1) > 1 ? `
          <span class="mb-portions-label">(${dish.total_portions} portions)</span>
          <input type="number" class="input mb-portion-target" data-dish="${dish.id}" data-yield="${dish.batch_yield}"
                 min="1" step="1" placeholder="target" title="Enter target portions to auto-calculate batches"
                 style="width:70px;padding:2px 6px;font-size:0.8rem;margin-left:4px;">
        ` : ''}
      </div>
      ` : ''}
      <button class="btn btn-icon mc-dish-note-btn ${hasNote ? 'mc-has-note' : ''}" data-dish="${dish.id}" title="Dish notes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      </button>
      <div class="mb-row-actions" data-dish-id="${dish.id}"></div>
      <div class="mc-dish-note-area ${hasNote ? 'mc-note-open' : ''}">
        <textarea class="mc-dish-note-textarea" data-dish="${dish.id}" placeholder="Add a note for this dish in this menu..." rows="2">${escapeHtml(dish.menu_dish_notes || '')}</textarea>
      </div>
    </div>
  `;
}

function renderCourseSection(course, dishes, isHouse, scheduleDays, isCoursed) {
  const hasNote = course.notes && course.notes.trim();
  const label = isCoursed ? 'Course' : 'Section';
  return `
    <div class="mc-course-section" data-course-id="${course.id}" draggable="true">
      <div class="mc-course-header">
        <div class="drag-handle mc-course-drag" title="Drag to reorder ${label.toLowerCase()}">&#8942;&#8942;</div>
        <h2 class="mc-course-name">${escapeHtml(course.name)}</h2>
        <span class="mc-course-dish-count">${dishes.length} dish${dishes.length !== 1 ? 'es' : ''}</span>
        <button class="btn btn-icon mc-course-note-btn ${hasNote ? 'mc-has-note' : ''}" title="${label} notes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </button>
        <button class="btn btn-sm mc-course-add-dish" data-course-id="${course.id}">+ Dish</button>
        <span class="mc-course-actions" data-course-id="${course.id}"></span>
      </div>
      <div class="mc-course-note-area ${hasNote ? 'mc-note-open' : ''}">
        <textarea class="mc-course-note-textarea" data-course-id="${course.id}" placeholder="Add ${label.toLowerCase()} notes (e.g., timing, service instructions)..." rows="2">${escapeHtml(course.notes || '')}</textarea>
      </div>
      <div class="menu-dishes mc-course-dishes" data-course-id="${course.id}">
        ${dishes.length ? dishes.map(dish => renderDishRow(dish, isHouse, scheduleDays)).join('') : `
          <div class="mc-course-empty">No dishes in this ${label.toLowerCase()} yet</div>
        `}
      </div>
    </div>
  `;
}

// ---- Modal Functions ----

function showEditCourse(courseId, currentName, currentNotes, menuId, styleLabel, ctx) {
  const modal = openModal(`Edit ${styleLabel}`, `
    <form id="edit-course-form" class="form">
      <div class="form-group">
        <label for="edit-course-name">${styleLabel} Name *</label>
        <input type="text" id="edit-course-name" class="input" required value="${escapeHtml(currentName)}">
      </div>
      <div class="form-group">
        <label for="edit-course-notes">Notes</label>
        <textarea id="edit-course-notes" class="input" rows="2">${escapeHtml(currentNotes || '')}</textarea>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);

  modal.querySelector('#edit-course-name').select();

  modal.querySelector('#edit-course-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = modal.querySelector('#edit-course-name').value.trim();
    if (!name) return;
    const notes = modal.querySelector('#edit-course-notes').value.trim();
    try {
      await updateCourse(menuId, courseId, { name, notes });
      ctx.menu = await getMenu(menuId);
      closeModal(modal);
      showToast(`${styleLabel} updated`);
      ctx.render();
    } catch (err) {
      console.warn('Update course failed:', err);
      showToast('Could not update. Please try again.', 'error');
    }
  });
}

// ---- Prepare Week ----
async function showPrepareWeek(ctx) {
  const menu = ctx.menu;
  let scheduleDays = [];
  try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch { /* ignore */ }
  if (!scheduleDays.length) {
    showToast('Set service days first', 'warning');
    return;
  }

  const defaultMonday = getNextMonday();
  const dayOrder = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
  const sortedDays = [...scheduleDays].sort((a, b) => dayOrder[a] - dayOrder[b]);
  const menuId = menu.id;

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
          try { ad = d.active_days ? JSON.parse(d.active_days) : null; } catch { /* ignore */ }
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
      console.warn('Generate tasks failed:', err);
      showToast('Could not generate tasks. Please try again.', 'error');
    }
  });
}

// ---- Scale Modal ----
async function showScaleModal(menuId, ctx) {
  const menu = ctx.menu;
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
        const printHtml = `
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
        printSheet(printHtml);
      });

    } catch (err) {
      console.warn('Scale modal failed:', err);
      resultDiv.innerHTML = '<div class="error" style="padding:12px;">Could not load scaling data. Please try again.</div>';
    }
  });
}

// ---- Kitchen Print ----
async function showKitchenPrint(menuId) {
  try {
    const data = await getMenuKitchenPrint(menuId);
    const courses = data.courses || [];
    const isCoursed = (data.menu.service_style || 'alacarte') === 'coursed';
    const hasCourses = courses.length > 0;

    let html = `
      <html><head><title>Service Sheet - ${escapeHtml(data.menu.name)}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 20px; color: #1a1a1a; }
        h1 { font-size: 1.6rem; margin-bottom: 4px; border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; }
        .meta { font-size: 0.9rem; color: #555; margin: 8px 0 20px; }
        .meta .alert { color: #d32f2f; font-weight: 700; }
        .course-header { font-size: 1.3rem; font-weight: 700; margin: 24px 0 6px; padding: 8px 0 4px; border-bottom: 2px solid #333; }
        .course-notes { font-size: 0.85rem; color: #555; font-style: italic; margin: 4px 0 12px; padding: 4px 10px; background: #f0f8ff; border-left: 3px solid #4a90d9; }
        .dish-block { margin: 0 0 20px; padding-bottom: 20px; border-bottom: 1px solid #ddd; page-break-inside: avoid; display: grid; grid-template-columns: 120px 1fr; gap: 0 16px; }
        .course-num { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #888; padding-top: 3px; }
        .course-cat { font-size: 0.7rem; color: #aaa; margin-top: 2px; text-transform: capitalize; }
        .dish-name { font-size: 1.15rem; font-weight: 700; margin-bottom: 6px; }
        .dish-note { font-size: 0.82rem; color: #444; margin: 4px 0 8px; padding: 4px 8px; background: #fffde7; border-left: 3px solid #f9a825; font-style: italic; }
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
        ${hasCourses ? ` &nbsp;·&nbsp; ${courses.length} ${isCoursed ? 'course' : 'section'}${courses.length !== 1 ? 's' : ''}` : ''}
      </div>
    `;

    function renderDishBlock(dish, courseNum) {
      const batchYield = dish.batch_yield || 1;
      const servings = dish.servings || 1;
      const batchInfo = servings > 1 || batchYield > 1
        ? ` &mdash; ${servings} batch${servings !== 1 ? 'es' : ''}${batchYield > 1 ? ` (${dish.total_portions || servings * batchYield} portions)` : ''}`
        : '';

      let block = `<div class="dish-block">`;
      block += `<div><div class="course-num">${courseNum}</div><div class="course-cat">${escapeHtml(dish.category || '')}</div></div>`;
      block += `<div>`;
      block += `<div class="dish-name">${escapeHtml(dish.name)}${batchInfo}</div>`;

      if (dish.menu_dish_notes) {
        block += `<div class="dish-note">${escapeHtml(dish.menu_dish_notes)}</div>`;
      }

      if (dish.allergens.length) {
        block += `<div class="allergens">${dish.allergens.map(a => `<span class="allergen-tag">${escapeHtml(a)}</span>`).join('')}</div>`;
      }

      if (dish.components && dish.components.length) {
        block += `<ul class="ingredients">${dish.components.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul>`;
      } else {
        block += `<p style="font-size:0.85rem;color:#888;margin:4px 0 8px;font-style:italic;">No service components added.</p>`;
      }

      if (dish.ingredients && dish.ingredients.length) {
        block += `<div style="margin:8px 0;"><div class="notes-label">Ingredients${servings > 1 ? ' (scaled &times;' + servings + ')' : ''}</div>`;
        block += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;margin-top:4px;">';
        for (const ing of dish.ingredients) {
          block += '<tr><td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;">' + escapeHtml(ing.ingredient_name) + '</td>';
          block += '<td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;"><strong>' + ing.quantity + '</strong> ' + escapeHtml(ing.unit || '') + '</td>';
          block += '<td style="padding:2px 6px;border-bottom:1px solid #f0f0f0;color:#888;font-size:0.8rem;">' + escapeHtml(ing.prep_note || '') + '</td></tr>';
        }
        block += '</table></div>';
      }

      if (dish.directions && dish.directions.length) {
        block += '<div style="margin:8px 0;"><div class="notes-label">Prep Method</div>';
        let stepNum = 0;
        for (const d of dish.directions) {
          if (d.type === 'section') {
            block += '<div style="font-weight:700;margin:8px 0 4px;border-bottom:1px solid #ddd;padding-bottom:2px;">' + escapeHtml(d.text) + '</div>';
          } else {
            stepNum++;
            block += '<div style="display:flex;gap:6px;margin-bottom:4px;font-size:0.85rem;"><span style="font-weight:700;color:#888;min-width:18px;">' + stepNum + '.</span><span>' + escapeHtml(d.text) + '</span></div>';
          }
        }
        block += '</div>';
      } else if (dish.chefs_notes) {
        block += '<div class="notes"><div class="notes-label">Chef\'s Notes</div>' + escapeHtml(dish.chefs_notes) + '</div>';
      }

      if (dish.service_directions && dish.service_directions.length) {
        block += '<div style="margin:8px 0;"><div class="notes-label">Service Process</div>';
        let stepNum = 0;
        for (const d of dish.service_directions) {
          if (d.type === 'section') {
            block += '<div style="font-weight:700;margin:8px 0 4px;border-bottom:1px solid #ddd;padding-bottom:2px;">' + escapeHtml(d.text) + '</div>';
          } else {
            stepNum++;
            block += '<div style="display:flex;gap:6px;margin-bottom:4px;font-size:0.85rem;"><span style="font-weight:700;color:#888;min-width:18px;">' + stepNum + '.</span><span>' + escapeHtml(d.text) + '</span></div>';
          }
        }
        block += '</div>';
      }

      if (dish.substitutions && dish.substitutions.length) {
        block += `<div class="subs"><strong>Subs:</strong> `;
        block += dish.substitutions.map(s =>
          `${escapeHtml(s.allergen)}: ${escapeHtml(s.original_ingredient)} &rarr; ${escapeHtml(s.substitute_ingredient)}${s.notes ? ' (' + escapeHtml(s.notes) + ')' : ''}`
        ).join('; ');
        block += `</div>`;
      }

      if (dish.service_notes) {
        block += `<div class="notes"><div class="notes-label">Service Notes</div>${escapeHtml(dish.service_notes)}</div>`;
      }

      block += `</div></div>`;
      return block;
    }

    if (hasCourses) {
      // Print by courses
      let courseNum = 1;
      for (const course of courses) {
        const courseDishes = (data.courseMap[course.id] || []);
        html += `<div class="course-header">${isCoursed ? `Course ${courseNum}: ` : ''}${escapeHtml(course.name)}</div>`;
        if (course.notes) {
          html += `<div class="course-notes">${escapeHtml(course.notes)}</div>`;
        }
        let dishNum = 1;
        for (const dish of courseDishes) {
          html += renderDishBlock(dish, `${isCoursed ? `Course ${courseNum}` : escapeHtml(course.name)} · Dish ${dishNum}`);
          dishNum++;
        }
        if (!courseDishes.length) {
          html += '<p style="color:#888;font-style:italic;margin:8px 0;">No dishes in this course</p>';
        }
        courseNum++;
      }

      // Unassigned dishes
      if (data.unassigned && data.unassigned.length) {
        html += '<div class="course-header">Other Dishes</div>';
        data.unassigned.forEach((dish, i) => {
          html += renderDishBlock(dish, `Dish ${i + 1}`);
        });
      }
    } else {
      // Original: sequential by sort order
      data.dishes.forEach((dish, i) => {
        html += renderDishBlock(dish, `Course ${i + 1}`);
      });
    }

    html += `</body></html>`;
    printSheet(html);
  } catch (err) {
    console.warn('Service sheet generation failed:', err);
    showToast('Could not generate service sheet. Please try again.', 'error');
  }
}

// ---- Temp Dish Edit Modal ----
async function showTempDishEditModal(dishId, menuId, ctx) {
  let dish;
  try {
    dish = await getDish(dishId);
  } catch (err) {
    showToast('Failed to load dish', 'error');
    return;
  }

  const currentAllergens = new Set(
    (dish.allergens || []).filter(a => a.source === 'manual').map(a => a.allergen)
  );
  const serviceDirections = dish.service_directions || [];
  const svcDirData = serviceDirections.map((d, i) => ({ ...d, sort_order: i }));

  function renderSvcDirRows() {
    return svcDirData.map((d, idx) => {
      if (d.type === 'section') {
        return `<div class="mb-temp-svcdir-row mb-temp-svcdir-section" data-idx="${idx}">
          <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
          <input type="text" class="input mb-temp-svcdir-label" value="${escapeHtml(d.text || '')}" placeholder="Section heading">
          <button type="button" class="btn btn-icon mb-temp-svcdir-remove" data-idx="${idx}" title="Remove">&times;</button>
        </div>`;
      }
      return `<div class="mb-temp-svcdir-row mb-temp-svcdir-step" data-idx="${idx}">
        <span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span>
        <textarea class="input mb-temp-svcdir-text" rows="2" placeholder="Service direction step">${escapeHtml(d.text || '')}</textarea>
        <button type="button" class="btn btn-icon mb-temp-svcdir-remove" data-idx="${idx}" title="Remove">&times;</button>
      </div>`;
    }).join('');
  }

  const modal = openModal(`Edit Temp Dish: ${escapeHtml(dish.name)}`, `
    <form id="temp-dish-form" class="form mb-temp-dish-form">
      <div class="form-group">
        <label for="temp-dish-name">Name</label>
        <input type="text" id="temp-dish-name" class="input" value="${escapeHtml(dish.name)}" required>
      </div>

      <div class="form-group">
        <label>Allergens</label>
        <div class="mb-temp-allergen-grid">
          ${ALLERGEN_LIST.map(a => `
            <button type="button" class="mb-temp-allergen-btn ${currentAllergens.has(a) ? 'active' : ''}" data-allergen="${a}">
              ${escapeHtml(capitalize(a))}
            </button>
          `).join('')}
        </div>
      </div>

      <div class="form-group">
        <label>Service Directions</label>
        <div id="temp-svcdir-list">${renderSvcDirRows()}</div>
        <div class="mb-temp-svcdir-actions">
          <button type="button" id="temp-svcdir-add-step" class="btn btn-sm">+ Step</button>
          <button type="button" id="temp-svcdir-add-section" class="btn btn-sm">+ Section</button>
        </div>
      </div>

      <div class="form-group">
        <label for="temp-dish-service-notes">Service Notes (FoH)</label>
        <textarea id="temp-dish-service-notes" class="input" rows="3" placeholder="Notes for front of house...">${escapeHtml(dish.service_notes || '')}</textarea>
      </div>

      <button type="submit" class="btn btn-primary" style="width:100%;">Save</button>
    </form>
  `);

  // Allergen toggle
  modal.querySelectorAll('.mb-temp-allergen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });

  // Service direction add/remove
  const svcDirList = modal.querySelector('#temp-svcdir-list');

  function refreshSvcDirList() {
    svcDirList.innerHTML = renderSvcDirRows();
    svcDirList.querySelectorAll('.mb-temp-svcdir-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        svcDirData.splice(parseInt(btn.dataset.idx), 1);
        refreshSvcDirList();
      });
    });
  }

  // Initial remove button wiring
  refreshSvcDirList();

  modal.querySelector('#temp-svcdir-add-step').addEventListener('click', () => {
    svcDirData.push({ type: 'step', text: '', sort_order: svcDirData.length });
    refreshSvcDirList();
    const rows = svcDirList.querySelectorAll('.mb-temp-svcdir-text');
    if (rows.length) rows[rows.length - 1].focus();
  });

  modal.querySelector('#temp-svcdir-add-section').addEventListener('click', () => {
    svcDirData.push({ type: 'section', text: '', sort_order: svcDirData.length });
    refreshSvcDirList();
    const rows = svcDirList.querySelectorAll('.mb-temp-svcdir-label');
    if (rows.length) rows[rows.length - 1].focus();
  });

  // Save
  modal.querySelector('#temp-dish-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = modal.querySelector('#temp-dish-name').value.trim();
    if (!name) return;

    // Collect service directions from current DOM
    const dirRows = svcDirList.querySelectorAll('.mb-temp-svcdir-row');
    const service_directions = Array.from(dirRows).map((row, idx) => {
      if (row.classList.contains('mb-temp-svcdir-section')) {
        const text = row.querySelector('.mb-temp-svcdir-label').value.trim();
        return text ? { type: 'section', text, sort_order: idx } : null;
      }
      const text = row.querySelector('.mb-temp-svcdir-text').value.trim();
      return text ? { type: 'step', text, sort_order: idx } : null;
    }).filter(Boolean);

    const service_notes = modal.querySelector('#temp-dish-service-notes').value;

    // Collect allergens
    const selectedAllergens = new Set();
    modal.querySelectorAll('.mb-temp-allergen-btn.active').forEach(btn => {
      selectedAllergens.add(btn.dataset.allergen);
    });

    try {
      // Update dish name, service notes, service directions
      await updateDish(dishId, { name, service_notes, service_directions });

      // Sync allergens: add new, remove old
      const promises = [];
      for (const a of ALLERGEN_LIST) {
        const wasSet = currentAllergens.has(a);
        const isSet = selectedAllergens.has(a);
        if (isSet && !wasSet) {
          promises.push(updateDishAllergen(dishId, { allergen: a, action: 'add' }));
        } else if (!isSet && wasSet) {
          promises.push(updateDishAllergen(dishId, { allergen: a, action: 'remove' }));
        }
      }
      await Promise.all(promises);

      ctx.menu = await getMenu(menuId);
      closeModal();
      showToast('Temp dish updated');
      ctx.render();
    } catch (err) {
      console.warn('Update temp dish failed:', err);
      showToast('Could not update dish. Please try again.', 'error');
    }
  });
}

// ---- Dish Picker ----
async function showDishPicker(menuId, ctx, targetCourseId) {
  const menu = ctx.menu;
  let allDishes;
  try {
    allDishes = await getDishes();
  } catch (err) {
    showToast('Failed to load dishes', 'error');
    return;
  }

  const existingIds = new Set(menu.dishes.map(d => d.id));
  const available = allDishes.filter(d => !existingIds.has(d.id));

  const modal = openModal('Add Dishes', `
    <div class="mb-quick-add">
      <input type="text" id="quick-add-name" class="input" placeholder="Quick add: type a name to add a temp dish">
      <button type="button" id="quick-add-btn" class="btn btn-sm btn-primary">+ Add Temp</button>
    </div>
    ${available.length ? `<input type="text" id="dish-picker-search" class="input" placeholder="Search existing dishes...">` : ''}
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

  // Quick-add dish handler
  const quickAddInput = modal.querySelector('#quick-add-name');
  const quickAddBtn = modal.querySelector('#quick-add-btn');

  async function quickAddDish() {
    const name = quickAddInput.value.trim();
    if (!name) return;
    quickAddBtn.disabled = true;
    quickAddBtn.textContent = 'Adding...';
    try {
      const dish = await createDish({ name, category: 'other', is_temporary: true });
      await addDishToMenu(menuId, { dish_id: dish.id, servings: 1, course_id: targetCourseId || null });
      quickAddInput.value = '';
      ctx.menu = await getMenu(menuId);
      showToast(`"${name}" added as temp dish`);
    } catch (err) {
      console.warn('Quick add dish failed:', err);
      showToast('Could not add dish. Please try again.', 'error');
    } finally {
      quickAddBtn.disabled = false;
      quickAddBtn.textContent = '+ Add Temp';
    }
  }

  quickAddBtn.addEventListener('click', quickAddDish);
  quickAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      quickAddDish();
    }
  });

  const searchInput = modal.querySelector('#dish-picker-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase();
      modal.querySelectorAll('.mb-picker-item').forEach(item => {
        const name = item.querySelector('strong').textContent.toLowerCase();
        item.style.display = name.includes(query) ? '' : 'none';
      });
    });
  }

  modal.querySelectorAll('.add-to-menu-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dishId = btn.dataset.id;
      try {
        await addDishToMenu(menuId, { dish_id: parseInt(dishId), servings: 1, course_id: targetCourseId || null });
        btn.textContent = 'Added';
        btn.disabled = true;
        btn.classList.remove('btn-primary');
        ctx.menu = await getMenu(menuId);
        showToast('Dish added');
      } catch (err) {
        console.warn('Add dish to menu failed:', err);
        showToast('Could not add dish. Please try again.', 'error');
      }
    });
  });

  const origClose = modal.querySelector('.modal-close');
  origClose.addEventListener('click', () => ctx.render(), { once: true });
}

// ---- Main Export ----

export async function renderMenuBuilder(container, menuId) {
  container.innerHTML = loadingHTML('Loading menu...');

  let menu;
  try {
    menu = await getMenu(menuId);
  } catch (err) {
    console.warn('Load menu failed:', err);
    container.innerHTML = '<div class="error">Could not load menu. Please try again.</div>';
    return;
  }

  // Shared context object allows extracted functions to read/write menu and trigger re-render
  const ctx = { menu, render };

  function render() {
    const state = parseMenuState(ctx.menu);
    container.innerHTML = buildMenuBuilderHTML(ctx.menu, state);

    // ---- Wire up events ----
    setupServiceStyleToggle(container, menuId, ctx);
    setupEditMenuModal(container, menuId, state.isHouse, ctx);
    setupScheduleDayToggles(container, menuId, state.isHouse, state.scheduleDays, ctx);
    setupAllergyToggles(container, menuId, ctx);
    setupHeaderActions(container, menuId, state.isHouse, ctx);
    setupServingsControls(container, menuId, ctx);
    setupDishNotes(container, menuId, ctx);
    setupDishRowActions(container, menuId, ctx);
    setupCourseManagement(container, menuId, state.courses, state.isCoursed, state.styleLabel, ctx);
    setupDragDrop(container, menuId, ctx);
  }

  // Real-time sync listeners
  const onMenuUpdate = async (e) => {
    if (e.detail && String(e.detail.id) === String(menuId)) {
      try {
        ctx.menu = await getMenu(menuId);
        render();
      } catch { /* ignore */ }
    }
  };
  window.addEventListener('sync:menu_updated', onMenuUpdate);
  const cleanup = () => {
    window.removeEventListener('sync:menu_updated', onMenuUpdate);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);

  render();
}
