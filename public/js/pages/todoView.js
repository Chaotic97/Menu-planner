import { getMenus, getTasks, createTask, updateTask, deleteTask, getAiSettings } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { openDrawerWithPrompt } from '../components/chatDrawer.js';
import { loadingHTML, emptyStateHTML } from '../utils/loadingState.js';

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

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
  container.innerHTML = loadingHTML('Loading...');

  let menus;
  try {
    menus = await getMenus();
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load menus: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const fromMenuBuilder = !!menuId;
  let filterMenuId = menuId ? String(menuId) : '';
  let showCompleted = false;
  let filterPriority = '';
  let tasks = [];
  let aiAvailable = false;

  // Check AI availability once
  try {
    const settings = await getAiSettings();
    aiAvailable = !!settings.hasApiKey;
  } catch {
    // AI not available
  }

  async function loadTasks() {
    const params = {};
    if (!showCompleted) params.completed = '0';
    if (filterPriority) params.priority = filterPriority;
    if (filterMenuId) params.menu_id = filterMenuId;

    try {
      tasks = await getTasks(params);
    } catch (err) {
      console.warn('Load tasks error:', err);
      showToast('Could not load tasks', 'error');
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
    const descriptionLine = task.description
      ? `<div class="td-task-desc">${escapeHtml(task.description)}</div>`
      : '';

    return `
      <div class="td-task-card ${isCompleted ? 'td-completed' : ''}" data-id="${task.id}">
        <div class="td-task-left">
          <input type="checkbox" class="td-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${task.id}">
          <span class="td-priority-dot ${priorityClass}" title="${escapeHtml(PRIORITY_LABELS[task.priority] || 'Medium')} priority"></span>
        </div>
        <div class="td-task-body">
          <div class="td-task-title-row">
            <span class="td-task-title">${escapeHtml(task.title)}</span>
          </div>
          <div class="td-task-meta">
            ${menuBadge}${dueBadge}
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
      return emptyStateHTML({
        icon: 'tasks',
        title: 'No tasks yet',
        message: aiAvailable && filterMenuId
          ? 'Use "Plan Tasks" to generate tasks with AI, or add one manually.'
          : 'Add a task to get started.',
      });
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

  function openAddTaskModal() {
    const menuOptions = menus.map(m =>
      `<option value="${m.id}" ${String(m.id) === filterMenuId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

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
            <option value="">-- No menu --</option>
            ${menuOptions}
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
          type: 'custom',
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
        console.warn('Create task error:', err);
        showToast('Could not create task', 'error');
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
        console.warn('Update task error:', err);
        showToast('Could not update task', 'error');
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
              console.warn('Undo task error:', err);
              showToast('Could not undo', 'error');
            }
          },
        });
      }
      await loadTasks();
      renderContent();
    } catch (err) {
      console.warn('Task update error:', err);
      showToast('Could not update task', 'error');
    }
  }

  async function handleDelete(taskId) {
    try {
      await deleteTask(taskId);
      showToast('Task deleted', 'success');
      await loadTasks();
      renderContent();
    } catch (err) {
      console.warn('Delete task error:', err);
      showToast('Could not delete task', 'error');
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
    contentArea.innerHTML = renderGroupedByDate(tasks);
    attachContentListeners();

    const countEl = container.querySelector('#td-task-count');
    if (countEl) countEl.textContent = `${tasks.length} task${tasks.length !== 1 ? 's' : ''}`;
  }

  function handlePlanTasks() {
    const selectedMenuId = filterMenuId;
    const selectedMenu = menus.find(m => String(m.id) === selectedMenuId);
    if (!selectedMenu) {
      showToast('Select a menu first', 'warning');
      return;
    }
    openDrawerWithPrompt(
      `Help me plan tasks for the "${selectedMenu.name}" menu. Look up the menu, then go through each dish and ask me what prep needs to be done. Also ask about non-cooking tasks like plating, equipment setup, ordering, or anything else I might need to get done. After we talk it through, create the tasks for me.`
    );
  }

  async function renderPage() {
    await loadTasks();

    const menuOptions = menus.map(m =>
      `<option value="${m.id}" ${String(m.id) === filterMenuId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
    ).join('');

    container.innerHTML = `
      <div class="page-header">
        ${fromMenuBuilder && menuId ? `<a href="#/menus/${menuId}" class="btn btn-back">&larr; Back to Menu</a>` : ''}
        <h1>Tasks</h1>
        <div class="header-actions">
          ${aiAvailable ? `<button id="td-plan-btn" class="btn btn-secondary" ${!filterMenuId ? 'disabled title="Select a menu first"' : ''}>Plan Tasks</button>` : ''}
          <button id="td-add-btn" class="btn btn-primary">+ Add Task</button>
        </div>
      </div>

      <div class="td-filter-bar">
        <div class="td-filter-group">
          <select id="td-filter-menu" class="input td-filter-select">
            <option value="">All Menus</option>
            ${menuOptions}
          </select>
          <select id="td-filter-priority" class="input td-filter-select">
            <option value="">All Priorities</option>
            <option value="high" ${filterPriority === 'high' ? 'selected' : ''}>High</option>
            <option value="medium" ${filterPriority === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="low" ${filterPriority === 'low' ? 'selected' : ''}>Low</option>
          </select>
        </div>
        <label class="td-completed-toggle">
          <input type="checkbox" id="td-show-completed" ${showCompleted ? 'checked' : ''}>
          <span>Show completed</span>
        </label>
        <span id="td-task-count" class="td-task-count">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
      </div>

      <div id="td-task-list">
        ${renderGroupedByDate(tasks)}
      </div>
    `;

    // Attach event listeners
    attachContentListeners();

    // Add task button
    container.querySelector('#td-add-btn')?.addEventListener('click', () => openAddTaskModal());

    // Plan tasks button
    container.querySelector('#td-plan-btn')?.addEventListener('click', () => handlePlanTasks());

    // Filter: menu
    container.querySelector('#td-filter-menu')?.addEventListener('change', async (e) => {
      filterMenuId = e.target.value;
      // Update Plan button state
      const planBtn = container.querySelector('#td-plan-btn');
      if (planBtn) {
        planBtn.disabled = !filterMenuId;
        planBtn.title = filterMenuId ? '' : 'Select a menu first';
      }
      await loadTasks();
      renderContent();
    });

    // Filter: priority
    container.querySelector('#td-filter-priority')?.addEventListener('change', async (e) => {
      filterPriority = e.target.value;
      await loadTasks();
      renderContent();
    });

    // Show completed toggle
    container.querySelector('#td-show-completed')?.addEventListener('change', async (e) => {
      showCompleted = e.target.checked;
      await loadTasks();
      renderContent();
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
