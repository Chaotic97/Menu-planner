import { getShoppingList, getPrepTasks } from '../api.js';
import { showToast } from '../components/toast.js';

export async function renderTodoView(container, menuId) {
  container.innerHTML = '<div class="loading">Generating tasks...</div>';

  let shoppingList, prepTasks;

  try {
    [shoppingList, prepTasks] = await Promise.all([
      getShoppingList(menuId),
      getPrepTasks(menuId),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to generate: ${err.message}</div>`;
    return;
  }

  // Load checkbox state from localStorage
  const storageKey = `todo-${menuId}`;
  let checkedState = {};
  try {
    checkedState = JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch { checkedState = {}; }

  function saveCheckState() {
    localStorage.setItem(storageKey, JSON.stringify(checkedState));
  }

  container.innerHTML = `
    <div class="page-header">
      <a href="#/menus/${menuId}" class="btn btn-back">&larr; Back to Menu</a>
      <h1>Tasks: ${shoppingList.menu_name}</h1>
      <button id="print-btn" class="btn btn-secondary">Print</button>
    </div>

    <div class="todo-tabs">
      <button class="tab-btn active" data-tab="shopping">Shopping List</button>
      <button class="tab-btn" data-tab="prep">Prep Tasks (${prepTasks.total_tasks})</button>
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
                    <strong>${item.ingredient}</strong>
                    <span class="todo-qty">${item.total_quantity} ${item.unit}</span>
                    ${item.estimated_cost !== null ? `<span class="todo-cost">$${item.estimated_cost.toFixed(2)}</span>` : ''}
                  </span>
                  <span class="todo-detail">${item.used_in.join(', ')}</span>
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
            <h3 class="todo-group-title">${group.label}</h3>
            ${group.tasks.map((task, i) => {
              const key = `prep-${group.timing}-${i}`;
              return `
                <label class="todo-item ${checkedState[key] ? 'checked' : ''}">
                  <input type="checkbox" data-key="${key}" ${checkedState[key] ? 'checked' : ''}>
                  <span class="todo-text">
                    <strong>${task.task}</strong>
                  </span>
                  <span class="todo-detail">From: ${task.dish}</span>
                </label>
              `;
            }).join('')}
          </div>
        `).join('')}
      ` : '<div class="empty-state"><p>No prep tasks found. Add chef\'s notes or ingredient prep notes to generate tasks.</p></div>'}
    </div>
  `;

  // Tab switching
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      container.querySelector(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Checkbox persistence
  container.querySelectorAll('.todo-item input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.key;
      checkedState[key] = cb.checked;
      cb.closest('.todo-item').classList.toggle('checked', cb.checked);
      saveCheckState();
    });
  });

  // Print button
  container.querySelector('#print-btn').addEventListener('click', () => window.print());
}
