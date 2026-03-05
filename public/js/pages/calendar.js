import { getMenus, createMenu, getCalendarEvents } from '../api.js';
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

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export async function renderCalendar(container) {
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let menus = [];
  let gcalEvents = [];
  let gcalConfigured = false;

  container.innerHTML = '<div class="loading">Loading calendar...</div>';

  async function loadMenus() {
    try {
      menus = await getMenus();
    } catch (err) {
      showToast('Failed to load menus', 'error');
      menus = [];
    }
  }

  async function loadGcalEvents() {
    try {
      const result = await getCalendarEvents();
      gcalConfigured = result.configured;
      gcalEvents = result.events || [];
    } catch {
      gcalEvents = [];
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

  function buildGcalMap() {
    const map = {};
    for (const evt of gcalEvents) {
      // Extract date from datetime or date string
      const dateStr = evt.start.slice(0, 10);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(evt);
    }
    return map;
  }

  function render() {
    const menuMap = buildMenuMap();
    const gcalMap = buildGcalMap();
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
      const dayGcal = gcalMap[dateStr] || [];
      const isPast = dateStr < todayStr;

      // Build list of linked gcal event IDs to avoid showing duplicate
      const linkedGcalIds = new Set();
      for (const m of dayMenus) {
        if (m.gcal_event_id) linkedGcalIds.add(m.gcal_event_id);
      }

      gridCells += `
        <div class="cal-cell ${isToday ? 'cal-cell--today' : ''} ${isPast ? 'cal-cell--past' : ''}" data-date="${dateStr}">
          <div class="cal-day-num">${day}</div>
          ${dayMenus.map(m => `
            <a href="#/menus/${m.id}" class="cal-event${m.gcal_event_id ? ' cal-event--linked' : ''}" title="${escapeHtml(m.name)}${m.dish_count ? ' (' + m.dish_count + ' dishes)' : ''}${m.gcal_event_id ? ' (from Google Calendar)' : ''}">
              ${escapeHtml(m.name)}
            </a>
          `).join('')}
          ${dayGcal.filter(e => !linkedGcalIds.has(e.id)).map(e => `
            <div class="cal-gcal-event" data-gcal-id="${escapeHtml(e.id)}" data-gcal-date="${dateStr}" title="${escapeHtml(e.summary)}${e.location ? ' — ' + escapeHtml(e.location) : ''}">
              <span class="cal-gcal-label">${escapeHtml(e.summary)}</span>
              <button class="cal-gcal-menu-btn" data-gcal-id="${escapeHtml(e.id)}" data-gcal-date="${dateStr}" title="Create menu from this event" aria-label="Create menu from ${escapeHtml(e.summary)}">+</button>
            </div>
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

    const gcalStatusHtml = gcalConfigured
      ? '<span class="cal-gcal-status cal-gcal-status--on" title="Google Calendar connected"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Google Calendar</span>'
      : '';

    container.innerHTML = `
      <div class="page-header">
        <h1>Calendar</h1>
        ${gcalStatusHtml}
      </div>
      ${houseMenu ? `<div class="cal-house-banner">House Menu: <a href="#/menus/${houseMenu.id}">${escapeHtml(houseMenu.name)}</a> <span class="text-muted">(${houseMenu.dish_count} dishes)</span></div>` : ''}
      <div class="cal-nav">
        <button class="btn btn-ghost" id="cal-prev" aria-label="Previous month">&larr;</button>
        <h2 class="cal-month-title">${escapeHtml(monthName(viewYear, viewMonth))}</h2>
        <button class="btn btn-ghost" id="cal-next" aria-label="Next month">&rarr;</button>
        <button class="btn btn-ghost cal-today-btn" id="cal-today-btn">Today</button>
        ${gcalConfigured ? `
          <button class="btn btn-ghost gc-sync-btn" id="gc-sync-btn" title="Sync Google Calendar" ${syncing ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${syncing ? 'gc-spinning' : ''}"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          </button>
        ` : ''}
      </div>
      ${gcalConfigured ? `<div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--menu"></span> Menu</span>
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--gcal"></span> Google Calendar</span>
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--linked"></span> Menu from event</span>
      </div>` : ''}
      <div class="cal-grid">
        ${dayNames.map(d => `<div class="cal-header">${d}</div>`).join('')}
        ${gridCells}
      </div>
    `;

    // Navigation
    container.querySelector('#cal-prev').addEventListener('click', async () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      await loadGcalEvents();
      render();
    });
    container.querySelector('#cal-next').addEventListener('click', async () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      await loadGcalEvents();
      render();
    });
    container.querySelector('#cal-today-btn').addEventListener('click', async () => {
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
      await loadGcalEvents();
      render();
    });

    // Sync button
    const syncBtn = container.querySelector('#gc-sync-btn');
    if (syncBtn) {
      syncBtn.addEventListener('click', async () => {
        syncing = true;
        render();
        try {
          const result = await syncGoogleCalendar();
          showToast(`Synced: ${result.added} new, ${result.updated} updated, ${result.removed} removed`);
          await loadGcalEvents();
        } catch (err) {
          showToast(err.message || 'Sync failed', 'error');
        } finally {
          syncing = false;
          render();
        }
      });
    }

    // Create menu from Google event buttons
    container.querySelectorAll('.gc-create-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const eventId = btn.dataset.eventId;
        btn.disabled = true;
        btn.textContent = '...';
        try {
          const result = await createMenuFromGoogleEvent(eventId);
          showToast('Menu created from event');
          window.location.hash = `#/menus/${result.menuId}`;
        } catch (err) {
          showToast(err.message || 'Failed to create menu', 'error');
          btn.disabled = false;
          btn.textContent = '+';
        }
      });
    });

    // Click empty date to create menu
    container.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', (e) => {
        // Don't trigger if clicking an event link, gcal event, or button
        if (e.target.closest('.cal-event') || e.target.closest('.cal-gcal-event') || e.target.closest('.cal-gcal-menu-btn')) return;
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

    // Google Calendar "Create Menu" buttons
    container.querySelectorAll('.cal-gcal-menu-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gcalId = btn.dataset.gcalId;
        const dateStr = btn.dataset.gcalDate;
        const evt = gcalEvents.find(ev => ev.id === gcalId);
        if (evt) {
          openNewMenuModal(dateStr, evt);
        }
      });
    });
  }

  function openNewMenuModal(prefillDate, gcalEvent) {
    const prefillName = gcalEvent ? gcalEvent.summary : '';
    const prefillDesc = gcalEvent ? gcalEvent.description : '';
    const gcalId = gcalEvent ? gcalEvent.id : '';

    const modal = openModal('New Event Menu', `
      <form id="cal-new-menu-form" class="form">
        ${gcalEvent ? `<div class="cal-gcal-source-badge">Creating from Google Calendar event</div>` : ''}
        <div class="form-group">
          <label for="cal-menu-name">Menu Name *</label>
          <input type="text" id="cal-menu-name" class="input" required placeholder="e.g., Wedding Reception" value="${escapeHtml(prefillName)}">
        </div>
        <div class="form-group">
          <label for="cal-menu-desc">Description</label>
          <textarea id="cal-menu-desc" class="input" rows="2" placeholder="Optional description...">${escapeHtml(prefillDesc)}</textarea>
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
        <input type="hidden" id="cal-gcal-event-id" value="${escapeHtml(gcalId)}">
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
          gcal_event_id: modal.querySelector('#cal-gcal-event-id').value || null,
        });
        closeModal(modal);
        showToast('Menu created');
        window.location.hash = `#/menus/${result.id}`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  await Promise.all([loadMenus(), loadGcalEvents()]);
  render();

  // Real-time sync
  const syncHandler = async () => {
    await loadMenus();
    await loadGcalEvents();
    render();
  };
  const syncEvents = ['sync:menu_created', 'sync:menu_updated', 'sync:menu_deleted', 'sync:gcal_synced', 'sync:gcal_menu_linked'];
  for (const evt of syncEvents) window.addEventListener(evt, syncHandler);
  const cleanup = () => {
    for (const evt of syncEvents) window.removeEventListener(evt, syncHandler);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
