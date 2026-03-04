import { getMenus, createMenu } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function monthName(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}

export async function renderCalendar(container) {
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let menus = [];

  container.innerHTML = '<div class="loading">Loading calendar...</div>';

  async function loadMenus() {
    try {
      menus = await getMenus();
    } catch (err) {
      showToast('Failed to load menus', 'error');
      menus = [];
    }
  }

  function buildMenuMap() {
    const map = {};
    for (const m of menus) {
      if (m.event_date) {
        if (!map[m.event_date]) map[m.event_date] = [];
        map[m.event_date].push(m);
      }
    }
    return map;
  }

  function render() {
    const menuMap = buildMenuMap();
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
    const todayStr = toDateStr(today);

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let gridCells = '';

    // Leading empty cells
    for (let i = 0; i < firstDay; i++) {
      gridCells += '<div class="cal-cell cal-cell--empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayMenus = menuMap[dateStr] || [];
      const isPast = dateStr < todayStr;

      gridCells += `
        <div class="cal-cell ${isToday ? 'cal-cell--today' : ''} ${isPast ? 'cal-cell--past' : ''}" data-date="${dateStr}">
          <div class="cal-day-num">${day}</div>
          ${dayMenus.map(m => `
            <a href="#/menus/${m.id}" class="cal-event" title="${escapeHtml(m.name)}${m.dish_count ? ' (' + m.dish_count + ' dishes)' : ''}">
              ${escapeHtml(m.name)}
            </a>
          `).join('')}
        </div>
      `;
    }

    // Trailing empty cells
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) {
      gridCells += '<div class="cal-cell cal-cell--empty"></div>';
    }

    // House menu indicator
    const houseMenu = menus.find(m => m.menu_type === 'standard');

    container.innerHTML = `
      <div class="page-header">
        <h1>Calendar</h1>
      </div>
      ${houseMenu ? `<div class="cal-house-banner">House Menu: <a href="#/menus/${houseMenu.id}">${escapeHtml(houseMenu.name)}</a> <span class="text-muted">(${houseMenu.dish_count} dishes)</span></div>` : ''}
      <div class="cal-nav">
        <button class="btn btn-ghost" id="cal-prev" aria-label="Previous month">&larr;</button>
        <h2 class="cal-month-title">${escapeHtml(monthName(viewYear, viewMonth))}</h2>
        <button class="btn btn-ghost" id="cal-next" aria-label="Next month">&rarr;</button>
        <button class="btn btn-ghost cal-today-btn" id="cal-today-btn">Today</button>
      </div>
      <div class="cal-grid">
        ${dayNames.map(d => `<div class="cal-header">${d}</div>`).join('')}
        ${gridCells}
      </div>
    `;

    // Navigation
    container.querySelector('#cal-prev').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      render();
    });
    container.querySelector('#cal-next').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      render();
    });
    container.querySelector('#cal-today-btn').addEventListener('click', () => {
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
      render();
    });

    // Click empty date to create menu
    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', (e) => {
        // Don't trigger if clicking an event link
        if (e.target.closest('.cal-event')) return;
        const dateStr = cell.dataset.date;
        const dayMenus = menuMap[dateStr] || [];
        // If there's exactly one menu, navigate to it
        if (dayMenus.length === 1) {
          window.location.hash = `#/menus/${dayMenus[0].id}`;
          return;
        }
        // If no menus, open new menu modal with date pre-filled
        if (dayMenus.length === 0) {
          openNewMenuModal(dateStr);
        }
        // If multiple menus on same date, do nothing (user can click the links)
      });
    });

    // Prevent event link clicks from bubbling to cell click
    container.querySelectorAll('.cal-event').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });
  }

  function openNewMenuModal(prefillDate) {
    const modal = openModal('New Event Menu', `
      <form id="cal-new-menu-form" class="form">
        <div class="form-group">
          <label for="cal-menu-name">Menu Name *</label>
          <input type="text" id="cal-menu-name" class="input" required placeholder="e.g., Wedding Reception">
        </div>
        <div class="form-group">
          <label for="cal-menu-desc">Description</label>
          <textarea id="cal-menu-desc" class="input" rows="2" placeholder="Optional description..."></textarea>
        </div>
        <div class="form-group">
          <label for="cal-menu-date">Event Date</label>
          <input type="date" id="cal-menu-date" class="input" value="${prefillDate || ''}">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="cal-menu-price">Sell Price ($)</label>
            <input type="number" id="cal-menu-price" class="input" step="0.01" min="0" placeholder="e.g., 120.00">
          </div>
          <div class="form-group">
            <label for="cal-menu-covers">Expected Covers</label>
            <input type="number" id="cal-menu-covers" class="input" min="0" placeholder="e.g., 50">
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create Menu</button>
        </div>
      </form>
    `);

    modal.querySelector('#cal-new-menu-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = modal.querySelector('#cal-menu-name').value.trim();
      if (!name) return;

      try {
        const result = await createMenu({
          name,
          description: modal.querySelector('#cal-menu-desc').value.trim(),
          sell_price: parseFloat(modal.querySelector('#cal-menu-price').value) || 0,
          expected_covers: parseInt(modal.querySelector('#cal-menu-covers').value) || 0,
          event_date: modal.querySelector('#cal-menu-date').value || null,
          menu_type: 'event',
        });
        closeModal(modal);
        showToast('Menu created');
        window.location.hash = `#/menus/${result.id}`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  await loadMenus();
  render();

  // Real-time sync
  const syncHandler = async () => {
    await loadMenus();
    render();
  };
  const syncEvents = ['sync:menu_created', 'sync:menu_updated', 'sync:menu_deleted'];
  for (const evt of syncEvents) window.addEventListener(evt, syncHandler);
  const cleanup = () => {
    for (const evt of syncEvents) window.removeEventListener(evt, syncHandler);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
