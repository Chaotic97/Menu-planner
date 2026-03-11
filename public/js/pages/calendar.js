import { getMenus, createMenu, getCalendarEvents, refreshCalendarEvents } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { loadingHTML } from '../utils/loadingState.js';

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

function dayOfWeekName(year, month, day) {
  return new Date(year, month, day).toLocaleDateString(undefined, { weekday: 'short' });
}

export async function renderCalendar(container) {
  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let menus = [];
  let gcalEvents = [];
  let gcalConfigured = false;

  const defaultView = window.innerWidth <= 480 ? 'list' : 'month';
  let currentView = localStorage.getItem('calendarView') || defaultView;

  container.innerHTML = loadingHTML('Loading calendar...');

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
      const dateStr = evt.start.slice(0, 10);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(evt);
    }
    return map;
  }

  function renderShell() {
    const houseMenu = menus.find(m => m.menu_type === 'standard');

    const gcalStatusHtml = gcalConfigured
      ? '<button class="cal-gcal-status cal-gcal-status--on" id="cal-refresh-gcal" title="Refresh Google Calendar"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg> Google Calendar</button>'
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
        <div class="cal-view-toggle">
          <button class="btn btn-ghost cal-view-btn ${currentView === 'month' ? 'cal-view-btn--active' : ''}" data-view="month" aria-label="Month view">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="10"/><line x1="15" y1="4" x2="15" y2="10"/></svg>
            Month
          </button>
          <button class="btn btn-ghost cal-view-btn ${currentView === 'list' ? 'cal-view-btn--active' : ''}" data-view="list" aria-label="List view">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>
            List
          </button>
        </div>
      </div>
      ${gcalConfigured ? `<div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--menu"></span> Menu</span>
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--gcal"></span> Google Calendar</span>
        <span class="cal-legend-item"><span class="cal-legend-dot cal-legend-dot--linked"></span> Menu from event</span>
      </div>` : ''}
      <div class="cal-grid-wrapper">
        <div class="cal-content"></div>
      </div>
    `;

    // Nav listeners — attached once
    container.querySelector('#cal-prev').addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      updateMonthTitle();
      renderContent('right');
    });
    container.querySelector('#cal-next').addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      updateMonthTitle();
      renderContent('left');
    });
    container.querySelector('#cal-today-btn').addEventListener('click', () => {
      const wasForward = viewYear > today.getFullYear() ||
        (viewYear === today.getFullYear() && viewMonth > today.getMonth());
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
      updateMonthTitle();
      renderContent(wasForward ? 'right' : 'left');
    });

    // View toggle listeners
    container.querySelectorAll('.cal-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newView = btn.dataset.view;
        if (newView === currentView) return;
        currentView = newView;
        localStorage.setItem('calendarView', currentView);
        container.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('cal-view-btn--active'));
        btn.classList.add('cal-view-btn--active');
        renderContent(null);
      });
    });

    // Google Calendar refresh
    const refreshBtn = container.querySelector('#cal-refresh-gcal');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.classList.add('cal-gcal-status--loading');
        try {
          const result = await refreshCalendarEvents();
          gcalEvents = result.events || [];
          renderContent(null);
          showToast('Calendar refreshed');
        } catch {
          showToast('Could not refresh calendar', 'error');
        }
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('cal-gcal-status--loading');
      });
    }

    // Swipe navigation
    setupSwipe(container.querySelector('.cal-grid-wrapper'));
  }

  function updateMonthTitle() {
    const titleEl = container.querySelector('.cal-month-title');
    if (titleEl) titleEl.textContent = monthName(viewYear, viewMonth);
  }

  function renderContent(direction) {
    const contentEl = container.querySelector('.cal-content');
    if (!contentEl) return;

    if (direction) {
      const animClass = direction === 'left' ? 'cal-slide-left' : 'cal-slide-right';
      contentEl.classList.add(animClass);
      const onEnd = () => {
        contentEl.classList.remove(animClass);
        contentEl.removeEventListener('animationend', onEnd);
      };
      contentEl.addEventListener('animationend', onEnd);
      // Fallback removal
      setTimeout(() => contentEl.classList.remove(animClass), 350);
    }

    if (currentView === 'month') {
      renderMonth(contentEl);
    } else {
      renderList(contentEl);
    }
  }

  function renderMonth(contentEl) {
    const menuMap = buildMenuMap();
    const gcalMap = buildGcalMap();
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
    const todayStr = toDateStr(today);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MAX_VISIBLE = 2;

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

      // Build maps for linked gcal events
      const linkedGcalIds = new Set();
      const gcalToMenu = {};
      for (const m of dayMenus) {
        if (m.gcal_event_id) {
          linkedGcalIds.add(m.gcal_event_id);
          gcalToMenu[m.gcal_event_id] = m;
        }
      }

      const standaloneMenus = dayMenus.filter(m => !m.gcal_event_id);

      // Build all event HTML snippets
      const allEventHtmls = [];

      for (const m of standaloneMenus) {
        allEventHtmls.push(`<a href="#/menus/${m.id}" class="cal-event" title="${escapeHtml(m.name)}${m.dish_count ? ' (' + m.dish_count + ' dishes)' : ''}">${escapeHtml(m.name)}</a>`);
      }

      for (const e of dayGcal) {
        const linkedMenu = gcalToMenu[e.id];
        if (linkedMenu) {
          allEventHtmls.push(`<a href="#/menus/${linkedMenu.id}" class="cal-gcal-event cal-gcal-event--linked" title="${escapeHtml(e.summary)} — ${escapeHtml(linkedMenu.name)}${linkedMenu.dish_count ? ' (' + linkedMenu.dish_count + ' dishes)' : ''}"><span class="cal-gcal-label">${escapeHtml(e.summary)}</span></a>`);
        } else {
          allEventHtmls.push(`<div class="cal-gcal-event" data-gcal-id="${escapeHtml(e.id)}" data-gcal-date="${dateStr}" title="${escapeHtml(e.summary)}${e.location ? ' — ' + escapeHtml(e.location) : ''}"><span class="cal-gcal-label">${escapeHtml(e.summary)}</span><button class="cal-gcal-menu-btn" data-gcal-id="${escapeHtml(e.id)}" data-gcal-date="${dateStr}" title="Create menu from this event" aria-label="Create menu from ${escapeHtml(e.summary)}">+</button></div>`);
        }
      }

      const visibleHtmls = allEventHtmls.slice(0, MAX_VISIBLE);
      const overflowCount = allEventHtmls.length - MAX_VISIBLE;

      gridCells += `
        <div class="cal-cell ${isToday ? 'cal-cell--today' : ''} ${isPast ? 'cal-cell--past' : ''}" data-date="${dateStr}">
          <div class="cal-day-num ${isToday ? 'cal-day-num--today' : ''}">${day}</div>
          ${visibleHtmls.join('')}
          ${overflowCount > 0 ? `<span class="cal-more-link" data-date="${dateStr}">+${overflowCount} more</span>` : ''}
        </div>
      `;
    }

    // Trailing empty cells
    const totalCells = firstDay + daysInMonth;
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let i = 0; i < remaining; i++) {
      gridCells += '<div class="cal-cell cal-cell--empty"></div>';
    }

    contentEl.innerHTML = `
      <div class="cal-grid">
        ${dayNames.map(d => `<div class="cal-header">${d}</div>`).join('')}
        ${gridCells}
      </div>
    `;

    // Cell click listeners
    const menuMap2 = buildMenuMap();
    const gcalMap2 = buildGcalMap();

    contentEl.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      cell.addEventListener('click', (e) => {
        if (e.target.closest('.cal-event') || e.target.closest('.cal-gcal-event') || e.target.closest('.cal-gcal-menu-btn') || e.target.closest('.cal-more-link')) return;
        const dateStr = cell.dataset.date;
        const dayMenus = menuMap2[dateStr] || [];
        const dayGcalEvents = gcalMap2[dateStr] || [];
        const hasUnlinkedGcal = dayGcalEvents.some(ev => !dayMenus.some(m => m.gcal_event_id === ev.id));
        if (dayMenus.length === 1 && !hasUnlinkedGcal) {
          window.location.hash = `#/menus/${dayMenus[0].id}`;
          return;
        }
        if (dayMenus.length === 0 && dayGcalEvents.length === 0) {
          openNewMenuModal(dateStr);
        }
      });
    });

    // Prevent event link clicks from bubbling
    contentEl.querySelectorAll('.cal-event, .cal-gcal-event--linked').forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });

    // Google Calendar "Create Menu" buttons
    contentEl.querySelectorAll('.cal-gcal-menu-btn').forEach(btn => {
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

    // "+N more" links — switch to list view filtered to that date
    contentEl.querySelectorAll('.cal-more-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        currentView = 'list';
        localStorage.setItem('calendarView', 'list');
        container.querySelectorAll('.cal-view-btn').forEach(b => b.classList.remove('cal-view-btn--active'));
        const listBtn = container.querySelector('.cal-view-btn[data-view="list"]');
        if (listBtn) listBtn.classList.add('cal-view-btn--active');
        renderContent(null);
      });
    });
  }

  function renderList(contentEl) {
    const menuMap = buildMenuMap();
    const gcalMap = buildGcalMap();
    const daysInMonth = getDaysInMonth(viewYear, viewMonth);
    const todayStr = toDateStr(today);

    // Collect days with events
    const daysWithEvents = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayMenus = menuMap[dateStr] || [];
      const dayGcal = gcalMap[dateStr] || [];
      if (dayMenus.length > 0 || dayGcal.length > 0) {
        daysWithEvents.push({ day, dateStr, dayMenus, dayGcal });
      }
    }

    if (daysWithEvents.length === 0) {
      contentEl.innerHTML = `<div class="cal-list-empty">No events this month</div>`;
      return;
    }

    let listHtml = '<div class="cal-list">';

    for (const { day, dateStr, dayMenus, dayGcal } of daysWithEvents) {
      const isToday = dateStr === todayStr;
      const isPast = dateStr < todayStr;
      const dayName = dayOfWeekName(viewYear, viewMonth, day);

      // Build linked gcal map for this day
      const gcalToMenu = {};
      for (const m of dayMenus) {
        if (m.gcal_event_id) {
          gcalToMenu[m.gcal_event_id] = m;
        }
      }

      const standaloneMenus = dayMenus.filter(m => !m.gcal_event_id);

      // Build combined event list sorted: standalone menus first, then gcal
      let eventsHtml = '';

      for (const m of standaloneMenus) {
        eventsHtml += `
          <a href="#/menus/${m.id}" class="cal-list-event cal-list-event--menu">
            <span class="cal-list-event-badge cal-list-event-badge--menu">Menu</span>
            <span class="cal-list-event-name">${escapeHtml(m.name)}</span>
            ${m.dish_count ? `<span class="cal-list-event-meta">${m.dish_count} dish${m.dish_count !== 1 ? 'es' : ''}</span>` : ''}
          </a>
        `;
      }

      for (const e of dayGcal) {
        const linkedMenu = gcalToMenu[e.id];
        if (linkedMenu) {
          eventsHtml += `
            <a href="#/menus/${linkedMenu.id}" class="cal-list-event cal-list-event--linked">
              <span class="cal-list-event-badge cal-list-event-badge--linked">Event</span>
              <span class="cal-list-event-name">${escapeHtml(e.summary)}</span>
              ${linkedMenu.dish_count ? `<span class="cal-list-event-meta">${linkedMenu.dish_count} dish${linkedMenu.dish_count !== 1 ? 'es' : ''}</span>` : ''}
            </a>
          `;
        } else {
          eventsHtml += `
            <div class="cal-list-event cal-list-event--gcal">
              <span class="cal-list-event-badge cal-list-event-badge--gcal">GCal</span>
              <span class="cal-list-event-name">${escapeHtml(e.summary)}</span>
              <button class="cal-gcal-menu-btn" data-gcal-id="${escapeHtml(e.id)}" data-gcal-date="${dateStr}" title="Create menu from this event" aria-label="Create menu from ${escapeHtml(e.summary)}">+</button>
            </div>
          `;
        }
      }

      listHtml += `
        <div class="cal-list-day ${isToday ? 'cal-list-day--today' : ''} ${isPast ? 'cal-list-day--past' : ''}" data-date="${dateStr}">
          <div class="cal-list-date">
            <span class="cal-list-date-dayname">${dayName}</span>
            <span class="cal-list-date-num ${isToday ? 'cal-day-num--today' : ''}">${day}</span>
          </div>
          <div class="cal-list-events">
            ${eventsHtml}
          </div>
        </div>
      `;
    }

    listHtml += '</div>';
    contentEl.innerHTML = listHtml;

    // Click listeners for gcal create-menu buttons in list view
    contentEl.querySelectorAll('.cal-gcal-menu-btn').forEach(btn => {
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

    // Click on day row (empty area) to create menu
    contentEl.querySelectorAll('.cal-list-day').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.cal-list-event') || e.target.closest('.cal-gcal-menu-btn')) return;
        const dateStr = row.dataset.date;
        openNewMenuModal(dateStr);
      });
    });
  }

  function setupSwipe(el) {
    if (!el) return;
    let startX = 0;
    let startY = 0;

    el.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    el.addEventListener('touchend', (e) => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const diffX = endX - startX;
      const diffY = endY - startY;

      // Only trigger if horizontal swipe is dominant and exceeds threshold
      if (Math.abs(diffX) < 50 || Math.abs(diffX) < Math.abs(diffY)) return;

      if (diffX < 0) {
        // Swipe left = next month
        viewMonth++;
        if (viewMonth > 11) { viewMonth = 0; viewYear++; }
        updateMonthTitle();
        renderContent('left');
      } else {
        // Swipe right = prev month
        viewMonth--;
        if (viewMonth < 0) { viewMonth = 11; viewYear--; }
        updateMonthTitle();
        renderContent('right');
      }
    }, { passive: true });
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
        console.warn('Create menu failed:', err);
        showToast('Could not create menu. Please try again.', 'error');
      }
    });
  }

  // Initial load
  await Promise.all([loadMenus(), loadGcalEvents()]);
  renderShell();
  renderContent(null);

  // Real-time sync
  const syncHandler = async () => {
    await loadMenus();
    renderContent(null);
  };
  const syncEvents = ['sync:menu_created', 'sync:menu_updated', 'sync:menu_deleted'];
  for (const evt of syncEvents) window.addEventListener(evt, syncHandler);
  const cleanup = () => {
    for (const evt of syncEvents) window.removeEventListener(evt, syncHandler);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}
