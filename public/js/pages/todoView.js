import { getMenus, getMenuKitchenPrint, getTasks, generateTasks, createTask, updateTask, deleteTask } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { printSheet } from '../utils/printSheet.js';

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
const TYPE_LABELS = { prep: 'Prep', custom: 'Custom' };
const TIMING_LABELS = {
  day_before: 'Day Before Service',
  morning_of: 'Morning of Service',
  '1_2_hours_before': '1-2 Hours Before',
  during_service: 'During Service',
  last_minute: 'Last Minute',
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getDateBucket(dateStr, today) {
  if (!dateStr) return 'no_date';
  if (dateStr < today) return 'overdue';
  if (dateStr === today) return 'today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dateStr === tomorrowStr) return 'tomorrow';
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().slice(0, 10);
  if (dateStr <= weekEndStr) return 'this_week';
  return 'later';
}

const DATE_BUCKET_LABELS = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  this_week: 'This Week',
  later: 'Later',
  no_date: 'No Date',
};
const DATE_BUCKET_ORDER = ['overdue', 'today', 'tomorrow', 'this_week', 'later', 'no_date'];

export async function renderTodoView(container, menuId) {
  container.innerHTML = '<div class="loading">Loading...</div>';

  let menus;
  try {
    menus = await getMenus();
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const fromMenuBuilder = !!menuId;
  let activeTab = fromMenuBuilder ? 'menu' : 'all';
  let activeMenuId = menuId ? parseInt(menuId) : null;
  let showCompleted = false;
  let filterPriority = '';
  let filterMenuId = '';
  let tasks = [];

  // Auto-generate if coming from menu builder
  if (fromMenuBuilder && activeMenuId) {
    try {
      await generateTasks(activeMenuId);
    } catch (err) {
      showToast('Failed to generate tasks: ' + err.message, 'error');
    }
  }

  async function loadTasks() {
    const params = {};
    if (!showCompleted) params.completed = '0';
    if (filterPriority) params.priority = filterPriority;

    if (activeTab === 'menu' && activeMenuId) {
      params.menu_id = activeMenuId;
    } else if (activeTab === 'prep') {
      params.type = 'prep';
    }
    // 'all' tab: no type filter

    if (filterMenuId) params.menu_id = filterMenuId;

    try {
      tasks = await getTasks(params);
    } catch (err) {
      showToast('Failed to load tasks: ' + err.message, 'error');
      tasks = [];
    }
  }

  function renderTaskCard(task) {
    const isCompleted = task.completed;
    const priorityClass = `td-priority-${task.priority || 'medium'}`;
    const dueBadge = task.due_date
      ? `<span class="td-badge td-badge-due ${getDateBucket(task.due_date, new Date().toISOString().slice(0, 10)) === 'overdue' && !isCompleted ? 'td-badge-overdue' : ''}">${escapeHtml(formatDate(task.due_date))}${task.due_time ? ' ' + escapeHtml(task.due_time) : ''}</span>`
      : '';
    const menuBadge = task.menu_name
      ? `<span class="td-badge td-badge-menu">${escapeHtml(task.menu_name)}</span>`
      : '';
    const typeBadge = `<span class="td-badge td-badge-type">${escapeHtml(TYPE_LABELS[task.type] || task.type)}</span>`;
    const quantityInfo = '';
    const descriptionLine = task.description
      ? `<div class="td-task-desc">${escapeHtml(task.description)}</div>`
      : '';
    const sourceIcon = task.source === 'auto' ? '<span class="td-auto-badge" title="Auto-generated">auto</span>' : '';

    return `
      <div class="td-task-card ${isCompleted ? 'td-completed' : ''}" data-id="${task.id}">
        <div class="td-task-left">
          <input type="checkbox" class="td-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${task.id}">
          <span class="td-priority-dot ${priorityClass}" title="${escapeHtml(PRIORITY_LABELS[task.priority] || 'Medium')} priority"></span>
        </div>
        <div class="td-task-body">
          <div class="td-task-title-row">
            <span class="td-task-title">${escapeHtml(task.title)}</span>
            ${quantityInfo}
            ${sourceIcon}
          </div>
          <div class="td-task-meta">
            ${typeBadge}${menuBadge}${dueBadge}
          </div>
          ${descriptionLine}
        </div>
        <div class="td-task-actions">
          <button class="td-edit-btn" data-task-id="${task.id}" title="Edit">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="td-delete-btn" data-task-id="${task.id}" title="Delete">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderGroupedByDate(taskList) {
    const today = new Date().toISOString().slice(0, 10);
    const buckets = {};
    for (const task of taskList) {
      const bucket = getDateBucket(task.due_date, today);
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(task);
    }
    if (Object.keys(buckets).length === 0) {
      return '<div class="td-empty-state"><p>No tasks found. Create a task or generate from a menu.</p></div>';
    }
    return DATE_BUCKET_ORDER
      .filter(b => buckets[b] && buckets[b].length > 0)
      .map(b => `
        <div class="td-date-group ${b === 'overdue' ? 'td-date-group-overdue' : ''}">
          <h3 class="td-group-title">${DATE_BUCKET_LABELS[b]} <span class="td-group-count">(${buckets[b].length})</span></h3>
          ${buckets[b].map(t => renderTaskCard(t)).join('')}
        </div>
      `).join('');
  }

  function renderGroupedByTiming(taskList) {
    const groups = {};
    for (const task of taskList) {
      const bucket = task.timing_bucket || 'during_service';
      if (!groups[bucket]) groups[bucket] = [];
      groups[bucket].push(task);
    }
    if (Object.keys(groups).length === 0) {
      return '<div class="td-empty-state"><p>No prep tasks. Generate tasks from a menu first.</p></div>';
    }
    const order = ['day_before', 'morning_of', '1_2_hours_before', 'during_service', 'last_minute'];
    return order
      .filter(t => groups[t] && groups[t].length > 0)
      .map(t => `
        <div class="td-date-group">
          <h3 class="td-group-title">${escapeHtml(TIMING_LABELS[t] || t)} <span class="td-group-count">(${groups[t].length})</span></h3>
          ${groups[t].map(task => renderTaskCard(task)).join('')}
        </div>
      `).join('');
  }

  function renderTaskList() {
    if (activeTab === 'prep') return renderGroupedByTiming(tasks);
    return renderGroupedByDate(tasks);
  }

  function openAddTaskModal() {
    const html = `
      <form id="add-task-form" class="td-form">
        <div class="form-group">
          <label for="task-title">Title *</label>
          <input type="text" id="task-title" class="input" required placeholder="e.g., Call fish supplier">
        </div>
        <div class="form-group">
          <label for="task-description">Description</label>
          <textarea id="task-description" class="input" rows="2" placeholder="Optional details..."></textarea>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="task-type">Type</label>
            <select id="task-type" class="input">
              <option value="custom">Custom</option>
              <option value="prep">Prep</option>
            </select>
          </div>
          <div class="form-group">
            <label for="task-priority">Priority</label>
            <select id="task-priority" class="input">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="task-due-date">Due Date</label>
            <input type="date" id="task-due-date" class="input">
          </div>
          <div class="form-group">
            <label for="task-due-time">Due Time</label>
            <input type="time" id="task-due-time" class="input">
          </div>
        </div>
        <div class="form-group">
          <label for="task-menu">Menu (optional)</label>
          <select id="task-menu" class="input">
            <option value="">— No menu —</option>
            ${menus.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="td-form-actions">
          <button type="submit" class="btn btn-primary">Create Task</button>
        </div>
      </form>
    `;

    const overlay = openModal('Add Task', html);

    overlay.querySelector('#add-task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = overlay.querySelector('#task-title').value.trim();
      if (!title) return;

      try {
        await createTask({
          title,
          description: overlay.querySelector('#task-description').value.trim(),
          type: overlay.querySelector('#task-type').value,
          priority: overlay.querySelector('#task-priority').value,
          due_date: overlay.querySelector('#task-due-date').value || undefined,
          due_time: overlay.querySelector('#task-due-time').value || undefined,
          menu_id: overlay.querySelector('#task-menu').value ? parseInt(overlay.querySelector('#task-menu').value) : undefined,
        });
        closeModal(overlay);
        showToast('Task created', 'success');
        await loadTasks();
        renderContent();
      } catch (err) {
        showToast('Failed to create task: ' + err.message, 'error');
      }
    });
  }

  function openEditTaskModal(task) {
    const html = `
      <form id="edit-task-form" class="td-form">
        <div class="form-group">
          <label for="edit-title">Title *</label>
          <input type="text" id="edit-title" class="input" value="${escapeHtml(task.title)}" required>
        </div>
        <div class="form-group">
          <label for="edit-description">Description</label>
          <textarea id="edit-description" class="input" rows="2">${escapeHtml(task.description || '')}</textarea>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="edit-priority">Priority</label>
            <select id="edit-priority" class="input">
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
          </div>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="edit-due-date">Due Date</label>
            <input type="date" id="edit-due-date" class="input" value="${task.due_date || ''}">
          </div>
          <div class="form-group">
            <label for="edit-due-time">Due Time</label>
            <input type="time" id="edit-due-time" class="input" value="${task.due_time || ''}">
          </div>
        </div>
        <div class="td-form-actions">
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    `;

    const overlay = openModal('Edit Task', html);

    overlay.querySelector('#edit-task-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = overlay.querySelector('#edit-title').value.trim();
      if (!title) return;

      try {
        await updateTask(task.id, {
          title,
          description: overlay.querySelector('#edit-description').value.trim(),
          priority: overlay.querySelector('#edit-priority').value,
          due_date: overlay.querySelector('#edit-due-date').value || null,
          due_time: overlay.querySelector('#edit-due-time').value || null,
        });
        closeModal(overlay);
        showToast('Task updated', 'success');
        await loadTasks();
        renderContent();
      } catch (err) {
        showToast('Failed to update task: ' + err.message, 'error');
      }
    });
  }

  async function handleCheckbox(taskId, checked) {
    try {
      await updateTask(taskId, { completed: checked });
      if (checked) {
        showToast('Task completed', 'success', 8000, {
          label: 'Undo',
          onClick: async () => {
            try {
              await updateTask(taskId, { completed: false });
              await loadTasks();
              renderContent();
            } catch (err) {
              showToast('Failed to undo: ' + err.message, 'error');
            }
          },
        });
      }
      await loadTasks();
      renderContent();
    } catch (err) {
      showToast('Failed to update task: ' + err.message, 'error');
    }
  }

  async function handleDelete(taskId) {
    try {
      await deleteTask(taskId);
      showToast('Task deleted', 'success');
      await loadTasks();
      renderContent();
    } catch (err) {
      showToast('Failed to delete task: ' + err.message, 'error');
    }
  }

  function attachContentListeners() {
    const contentArea = container.querySelector('#td-task-list');
    if (!contentArea) return;

    contentArea.querySelectorAll('.td-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        handleCheckbox(parseInt(cb.dataset.taskId), cb.checked);
      });
    });

    contentArea.querySelectorAll('.td-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const task = tasks.find(t => t.id === parseInt(btn.dataset.taskId));
        if (task) openEditTaskModal(task);
      });
    });

    contentArea.querySelectorAll('.td-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleDelete(parseInt(btn.dataset.taskId));
      });
    });
  }

  function renderContent() {
    const contentArea = container.querySelector('#td-task-list');
    if (!contentArea) return;
    contentArea.innerHTML = renderTaskList();
    attachContentListeners();

    // Update task count
    const countEl = container.querySelector('#td-task-count');
    if (countEl) countEl.textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
  }

  async function renderPage() {
    await loadTasks();

    const menuOptions = menus.map(m =>
      `<option value="${m.id}" ${m.id === activeMenuId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="page-header">
        ${fromMenuBuilder && menuId ? `<a href="#/menus/${menuId}" class="btn btn-back">&larr; Back to Menu</a>` : ''}
        <h1>Tasks</h1>
        <div class="header-actions">
          <button id="td-add-btn" class="btn btn-primary">+ Add Task</button>
          ${activeTab === 'menu' && activeMenuId ? `
            <button id="td-print-btn" class="btn btn-secondary">Print</button>
            <button id="td-prep-sheet-btn" class="btn btn-secondary">Prep Sheet</button>
          ` : ''}
        </div>
      </div>

      <div class="td-tabs">
        <button class="td-tab-btn ${activeTab === 'all' ? 'active' : ''}" data-tab="all">All Tasks</button>
        <button class="td-tab-btn ${activeTab === 'prep' ? 'active' : ''}" data-tab="prep">Prep</button>
        <button class="td-tab-btn ${activeTab === 'menu' ? 'active' : ''}" data-tab="menu">By Menu</button>
      </div>

      <div class="td-filter-bar">
        ${activeTab === 'menu' ? `
          <div class="td-filter-group">
            <select id="td-menu-select" class="input td-filter-select">
              <option value="">— Choose a menu —</option>
              ${menuOptions}
            </select>
            ${activeMenuId ? `<button id="td-regenerate-btn" class="btn btn-secondary btn-sm">Regenerate</button>` : ''}
          </div>
        ` : `
          <div class="td-filter-group">
            <select id="td-filter-priority" class="input td-filter-select">
              <option value="">All Priorities</option>
              <option value="high" ${filterPriority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${filterPriority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${filterPriority === 'low' ? 'selected' : ''}>Low</option>
            </select>
            <select id="td-filter-menu" class="input td-filter-select">
              <option value="">All Menus</option>
              ${menuOptions}
            </select>
          </div>
        `}
        <label class="td-completed-toggle">
          <input type="checkbox" id="td-show-completed" ${showCompleted ? 'checked' : ''}>
          <span>Show completed</span>
        </label>
        <span id="td-task-count" class="td-task-count">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      </div>

      <div id="td-task-list">
        ${renderTaskList()}
      </div>

      ${activeTab === 'menu' && activeMenuId ? `
        <div style="margin-top: 1rem;">
          <a href="#/menus/${activeMenuId}/shopping" class="btn btn-secondary">View Shopping List</a>
        </div>
      ` : ''}
    `;

    // Attach event listeners
    attachContentListeners();

    // Tab switching
    container.querySelectorAll('.td-tab-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        activeTab = btn.dataset.tab;
        filterPriority = '';
        filterMenuId = '';
        if (activeTab !== 'menu') activeMenuId = fromMenuBuilder ? parseInt(menuId) : null;
        await renderPage();
      });
    });

    // Add task button
    container.querySelector('#td-add-btn')?.addEventListener('click', () => openAddTaskModal());

    // Filter: priority
    container.querySelector('#td-filter-priority')?.addEventListener('change', async (e) => {
      filterPriority = e.target.value;
      await loadTasks();
      renderContent();
    });

    // Filter: menu (on All/Prep tabs)
    container.querySelector('#td-filter-menu')?.addEventListener('change', async (e) => {
      filterMenuId = e.target.value;
      await loadTasks();
      renderContent();
    });

    // Show completed toggle
    container.querySelector('#td-show-completed')?.addEventListener('change', async (e) => {
      showCompleted = e.target.checked;
      await loadTasks();
      renderContent();
    });

    // Menu selector (By Menu tab)
    container.querySelector('#td-menu-select')?.addEventListener('change', async (e) => {
      activeMenuId = e.target.value ? parseInt(e.target.value) : null;
      await renderPage();
    });

    // Regenerate button
    container.querySelector('#td-regenerate-btn')?.addEventListener('click', async () => {
      if (!activeMenuId) return;
      try {
        const result = await generateTasks(activeMenuId);
        showToast(`Generated ${result.total} tasks`, 'success');
        await loadTasks();
        renderContent();
      } catch (err) {
        showToast('Failed to regenerate: ' + err.message, 'error');
      }
    });

    // Print button
    container.querySelector('#td-print-btn')?.addEventListener('click', () => window.print());

    // Prep sheet button
    container.querySelector('#td-prep-sheet-btn')?.addEventListener('click', async () => {
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

  }

  // Sync event listeners
  const syncEvents = ['sync:task_created', 'sync:task_updated', 'sync:task_deleted', 'sync:tasks_generated', 'sync:tasks_batch_updated'];
  const syncHandler = async () => {
    await loadTasks();
    renderContent();
  };

  for (const evt of syncEvents) {
    window.addEventListener(evt, syncHandler);
  }

  // Clean up on navigation
  const cleanupOnNav = () => {
    for (const evt of syncEvents) {
      window.removeEventListener(evt, syncHandler);
    }
    window.removeEventListener('hashchange', cleanupOnNav);
  };
  window.addEventListener('hashchange', cleanupOnNav);

  await renderPage();
}
