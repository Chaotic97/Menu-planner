import { getSpecials, createSpecial, updateSpecial, deleteSpecial, getDishes } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { escapeHtml } from '../utils/escapeHtml.js';

// Helper: get Monday of current week
function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().split('T')[0];
}

// Helper: get Sunday of a week given its Monday
function getSunday(mondayStr) {
  const d = new Date(mondayStr);
  d.setDate(d.getDate() + 6);
  return d.toISOString().split('T')[0];
}

// Helper: format date range nicely
function formatWeek(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} - ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

// Helper: get week offset label
function weekLabel(start) {
  const today = new Date();
  const thisMonday = getMonday(today);
  const diffDays = Math.round((new Date(start) - new Date(thisMonday)) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'This Week';
  if (diffDays === 7) return 'Next Week';
  if (diffDays === -7) return 'Last Week';
  return '';
}

export async function renderSpecials(container) {
  const currentMonday = getMonday(new Date());

  container.innerHTML = `
    <div class="page-header">
      <h1>Weekly Specials</h1>
      <div class="header-actions">
        <button id="add-special-btn" class="btn btn-primary">+ Add Special</button>
        <span id="specials-overflow"></span>
      </div>
    </div>

    <div class="specials-week-nav">
      <button id="prev-week" class="btn btn-icon">&larr;</button>
      <div class="specials-week-display">
        <span id="week-label" class="week-label-badge">This Week</span>
        <span id="week-range"></span>
      </div>
      <button id="next-week" class="btn btn-icon">&rarr;</button>
      <button id="today-btn" class="btn btn-sm btn-secondary">Today</button>
    </div>

    <div id="specials-list">
      <div class="loading">Loading specials...</div>
    </div>
  `;

  let viewMonday = currentMonday;

  const listEl = container.querySelector('#specials-list');

  function updateWeekDisplay() {
    const sunday = getSunday(viewMonday);
    container.querySelector('#week-range').textContent = formatWeek(viewMonday, sunday);
    const label = weekLabel(viewMonday);
    const labelEl = container.querySelector('#week-label');
    labelEl.textContent = label;
    labelEl.style.display = label ? '' : 'none';
  }

  async function loadSpecials() {
    updateWeekDisplay();

    try {
      const specials = await getSpecials({ week: viewMonday });

      if (!specials.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <p>No specials for this week.</p>
            <button class="btn btn-primary add-special-empty">+ Add a Special</button>
          </div>
        `;
        listEl.querySelector('.add-special-empty')?.addEventListener('click', showAddSpecial);
        return;
      }

      listEl.innerHTML = specials.map(s => `
        <div class="special-card ${!s.is_active ? 'special-inactive' : ''}" data-id="${s.id}">
          <div class="special-image">
            ${s.photo_path
              ? `<img src="${escapeHtml(s.photo_path)}" alt="${escapeHtml(s.dish_name)}">`
              : '<div class="no-image"><span>No Photo</span></div>'
            }
          </div>
          <div class="special-body">
            <div class="special-header">
              <span class="category-badge">${escapeHtml(s.category)}</span>
              ${!s.is_active ? '<span class="special-tag inactive">Inactive</span>' : ''}
            </div>
            <h3><a href="#/dishes/${s.dish_id}" class="dish-name-link">${escapeHtml(s.dish_name)}</a></h3>
            ${s.dish_description ? `<p class="card-desc">${escapeHtml(s.dish_description)}</p>` : ''}
            ${s.notes ? `<p class="special-notes">"${escapeHtml(s.notes)}"</p>` : ''}
            ${renderAllergenBadges(s.allergens, true)}
            ${s.suggested_price ? `<div class="card-price">$${Number(s.suggested_price).toFixed(2)}</div>` : ''}
            <div class="special-dates">${formatWeek(s.week_start, s.week_end)}</div>
          </div>
          <div class="special-actions">
            <button class="btn btn-sm toggle-special" data-id="${s.id}" data-active="${s.is_active}">
              ${s.is_active ? 'Deactivate' : 'Activate'}
            </button>
            <button class="btn btn-sm btn-danger delete-special" data-id="${s.id}">Remove</button>
          </div>
        </div>
      `).join('');

      // Toggle active
      listEl.querySelectorAll('.toggle-special').forEach(btn => {
        btn.addEventListener('click', async () => {
          const isActive = btn.dataset.active === '1';
          try {
            await updateSpecial(btn.dataset.id, { is_active: !isActive });
            showToast(isActive ? 'Special deactivated' : 'Special activated');
            loadSpecials();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      // Delete
      listEl.querySelectorAll('.delete-special').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await deleteSpecial(btn.dataset.id);
            showToast('Special removed', 'info');
            loadSpecials();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

    } catch (err) {
      listEl.innerHTML = `<div class="error">Failed to load specials: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Week navigation
  container.querySelector('#prev-week').addEventListener('click', () => {
    const d = new Date(viewMonday);
    d.setDate(d.getDate() - 7);
    viewMonday = d.toISOString().split('T')[0];
    loadSpecials();
  });

  container.querySelector('#next-week').addEventListener('click', () => {
    const d = new Date(viewMonday);
    d.setDate(d.getDate() + 7);
    viewMonday = d.toISOString().split('T')[0];
    loadSpecials();
  });

  container.querySelector('#today-btn').addEventListener('click', () => {
    viewMonday = currentMonday;
    loadSpecials();
  });

  // Export specials as .docx
  // Specials overflow menu (Export .docx)
  const specialsOverflow = container.querySelector('#specials-overflow');
  if (specialsOverflow) {
    const overflowMenu = createActionMenu([
      { label: 'Export .docx', icon: '📄', onClick: async () => {
        try {
          const resp = await fetch(`/api/menus/specials/export-docx?week=${viewMonday}`, { credentials: 'same-origin' });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: 'Export failed' }));
            showToast(err.error || 'Export failed', 'error');
            return;
          }
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `specials-${viewMonday}.docx`;
          a.click();
          URL.revokeObjectURL(url);
          showToast('Specials exported');
        } catch {
          showToast('Export failed', 'error');
        }
      }},
    ]);
    specialsOverflow.appendChild(overflowMenu);
  }

  // Add special
  container.querySelector('#add-special-btn').addEventListener('click', showAddSpecial);

  async function showAddSpecial() {
    let allDishes;
    try {
      allDishes = await getDishes();
    } catch {
      showToast('Failed to load dishes', 'error');
      return;
    }

    const nextSunday = getSunday(viewMonday);

    const modal = openModal('Add Weekly Special', `
      <form id="add-special-form" class="form">
        <div class="form-group">
          <label>Select Dish *</label>
          <input type="text" id="special-dish-search" class="input" placeholder="Search dishes...">
          <div class="dish-picker-list" id="special-dish-list">
            ${allDishes.map(d => `
              <label class="special-dish-option" data-name="${escapeHtml(d.name.toLowerCase())}">
                <input type="radio" name="special_dish" value="${d.id}">
                <span class="special-dish-label">
                  <strong>${escapeHtml(d.name)}</strong>
                  <span class="category-badge">${escapeHtml(d.category)}</span>
                </span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="special-start">Week Start</label>
            <input type="date" id="special-start" class="input" value="${viewMonday}">
          </div>
          <div class="form-group">
            <label for="special-end">Week End</label>
            <input type="date" id="special-end" class="input" value="${nextSunday}">
          </div>
        </div>
        <div class="form-group">
          <label for="special-notes">Notes (shown on menu)</label>
          <input type="text" id="special-notes" class="input" placeholder="e.g., Chef's signature dish, seasonal highlight">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Add Special</button>
        </div>
      </form>
    `);

    // Search filter for dishes
    const searchInput = modal.querySelector('#special-dish-search');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      modal.querySelectorAll('.special-dish-option').forEach(opt => {
        opt.style.display = opt.dataset.name.includes(q) ? '' : 'none';
      });
    });

    // Auto-set end date when start changes
    modal.querySelector('#special-start').addEventListener('change', (e) => {
      modal.querySelector('#special-end').value = getSunday(e.target.value);
    });

    modal.querySelector('#add-special-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const selected = modal.querySelector('input[name="special_dish"]:checked');
      if (!selected) {
        showToast('Please select a dish', 'error');
        return;
      }

      try {
        await createSpecial({
          dish_id: parseInt(selected.value),
          week_start: modal.querySelector('#special-start').value,
          week_end: modal.querySelector('#special-end').value,
          notes: modal.querySelector('#special-notes').value.trim(),
        });
        closeModal(modal);
        showToast('Special added');
        loadSpecials();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  loadSpecials();
}
