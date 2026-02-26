import { getMenus, getShoppingList, getPrepTasks, getMenuKitchenPrint } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { printSheet } from '../utils/printSheet.js';

export async function renderTodoView(container, menuId) {
  // menuId can be null (standalone #/todos tab) or an id (from #/menus/:id/todos)
  container.innerHTML = '<div class="loading">Loading menus...</div>';

  let menus;
  try {
    menus = await getMenus();
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const fromMenuBuilder = !!menuId; // show Back button only when launched from menu builder
  let activeMenuId = menuId ? parseInt(menuId) : null;

  async function render(mid) {
    activeMenuId = mid;

    container.innerHTML = `
      <div class="page-header">
        ${fromMenuBuilder && menuId ? `<a href="#/menus/${menuId}" class="btn btn-back">&larr; Back to Menu</a>` : ''}
        <h1>Todos</h1>
        <div class="header-actions">
          <select id="menu-selector" class="input" style="min-width:200px;">
            <option value="">— Choose a menu —</option>
            ${menus.map(m => `<option value="${m.id}" ${m.id == mid ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
          ${mid ? `
            <button id="print-btn" class="btn btn-secondary">Print</button>
            <button id="prep-sheet-btn" class="btn btn-secondary">Print Prep Sheet</button>
          ` : ''}
        </div>
      </div>

      <div id="todo-content">
        ${!mid
          ? `<div class="empty-state">
               <p>Select a menu above to generate its shopping list, prep tasks, and purchase order.</p>
             </div>`
          : `<div class="loading">Generating tasks...</div>`
        }
      </div>
    `;

    container.querySelector('#menu-selector').addEventListener('change', (e) => {
      render(e.target.value ? parseInt(e.target.value) : null);
    });

    container.querySelector('#print-btn')?.addEventListener('click', () => window.print());

    container.querySelector('#prep-sheet-btn')?.addEventListener('click', async () => {
      if (!activeMenuId) return;
      try {
        const data = await getMenuKitchenPrint(activeMenuId);
        let html = `
          <html><head><title>Prep Sheet - ${escapeHtml(data.menu.name)}</title>
          <style>
            body { font-family: -apple-system, sans-serif; padding: 20px; color: #1a1a1a; }
            h1 { font-size: 1.5rem; margin-bottom: 4px; border-bottom: 3px solid #1a1a1a; padding-bottom: 8px; }
            .meta { font-size: 0.9rem; color: #555; margin: 8px 0 24px; }
            .dish-block { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #ddd; page-break-inside: avoid; }
            .dish-name { font-size: 1.2rem; font-weight: 700; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 0.88rem; }
            th { text-align: left; padding: 4px 8px; background: #f0f0ec; border-bottom: 2px solid #ccc; }
            td { padding: 4px 8px; border-bottom: 1px solid #eee; }
            .notes-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-top: 8px; margin-bottom: 2px; }
            .notes { font-size: 0.85rem; color: #333; padding: 6px 10px; background: #f5f5f0; border-left: 3px solid #999; white-space: pre-line; }
          </style></head><body>
          <h1>Prep Sheet: ${escapeHtml(data.menu.name)}</h1>
          <div class="meta">Printed: ${new Date().toLocaleDateString()}${data.expected_covers ? ` &nbsp;·&nbsp; Covers: ${data.expected_covers}` : ''}</div>
        `;
        for (const dish of data.dishes) {
          html += `<div class="dish-block"><div class="dish-name">${escapeHtml(dish.name)}</div>`;
          if (dish.ingredients && dish.ingredients.length) {
            html += `<table><thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Prep Note</th></tr></thead><tbody>`;
            for (const ing of dish.ingredients) {
              html += `<tr><td>${escapeHtml(ing.ingredient_name)}</td><td>${ing.quantity || ''}</td><td>${escapeHtml(ing.unit || '')}</td><td>${escapeHtml(ing.prep_note || '')}</td></tr>`;
            }
            html += `</tbody></table>`;
          } else {
            html += `<p style="font-size:0.85rem;color:#888;">No ingredients listed.</p>`;
          }
          if (dish.chefs_notes) {
            html += `<div class="notes-label">Chef's Notes</div><div class="notes">${escapeHtml(dish.chefs_notes)}</div>`;
          }
          html += `</div>`;
        }
        html += `</body></html>`;
        printSheet(html);
      } catch (err) {
        showToast('Failed to generate prep sheet: ' + err.message, 'error');
      }
    });

    if (mid) {
      await loadContent(mid);
    }
  }

  async function loadContent(mid) {
    const contentDiv = container.querySelector('#todo-content');
    if (!contentDiv) return;

    let shoppingList, prepTasks;
    try {
      [shoppingList, prepTasks] = await Promise.all([
        getShoppingList(mid),
        getPrepTasks(mid),
      ]);
    } catch (err) {
      contentDiv.innerHTML = `<div class="error">Failed to generate: ${escapeHtml(err.message)}</div>`;
      return;
    }

    // Load checkbox state from localStorage
    const storageKey = `todo-${mid}`;
    let checkedState = {};
    try { checkedState = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch {}

    function saveCheckState() {
      localStorage.setItem(storageKey, JSON.stringify(checkedState));
    }

    const poDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    contentDiv.innerHTML = `
      <div class="todo-tabs">
        <button class="tab-btn active" data-tab="shopping">Shopping List</button>
        <button class="tab-btn" data-tab="prep">Prep Tasks (${prepTasks.total_tasks})</button>
        <button class="tab-btn" data-tab="po">Purchase Order</button>
      </div>

      <div id="tab-shopping" class="tab-content active">
        ${shoppingList.groups.length ? `
          <div class="shopping-summary">
            <strong>Estimated Total: $${shoppingList.total_estimated_cost.toFixed(2)}</strong>
          </div>
          ${shoppingList.groups.map(group => `
            <div class="todo-group">
              <h3 class="todo-group-title">${group.category.charAt(0).toUpperCase() + group.category.slice(1)}</h3>
              ${group.items.map(item => {
                const key = `shop-${item.ingredient}`;
                return `
                  <label class="todo-item ${checkedState[key] ? 'checked' : ''}">
                    <input type="checkbox" data-key="${key}" ${checkedState[key] ? 'checked' : ''}>
                    <span class="todo-text">
                      <strong>${escapeHtml(item.ingredient)}</strong>
                      <span class="todo-qty">${item.total_quantity} ${item.unit}</span>
                      ${item.estimated_cost !== null ? `<span class="todo-cost">$${item.estimated_cost.toFixed(2)}</span>` : ''}
                    </span>
                    <span class="todo-detail">${escapeHtml(item.used_in.join(', '))}</span>
                  </label>
                `;
              }).join('')}
            </div>
          `).join('')}
        ` : '<div class="empty-state"><p>No ingredients in this menu.</p></div>'}
      </div>

      <div id="tab-prep" class="tab-content">
        ${prepTasks.task_groups.length ? `
          ${prepTasks.task_groups.map(group => `
            <div class="todo-group">
              <h3 class="todo-group-title">${escapeHtml(group.label)}</h3>
              ${group.tasks.map((task) => {
                const slug = (task.dish + '-' + task.task).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
                const key = `prep-${slug}`;
                return `
                  <label class="todo-item ${checkedState[key] ? 'checked' : ''}">
                    <input type="checkbox" data-key="${key}" ${checkedState[key] ? 'checked' : ''}>
                    <span class="todo-text">
                      <strong>${escapeHtml(task.task)}</strong>
                    </span>
                    <span class="todo-detail">From: ${escapeHtml(task.dish)}</span>
                  </label>
                `;
              }).join('')}
            </div>
          `).join('')}
        ` : '<div class="empty-state"><p>No prep tasks found. Add chef\'s notes or ingredient prep notes to generate tasks.</p></div>'}
      </div>

      <div id="tab-po" class="tab-content">
        <div class="po-header">
          <div class="po-header-row">
            <span class="po-label">PURCHASE ORDER</span>
            <span class="po-date">${poDate}</span>
          </div>
          <div class="po-header-row">
            <span><strong>Menu:</strong> ${escapeHtml(shoppingList.menu_name)}</span>
            ${shoppingList.expected_covers ? `<span><strong>Covers:</strong> ${shoppingList.expected_covers}</span>` : ''}
          </div>
        </div>
        ${shoppingList.groups.length ? `
          <table class="po-table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Est. Cost</th>
                <th>Used In</th>
              </tr>
            </thead>
            <tbody>
              ${shoppingList.groups.map(group => `
                <tr class="po-category-row"><td colspan="5">${group.category.charAt(0).toUpperCase() + group.category.slice(1)}</td></tr>
                ${group.items.map(item => `
                  <tr>
                    <td>${escapeHtml(item.ingredient)}</td>
                    <td>${item.total_quantity}</td>
                    <td>${item.unit}</td>
                    <td>${item.estimated_cost !== null ? '$' + item.estimated_cost.toFixed(2) : '—'}</td>
                    <td class="po-used-in">${escapeHtml(item.used_in.join(', '))}</td>
                  </tr>
                `).join('')}
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="po-total-row">
                <td colspan="3"><strong>Estimated Total</strong></td>
                <td><strong>$${shoppingList.total_estimated_cost.toFixed(2)}</strong></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
          <div class="po-footer">
            <div class="po-footer-line">Ordered by: ___________________________</div>
            <div class="po-footer-line">Approved by: ___________________________</div>
            <div class="po-footer-line">Delivery date: ___________________________</div>
          </div>
        ` : '<div class="empty-state"><p>No ingredients to order — add dishes to this menu first.</p></div>'}
      </div>
    `;

    // Tab switching
    contentDiv.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        contentDiv.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        contentDiv.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        contentDiv.querySelector(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });

    // Checkbox persistence
    contentDiv.querySelectorAll('.todo-item input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.key;
        checkedState[key] = cb.checked;
        cb.closest('.todo-item').classList.toggle('checked', cb.checked);
        saveCheckState();
      });
    });
  }

  await render(activeMenuId);
}
