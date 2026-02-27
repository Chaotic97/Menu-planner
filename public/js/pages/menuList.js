import { getMenus, createMenu, deleteMenu, restoreMenu } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { capitalize } from '../data/allergens.js';

export async function renderMenuList(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Menus</h1>
      <button id="new-menu-btn" class="btn btn-primary">+ New Menu</button>
    </div>
    <div id="menu-grid" class="card-grid">
      <div class="loading">Loading menus...</div>
    </div>
  `;

  const grid = container.querySelector('#menu-grid');

  async function loadMenus() {
    try {
      const menus = await getMenus();
      if (!menus.length) {
        grid.innerHTML = '<div class="empty-state"><p>No menus yet.</p><p>Create a menu to start organizing your dishes.</p></div>';
        return;
      }

      grid.innerHTML = menus.map(menu => {
        const guestAllergies = menu.guest_allergies
          ? menu.guest_allergies.split(',').map(a => a.trim()).filter(Boolean)
          : [];
        return `
          <div class="card menu-card" data-id="${menu.id}">
            <div class="card-body">
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
                    <span class="allergen-badge">${capitalize(a)}${covers[a] ? ` <span class="allergen-cover-num">&times;${covers[a]}</span>` : ''}</span>
                  `).join('')}
                </div>`;
              })() : ''}
            </div>
            <div class="card-actions">
              <span class="menu-card-overflow" data-id="${menu.id}"></span>
            </div>
          </div>
        `;
      }).join('');

      grid.querySelectorAll('.menu-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.card-actions')) return;
          window.location.hash = `#/menus/${card.dataset.id}`;
        });
      });

      // Card overflow action menus
      grid.querySelectorAll('.menu-card-overflow').forEach(slot => {
        const menuId = slot.dataset.id;
        const menuTrigger = createActionMenu([
          { label: 'Open', icon: '📋', onClick: () => { window.location.hash = `#/menus/${menuId}`; } },
          { label: 'Delete', icon: '✕', danger: true, onClick: async () => {
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
          }},
        ]);
        slot.appendChild(menuTrigger);
      });
    } catch (err) {
      grid.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    }
  }

  // New menu button
  container.querySelector('#new-menu-btn').addEventListener('click', () => {
    const modal = openModal('New Menu', `
      <form id="new-menu-form" class="form">
        <div class="form-group">
          <label for="menu-name">Menu Name *</label>
          <input type="text" id="menu-name" class="input" required placeholder="e.g., Friday Dinner Service">
        </div>
        <div class="form-group">
          <label for="menu-desc">Description</label>
          <textarea id="menu-desc" class="input" rows="2" placeholder="Optional description..."></textarea>
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
