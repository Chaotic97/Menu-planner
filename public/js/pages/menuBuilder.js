import { getMenu, updateMenu, getDishes, createDish, addDishToMenu, removeDishFromMenu, updateMenuDish, getScaledShoppingList, reorderMenuDishes, getMenuKitchenPrint, generateTasks, createCourse, updateCourse, deleteCourse, reorderCourses, applyCoursesTemplate } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { openLightbox } from '../components/lightbox.js';
import { createActionMenu } from '../components/actionMenu.js';
import { makeCollapsible, collapsibleHeader } from '../components/collapsible.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { ALLERGEN_LIST, CATEGORY_ORDER, capitalize } from '../data/allergens.js';
import { printSheet } from '../utils/printSheet.js';

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
    const guestAllergies = menu.guest_allergies
      ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
      : [];

    let scheduleDays = [];
    try { scheduleDays = JSON.parse(menu.schedule_days || '[]'); } catch {}

    let allergenCovers = {};
    try { allergenCovers = JSON.parse(menu.allergen_covers || '{}'); } catch {}

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

    container.innerHTML = `
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

    // ---- Wire up events ----

    // Service style toggle
    container.querySelectorAll('.mc-style-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newStyle = btn.dataset.style;
        if (newStyle === serviceStyle) return;
        try {
          await updateMenu(menuId, { service_style: newStyle });
          menu = await getMenu(menuId);
          render();
          showToast(`Switched to ${newStyle === 'coursed' ? 'coursed' : 'à la carte'} mode`);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Edit menu details
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
          menu = await getMenu(menuId);
          closeModal(modal);
          showToast('Menu updated');
          render();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Wire up schedule day toggles (house menu only)
    if (isHouse) {
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
    }

    // Per-dish day toggles (house menu only)
    if (isHouse) container.querySelectorAll('.mb-dish-day-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => String(d.id) === String(dishId));
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
    container.querySelector('#prepare-week-btn')?.addEventListener('click', showPrepareWeek);

    // Guest allergy toggles + cover counts
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
        menu.guest_allergies = newVal;
        menu.allergen_covers = JSON.stringify(newCovers);
        menu = await getMenu(menuId);
        render();
        showToast('Guest allergies updated');
      } catch (err) {
        showToast('Failed to update', 'error');
      }
    }

    // Add dish buttons
    container.querySelector('#add-dish-btn')?.addEventListener('click', () => showDishPicker());
    container.querySelector('#add-dish-empty')?.addEventListener('click', () => showDishPicker());

    // Per-course "Add Dish" buttons
    container.querySelectorAll('.mc-course-add-dish').forEach(btn => {
      btn.addEventListener('click', () => {
        showDishPicker(parseInt(btn.dataset.courseId));
      });
    });

    // Header overflow menu
    const mbOverflowSlot = container.querySelector('#mb-overflow-menu');
    if (mbOverflowSlot) {
      const overflowItems = [
        { label: 'Print Kitchen Sheet', icon: '🖨', onClick: showKitchenPrint },
        { label: 'Scale for Event', icon: '⚖', onClick: showScaleModal },
        { label: 'View Tasks', icon: '✓', onClick: () => { window.location.hash = '#/todos'; } },
      ];
      if (isHouse) {
        overflowItems.push({ label: 'Convert to Event Menu', icon: '📅', onClick: async () => {
          try {
            await updateMenu(menuId, { menu_type: 'event' });
            menu = await getMenu(menuId);
            showToast('Converted to event menu');
            render();
          } catch (err) { showToast(err.message, 'error'); }
        }});
      } else {
        overflowItems.push({ label: 'Set as House Menu', icon: '⭐', onClick: async () => {
          try {
            await updateMenu(menuId, { menu_type: 'standard' });
            menu = await getMenu(menuId);
            showToast('Set as house menu');
            render();
          } catch (err) { showToast(err.message, 'error'); }
        }});
      }
      mbOverflowSlot.appendChild(createActionMenu(overflowItems));
    }

    // Collapsible allergy section
    makeCollapsible(container.querySelector('#mb-allergy-section'), { open: false, storageKey: 'mb_allergy_section' });

    // Photo lightbox
    container.querySelectorAll('.mb-dish-thumb img').forEach(img => {
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(img.src, img.alt);
      });
    });

    // Servings controls — inc/dec buttons
    container.querySelectorAll('.servings-inc').forEach(btn => {
      btn.addEventListener('click', async () => {
        const dishId = btn.dataset.dish;
        const dish = menu.dishes.find(d => String(d.id) === String(dishId));
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
        const dish = menu.dishes.find(d => String(d.id) === String(dishId));
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
            menu = await getMenu(menuId);
            render();
          } catch (err) {
            showToast(err.message || 'Failed to update', 'error');
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
            menu = await getMenu(menuId);
            showToast(`${neededBatches} batch${neededBatches !== 1 ? 'es' : ''} = ${neededBatches * batchYield} portions`);
            render();
          } catch (err) {
            showToast(err.message || 'Failed to update', 'error');
          }
        }, 600);
      });
    });

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
            const dish = menu.dishes.find(d => String(d.id) === String(dishId));
            if (dish) dish.menu_dish_notes = textarea.value;
            showToast('Note saved');
          } catch (err) {
            showToast('Failed to save note', 'error');
          }
        }, 600);
      });
    });

    // Dish row action menus
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

    // Course action menus (edit name, add notes, delete)
    container.querySelectorAll('.mc-course-actions[data-course-id]').forEach(slot => {
      const courseId = parseInt(slot.dataset.courseId);
      const course = courses.find(c => c.id === courseId);
      if (!course) return;
      const trigger = createActionMenu([
        { label: 'Edit Name', icon: '✏️', onClick: () => showEditCourse(courseId, course.name, course.notes) },
        { label: `Delete ${styleLabel}`, icon: '✕', danger: true, onClick: async () => {
          try {
            await deleteCourse(menuId, courseId);
            menu = await getMenu(menuId);
            showToast(`${styleLabel} deleted`);
            render();
          } catch (err) {
            showToast(err.message, 'error');
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
          menu = await getMenu(menuId);
          closeModal(modal);
          showToast(`${styleLabel} added`);
          render();
        } catch (err) {
          showToast(err.message, 'error');
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
          menu = await getMenu(menuId);
          showToast(`Applied ${template} template`);
          render();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message, 'error');
        }
      });
    });

    // Drag and drop
    setupDragDrop();
  }

  function renderDishRow(dish, isHouse, scheduleDays) {
    const hasConflict = dish.allergy_conflicts && dish.allergy_conflicts.length > 0;
    let dishActiveDays = null;
    try { dishActiveDays = dish.active_days ? JSON.parse(dish.active_days) : null; } catch {}
    const hasNote = dish.menu_dish_notes && dish.menu_dish_notes.trim();
    return `
      <div class="mb-dish-row ${hasConflict ? 'allergy-conflict' : ''}" data-dish-id="${dish.id}" data-course-id="${dish.course_id || ''}" draggable="true">
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
          ${hasConflict ? `<div class="mb-allergy-warning">&#9888; Guest allergy: ${escapeHtml(dish.allergy_conflicts.join(', '))}</div>` : ''}
          ${dish.substitution_count > 0 ? `<span class="subs-badge" data-dish-id="${dish.id}" title="Has allergen substitutions">&#8644; ${dish.substitution_count} sub${dish.substitution_count > 1 ? 's' : ''}</span>` : ''}
          ${isHouse && scheduleDays.length ? `
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

  function showEditCourse(courseId, currentName, currentNotes) {
    const serviceStyle = menu.service_style || 'alacarte';
    const label = serviceStyle === 'coursed' ? 'Course' : 'Section';
    const modal = openModal(`Edit ${label}`, `
      <form id="edit-course-form" class="form">
        <div class="form-group">
          <label for="edit-course-name">${label} Name *</label>
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
        menu = await getMenu(menuId);
        closeModal(modal);
        showToast(`${label} updated`);
        render();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ---- Drag and Drop ----
  function setupDragDrop() {
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
        const fromIndex = menu.dishes.findIndex(d => String(d.id) === String(draggedId));
        const toIndex = menu.dishes.findIndex(d => String(d.id) === String(targetId));
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = menu.dishes.splice(fromIndex, 1);
        moved.course_id = targetCourseId ? parseInt(targetCourseId) : null;
        menu.dishes.splice(toIndex, 0, moved);

        const order = menu.dishes.map((d, i) => ({
          dish_id: d.id,
          sort_order: i,
          course_id: d.course_id === undefined ? undefined : (d.course_id || null)
        }));
        try {
          await reorderMenuDishes(menuId, order);
          menu = await getMenu(menuId);
          render();
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
        const dish = menu.dishes.find(d => String(d.id) === String(draggedId));
        if (!dish) return;

        try {
          await updateMenuDish(menuId, draggedId, { course_id: targetCourseId });
          menu = await getMenu(menuId);
          render();
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

        const courses = menu.courses || [];
        const fromIdx = courses.findIndex(c => String(c.id) === String(draggedId));
        const toIdx = courses.findIndex(c => String(c.id) === String(targetCourseId));
        if (fromIdx === -1 || toIdx === -1) return;

        const [moved] = courses.splice(fromIdx, 1);
        courses.splice(toIdx, 0, moved);

        const order = courses.map((c, i) => ({ course_id: c.id, sort_order: i }));
        try {
          await reorderCourses(menuId, order);
          menu = await getMenu(menuId);
          render();
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
        const fromIndex = menu.dishes.findIndex(d => String(d.id) === String(touchDragId));

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
      showToast('Failed to generate service sheet: ' + err.message, 'error');
    }
  }

  // ---- Dish Picker ----
  async function showDishPicker(targetCourseId) {
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
      <div class="mb-quick-add">
        <input type="text" id="quick-add-name" class="input" placeholder="Quick add: type a dish name and press Enter">
        <button type="button" id="quick-add-btn" class="btn btn-sm btn-primary">+ Add</button>
      </div>
      <input type="text" id="dish-picker-search" class="input" placeholder="Search existing dishes...">
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
        const dish = await createDish({ name, category: 'other' });
        await addDishToMenu(menuId, { dish_id: dish.id, servings: 1, course_id: targetCourseId || null });
        quickAddInput.value = '';
        menu = await getMenu(menuId);
        showToast(`"${name}" created and added`);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        quickAddBtn.disabled = false;
        quickAddBtn.textContent = '+ Add';
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
          await addDishToMenu(menuId, { dish_id: parseInt(dishId), servings: 1, course_id: targetCourseId || null });
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
    if (e.detail && String(e.detail.id) === String(menuId)) {
      try {
        menu = await getMenu(menuId);
        render();
      } catch {}
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
