import { getMenus, createMenu, updateMenu, deleteMenu, restoreMenu } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { capitalize } from '../data/allergens.js';

function isEventPast(eventDate) {
  if (!eventDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return eventDate < today;
}

function formatEventDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export async function renderMenuList(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Menus</h1>
      <button id="new-menu-btn" class="btn btn-primary">+ New Event Menu</button>
    </div>
    <div id="menu-sections">
      <div class="loading">Loading menus...</div>
    </div>
  `;

  const sections = container.querySelector('#menu-sections');

  async function loadMenus() {
    try {
      const menus = await getMenus();
      if (!menus.length) {
        sections.innerHTML = '<div class="empty-state"><p>No menus yet.</p><p>Create a menu to start organizing your dishes.</p></div>';
        return;
      }

      const houseMenu = menus.find(m => m.menu_type === 'standard');
      const eventMenus = menus.filter(m => m.menu_type !== 'standard');
      const upcomingEvents = eventMenus.filter(m => !isEventPast(m.event_date));
      const pastEvents = eventMenus.filter(m => isEventPast(m.event_date));

      let html = '';

      // House Menu section
      if (houseMenu) {
        html += `<div class="ml-section">
          <div class="ml-section-header"><h2>House Menu</h2></div>
          ${renderMenuCard(houseMenu, true)}
        </div>`;
      } else {
        html += `<div class="ml-section ml-no-house">
          <div class="ml-no-house-prompt">
            <p>No house menu set.</p>
            <p class="text-muted">Designate one of your menus as the house menu, or create one to use as your recurring standard menu.</p>
          </div>
        </div>`;
      }

      // Upcoming events
      if (upcomingEvents.length) {
        html += `<div class="ml-section">
          <div class="ml-section-header"><h2>Upcoming Events</h2></div>
          <div class="card-grid">
            ${upcomingEvents.map(m => renderMenuCard(m, false)).join('')}
          </div>
        </div>`;
      }

      // Past events
      if (pastEvents.length) {
        html += `<div class="ml-section">
          <div class="ml-section-header"><h2>Past Events</h2></div>
          <div class="card-grid">
            ${pastEvents.map(m => renderMenuCard(m, false)).join('')}
          </div>
        </div>`;
      }

      // Event menus with no date (legacy/undated)
      const undatedEvents = eventMenus.filter(m => !m.event_date);
      const datedEvents = eventMenus.filter(m => m.event_date);
      // Re-check: if all events already shown, no undated section needed
      if (undatedEvents.length && datedEvents.length < eventMenus.length) {
        // Only show this if there are undated events not already in upcoming/past
        // (undated events aren't past since isEventPast returns false for null)
        // They'll appear in upcomingEvents already. No extra section needed.
      }

      if (!houseMenu && !eventMenus.length) {
        html = '<div class="empty-state"><p>No menus yet.</p><p>Create a menu to start organizing your dishes.</p></div>';
      }

      sections.innerHTML = html;

      // Wire up card clicks
      sections.querySelectorAll('.menu-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions')) return;
          window.location.hash = `#/menus/${card.dataset.id}`;
        });
      });

      // Wire up overflow menus
      sections.querySelectorAll('.menu-card-overflow').forEach(slot => {
        const menuId = slot.dataset.id;
        const menuData = menus.find(m => String(m.id) === String(menuId));
        const actions = [
          { label: 'Open', icon: '📋', onClick: () => { window.location.hash = `#/menus/${menuId}`; } },
        ];
        if (menuData && menuData.menu_type !== 'standard') {
          actions.push({ label: 'Set as House Menu', icon: '⭐', onClick: async () => {
            try {
              await updateMenu(menuId, { menu_type: 'standard' });
              showToast('Set as house menu');
              loadMenus();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }});
        }
        if (menuData && menuData.menu_type === 'standard') {
          actions.push({ label: 'Convert to Event Menu', icon: '📅', onClick: async () => {
            try {
              await updateMenu(menuId, { menu_type: 'event' });
              showToast('Converted to event menu');
              loadMenus();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }});
        }
        actions.push({ label: 'Delete', icon: '✕', danger: true, onClick: async () => {
          try {
            await deleteMenu(menuId);
            loadMenus();
            showToast('Menu deleted', 'info', 8000, {
              label: 'Undo',
              onClick: async () => {
                try {
                  await restoreMenu(menuId);
                  showToast('Menu restored');
                  loadMenus();
                } catch (err) {
                  showToast('Failed to restore', 'error');
                }
              }
            });
          } catch (err) {
            showToast(err.message, 'error');
          }
        }});
        slot.appendChild(createActionMenu(actions));
      });
    } catch (err) {
      sections.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderMenuCard(menu, isHouse) {
    const guestAllergies = menu.guest_allergies
      ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
      : [];
    const past = isEventPast(menu.event_date);
    return `
      <div class="card menu-card ${isHouse ? 'ml-house-card' : ''} ${past ? 'ml-past-event' : ''}" data-id="${menu.id}">
        <div class="card-body">
          ${isHouse ? '<div class="ml-house-badge">House Menu</div>' : ''}
          ${!isHouse && menu.event_date ? `<div class="ml-event-date ${past ? 'ml-event-past' : ''}">${escapeHtml(formatEventDate(menu.event_date))}${past ? ' <span class="ml-past-label">Past</span>' : ''}</div>` : ''}
          <div class="menu-status ${menu.is_active ? 'active' : 'inactive'}">${menu.is_active ? 'Active' : 'Inactive'}</div>
          <h3 class="card-title">${escapeHtml(menu.name)}</h3>
          ${menu.description ? `<p class="card-desc">${escapeHtml(menu.description)}</p>` : ''}
          <div class="menu-stats">
            <span>${menu.dish_count} dish${menu.dish_count !== 1 ? 'es' : ''}</span>
            ${menu.sell_price ? `<span> &middot; $${Number(menu.sell_price).toFixed(2)}</span>` : ''}
            ${menu.menu_food_cost_percent !== undefined && menu.menu_food_cost_percent !== null ? `
              <span> &middot; <span class="${menu.menu_food_cost_percent > 35 ? 'text-danger' : menu.menu_food_cost_percent > 30 ? 'text-warning' : 'text-success'}">${menu.menu_food_cost_percent}% food cost</span></span>
            ` : ''}
          </div>
          ${menu.expected_covers ? `<div class="menu-stats"><span>${menu.expected_covers} expected covers</span></div>` : ''}
          ${guestAllergies.length ? (() => {
            let covers = {};
            try { covers = JSON.parse(menu.allergen_covers || '{}'); } catch {}
            return `<div class="allergen-cover-badges" style="margin-top:4px;">
              ${guestAllergies.map(a => `
                <span class="allergen-badge">${escapeHtml(capitalize(a))}${covers[a] ? ` <span class="allergen-cover-num">&times;${escapeHtml(String(covers[a]))}</span>` : ''}</span>
              `).join('')}
            </div>`;
          })() : ''}
        </div>
        <div class="card-actions">
          <span class="menu-card-overflow" data-id="${menu.id}"></span>
        </div>
      </div>
    `;
  }

  // New menu button
  container.querySelector('#new-menu-btn').addEventListener('click', () => {
    const modal = openModal('New Event Menu', `
      <form id="new-menu-form" class="form">
        <div class="form-group">
          <label for="menu-name">Menu Name *</label>
          <input type="text" id="menu-name" class="input" required placeholder="e.g., Wedding Reception, Corporate Lunch">
        </div>
        <div class="form-group">
          <label for="menu-desc">Description</label>
          <textarea id="menu-desc" class="input" rows="2" placeholder="Optional description..."></textarea>
        </div>
        <div class="form-group">
          <label for="menu-event-date">Event Date</label>
          <input type="date" id="menu-event-date" class="input">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="menu-sell-price">Sell Price ($)</label>
            <input type="number" id="menu-sell-price" class="input" step="0.01" min="0" placeholder="e.g., 120.00">
          </div>
          <div class="form-group">
            <label for="menu-covers">Expected Covers</label>
            <input type="number" id="menu-covers" class="input" min="0" placeholder="e.g., 50">
          </div>
        </div>
        <p class="text-muted" style="font-size:0.83rem;">Guest allergies can be configured in the menu builder after creation.</p>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create Menu</button>
        </div>
      </form>
    `);

    modal.querySelector('#new-menu-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = modal.querySelector('#menu-name').value.trim();
      if (!name) return;

      try {
        const result = await createMenu({
          name,
          description: modal.querySelector('#menu-desc').value.trim(),
          sell_price: parseFloat(modal.querySelector('#menu-sell-price').value) || 0,
          expected_covers: parseInt(modal.querySelector('#menu-covers').value) || 0,
          event_date: modal.querySelector('#menu-event-date').value || null,
          menu_type: 'event',
        });
        closeModal(modal);
        showToast('Menu created');
        window.location.hash = `#/menus/${result.id}`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Real-time sync listeners
  const onMenuChange = () => loadMenus();
  window.addEventListener('sync:menu_created', onMenuChange);
  window.addEventListener('sync:menu_updated', onMenuChange);
  window.addEventListener('sync:menu_deleted', onMenuChange);

  const cleanup = () => {
    window.removeEventListener('sync:menu_created', onMenuChange);
    window.removeEventListener('sync:menu_updated', onMenuChange);
    window.removeEventListener('sync:menu_deleted', onMenuChange);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  loadMenus();
}
