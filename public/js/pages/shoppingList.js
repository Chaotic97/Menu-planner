import { getMenus, getShoppingList, getScaledShoppingList } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';
import { printSheet } from '../utils/printSheet.js';

export async function renderShoppingList(container, menuId) {
  container.innerHTML = '<div class="loading">Loading...</div>';

  let menus;
  try {
    menus = await getMenus();
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    return;
  }

  let activeMenuId = menuId ? parseInt(menuId) : null;
  let shoppingData = null;
  let scaleCovers = '';

  async function loadShoppingList() {
    if (!activeMenuId) {
      shoppingData = null;
      return;
    }
    try {
      if (scaleCovers && parseInt(scaleCovers) > 0) {
        shoppingData = await getScaledShoppingList(activeMenuId, parseInt(scaleCovers));
      } else {
        shoppingData = await getShoppingList(activeMenuId);
      }
    } catch (err) {
      console.warn('Shopping list error:', err);
      showToast('Could not load shopping list', 'error');
      shoppingData = null;
    }
  }

  function countItems() {
    if (!shoppingData) return 0;
    let total = 0;
    for (const group of shoppingData.groups) {
      total += group.items.length;
    }
    return total;
  }

  function renderShoppingContent() {
    if (!shoppingData || !shoppingData.groups.length) {
      return '<div class="sl-empty"><p>No ingredients in this menu. Add dishes with ingredients first.</p></div>';
    }

    const total = countItems();

    let html = `
      <div class="sl-summary">
        <div class="sl-summary-main">
          <span class="sl-summary-need"><strong>${total}</strong> item${total !== 1 ? 's' : ''}</span>
        </div>
        <div class="sl-summary-cost">
          Est. total: <strong>$${shoppingData.total_estimated_cost.toFixed(2)}</strong>
        </div>
      </div>
    `;

    for (const group of shoppingData.groups) {
      html += `<div class="sl-category">
        <h3 class="sl-category-title">${escapeHtml(group.category.charAt(0).toUpperCase() + group.category.slice(1))}
          <span class="sl-category-count">(${group.items.length})</span>
        </h3>`;

      for (const item of group.items) {
        html += renderShoppingItem(item);
      }

      html += '</div>';
    }

    return html;
  }

  function renderShoppingItem(item) {
    return `
      <div class="sl-item" data-ingredient-id="${item.ingredient_id}">
        <div class="sl-item-body">
          <span class="sl-item-name">${escapeHtml(item.ingredient)}</span>
          <span class="sl-item-qty">${item.total_quantity} ${escapeHtml(item.unit)}</span>
          ${item.estimated_cost !== null ? `<span class="sl-item-cost">$${item.estimated_cost.toFixed(2)}</span>` : ''}
        </div>
        <div class="sl-item-detail">${escapeHtml(item.used_in.join(', '))}</div>
      </div>
    `;
  }

  function openPurchaseOrder() {
    if (!shoppingData) return;

    const allItems = [];
    for (const group of shoppingData.groups) {
      if (group.items.length) allItems.push({ category: group.category, items: group.items });
    }

    let totalCost = 0;
    for (const g of allItems) {
      for (const i of g.items) {
        if (i.estimated_cost !== null) totalCost += i.estimated_cost;
      }
    }

    const poDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const html = `
      <div class="po-modal-content">
        <div class="po-header">
          <div class="po-header-row">
            <span class="po-label">PURCHASE ORDER</span>
            <span class="po-date">${poDate}</span>
          </div>
          <div class="po-header-row">
            <span><strong>Menu:</strong> ${escapeHtml(shoppingData.menu_name)}</span>
            ${shoppingData.covers
              ? `<span><strong>Scaled to:</strong> ${shoppingData.covers} covers (${shoppingData.scale_factor}x)</span>`
              : shoppingData.expected_covers
                ? `<span><strong>Covers:</strong> ${shoppingData.expected_covers}</span>`
                : ''}
          </div>
        </div>
        ${allItems.length ? `
          <table class="po-table">
            <thead>
              <tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Est. Cost</th><th>Used In</th></tr>
            </thead>
            <tbody>
              ${allItems.map(g => `
                <tr class="po-category-row"><td colspan="5">${g.category.charAt(0).toUpperCase() + g.category.slice(1)}</td></tr>
                ${g.items.map(item => `
                  <tr>
                    <td>${escapeHtml(item.ingredient)}</td>
                    <td>${item.total_quantity}</td>
                    <td>${escapeHtml(item.unit)}</td>
                    <td>${item.estimated_cost !== null ? '$' + item.estimated_cost.toFixed(2) : '—'}</td>
                    <td class="po-used-in">${escapeHtml(item.used_in.join(', '))}</td>
                  </tr>
                `).join('')}
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="po-total-row">
                <td colspan="3"><strong>Estimated Total</strong></td>
                <td><strong>$${totalCost.toFixed(2)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div class="po-footer">
            <div class="po-footer-line">Ordered by: ___________________________</div>
            <div class="po-footer-line">Approved by: ___________________________</div>
            <div class="po-footer-line">Delivery date: ___________________________</div>
          </div>
          <div class="td-form-actions" style="margin-top: 16px;">
            <button class="btn btn-secondary" id="po-print-btn">Print PO</button>
          </div>
        ` : '<p>No items to order.</p>'}
      </div>
    `;

    const overlay = openModal('Purchase Order', html);

    overlay.querySelector('#po-print-btn')?.addEventListener('click', () => {
      const printHtml = `
        <html><head><title>Purchase Order - ${escapeHtml(shoppingData.menu_name)}</title>
        <style>
          body { font-family: -apple-system, sans-serif; padding: 24px; color: #1a1a1a; }
          .po-label { font-weight: 800; font-size: 1.3rem; text-transform: uppercase; letter-spacing: 0.05em; }
          .po-date { font-size: 0.9rem; color: #555; }
          .po-header-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
          table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.88rem; }
          th { text-align: left; padding: 6px 8px; background: #f0f0ec; border-bottom: 2px solid #ccc; }
          td { padding: 5px 8px; border-bottom: 1px solid #eee; }
          .po-category-row td { font-weight: 700; background: #fafaf5; text-transform: capitalize; }
          .po-total-row td { border-top: 2px solid #333; }
          .po-used-in { font-size: 0.78rem; color: #777; }
          .po-footer { margin-top: 32px; }
          .po-footer-line { margin-bottom: 20px; font-size: 0.9rem; }
        </style></head><body>
        ${overlay.querySelector('.po-modal-content').innerHTML.replace(/<div class="td-form-actions".*?<\/div>/s, '')}
        </body></html>
      `;
      closeModal(overlay);
      printSheet(printHtml);
    });
  }

  function renderContent() {
    const listArea = container.querySelector('#sl-list');
    if (!listArea) return;
    listArea.innerHTML = renderShoppingContent();
  }

  async function renderPage() {
    await loadShoppingList();

    // Pre-fill scale covers on first load if menu has expected_covers set
    if (shoppingData && shoppingData.expected_covers > 0 && !scaleCovers) {
      scaleCovers = String(shoppingData.expected_covers);
    }

    const menuOptions = menus.map(m =>
      `<option value="${m.id}" ${m.id === activeMenuId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="page-header">
        <h1>Shopping List</h1>
        <div class="header-actions">
          ${shoppingData ? '<span id="sl-overflow-menu"></span>' : ''}
        </div>
      </div>

      <div class="sl-controls">
        <div class="sl-controls-left">
          <select id="sl-menu-select" class="input sl-menu-select">
            <option value="">— Choose a menu —</option>
            ${menuOptions}
          </select>
          ${activeMenuId ? `
            <div class="sl-scale-group">
              <label for="sl-scale-covers">Scale to</label>
              <input type="number" id="sl-scale-covers" class="input sl-scale-input" placeholder="covers" min="1" value="${escapeHtml(scaleCovers)}">
              <span class="sl-scale-label">covers</span>
              <button id="sl-scale-btn" class="btn btn-secondary btn-sm">Scale</button>
              ${shoppingData && shoppingData.computed_covers > 0
                ? `<span class="sl-scale-hint">Menu makes ${shoppingData.computed_covers} portions${shoppingData.expected_covers ? ` · ${shoppingData.expected_covers} expected` : ''}</span>`
                : ''}
            </div>
          ` : ''}
        </div>
      </div>

      <div id="sl-list">
        ${activeMenuId ? renderShoppingContent() : '<div class="sl-empty"><p>Select a menu to generate a shopping list.</p></div>'}
      </div>
    `;

    // Menu selector
    container.querySelector('#sl-menu-select').addEventListener('change', async (e) => {
      activeMenuId = e.target.value ? parseInt(e.target.value) : null;
      scaleCovers = '';
      await renderPage();
    });

    // Scale button
    container.querySelector('#sl-scale-btn')?.addEventListener('click', async () => {
      scaleCovers = container.querySelector('#sl-scale-covers').value;
      if (scaleCovers && parseInt(scaleCovers) > 0) {
        await loadShoppingList();
        renderContent();
      }
    });

    // Enter key on scale input
    container.querySelector('#sl-scale-covers')?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        scaleCovers = e.target.value;
        if (scaleCovers && parseInt(scaleCovers) > 0) {
          await loadShoppingList();
          renderContent();
        }
      }
    });

    // Overflow menu (Purchase Order)
    const slOverflowSlot = container.querySelector('#sl-overflow-menu');
    if (slOverflowSlot) {
      const overflowItems = [
        { label: 'Purchase Order', icon: '📋', onClick: () => openPurchaseOrder() },
      ];
      const menuTrigger = createActionMenu(overflowItems);
      slOverflowSlot.appendChild(menuTrigger);
    }
  }

  // Sync event listeners — refresh when ingredients or menus change
  const syncEvents = ['sync:ingredient_updated', 'sync:ingredient_created', 'sync:menu_updated'];
  const syncHandler = async () => {
    await loadShoppingList();
    await renderPage();
  };
  for (const evt of syncEvents) {
    window.addEventListener(evt, syncHandler);
  }
  const cleanupOnNav = () => {
    for (const evt of syncEvents) {
      window.removeEventListener(evt, syncHandler);
    }
    window.removeEventListener('hashchange', cleanupOnNav);
  };
  window.addEventListener('hashchange', cleanupOnNav);

  await renderPage();
}
