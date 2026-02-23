import { getMenus, createMenu, deleteMenu, restoreMenu } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';

const ALLERGEN_LIST = ['celery','gluten','crustaceans','eggs','fish','lupin','milk','molluscs','mustard','nuts','peanuts','sesame','soy','sulphites'];

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
              <h3 class="card-title">${menu.name}</h3>
              ${menu.description ? `<p class="card-desc">${menu.description}</p>` : ''}
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
                    <span class="allergen-badge">${a.charAt(0).toUpperCase() + a.slice(1)}${covers[a] ? ` <span class="allergen-cover-num">×${covers[a]}</span>` : ''}</span>
                  `).join('')}
                </div>`;
              })() : ''}
            </div>
            <div class="card-actions">
              <a href="#/menus/${menu.id}" class="btn btn-sm btn-primary">Open</a>
              <button class="btn btn-sm btn-danger delete-menu" data-id="${menu.id}">Delete</button>
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

      grid.querySelectorAll('.delete-menu').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const menuId = btn.dataset.id;
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
        });
      });
    } catch (err) {
      grid.innerHTML = `<div class="error">Failed to load menus: ${err.message}</div>`;
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
        <div class="form-group">
          <label>Guest Allergies &amp; Cover Counts</label>
          <p class="text-muted" style="font-size:0.8rem;margin-bottom:8px;">Toggle an allergen to activate it, then enter how many covers need that option.</p>
          <div class="allergen-cover-grid" id="new-menu-allergies">
            ${ALLERGEN_LIST.map(a => `
              <div class="allergen-cover-item">
                <button type="button" class="allergen-toggle" data-allergen="${a}">${a.charAt(0).toUpperCase() + a.slice(1)}</button>
                <input type="number" class="allergen-cover-count" data-allergen="${a}" placeholder="# covers" min="0" max="999" style="display:none;">
              </div>
            `).join('')}
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create Menu</button>
        </div>
      </form>
    `);

    // Wire up allergen toggles in modal
    modal.querySelectorAll('.allergen-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        btn.classList.toggle('active');
        const countInput = btn.closest('.allergen-cover-item').querySelector('.allergen-cover-count');
        if (countInput) {
          countInput.style.display = btn.classList.contains('active') ? 'block' : 'none';
          if (!btn.classList.contains('active')) countInput.value = '';
        }
      });
    });

    modal.querySelector('#new-menu-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = modal.querySelector('#menu-name').value.trim();
      if (!name) return;

      const activeAllergens = [];
      const allergenCovers = {};
      modal.querySelectorAll('.allergen-toggle.active').forEach(b => {
        const allergen = b.dataset.allergen;
        activeAllergens.push(allergen);
        const countInput = b.closest('.allergen-cover-item').querySelector('.allergen-cover-count');
        if (countInput && countInput.value) {
          allergenCovers[allergen] = parseInt(countInput.value) || 0;
        }
      });

      try {
        const result = await createMenu({
          name,
          description: modal.querySelector('#menu-desc').value.trim(),
          sell_price: parseFloat(modal.querySelector('#menu-sell-price').value) || 0,
          expected_covers: parseInt(modal.querySelector('#menu-covers').value) || 0,
          guest_allergies: activeAllergens.join(','),
          allergen_covers: JSON.stringify(allergenCovers),
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
