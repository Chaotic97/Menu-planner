import { getTodayData, getTodaySummary, getDayPhases, createTask, updateTask, deleteTask, setTaskNext, clearTaskNext } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { createActionMenu } from '../components/actionMenu.js';

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

function formatDateHeading(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  return d.toLocaleDateString('en-US', opts);
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getCurrentPhaseId(phases) {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  for (const p of phases) {
    if (hhmm >= p.start && hhmm < p.end) return p.id;
  }
  return null;
}

function getPhaseIcon(phaseId) {
  const icons = {
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
    prep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v6c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>',
    service: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-2-3.92-2-6.5 0 2.58-.93 4.36-2 6.5-.5 1-.5 1.62-.5 3a2.5 2.5 0 0 0 2.5 2.5z"/><path d="M15 14.5A2.5 2.5 0 0 0 17.5 12c0-1.38-.5-2-1-3-1.07-2.14-2-3.92-2-6.5 0 2.58-.93 4.36-2 6.5-.5 1-.5 1.62-.5 3A2.5 2.5 0 0 0 15 14.5z"/><path d="M2 21h20"/><path d="M4 21V18a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/></svg>',
    wrapup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  };
  return icons[phaseId] || icons.admin;
}

export async function renderToday(container) {
  container.innerHTML = '<div class="loading">Loading...</div>';

  const today = new Date().toISOString().slice(0, 10);
  let data;
  let phases;

  try {
    [data, phases] = await Promise.all([getTodayData(), getDayPhases()]);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load today: ${escapeHtml(err.message)}</div>`;
    return;
  }

  function renderSpotlight(nextTask) {
    if (!nextTask) return '';
    const priorityClass = `td-priority-${nextTask.priority || 'medium'}`;
    return `
      <div class="ty-spotlight">
        <div class="ty-spotlight-label">Do This Next</div>
        <div class="ty-spotlight-card">
          <div class="ty-spotlight-left">
            <input type="checkbox" class="td-checkbox ty-spotlight-checkbox" data-task-id="${nextTask.id}">
            <span class="td-priority-dot ${priorityClass}"></span>
          </div>
          <div class="ty-spotlight-body">
            <div class="ty-spotlight-title">${escapeHtml(nextTask.title)}</div>
            ${nextTask.description ? `<div class="ty-spotlight-desc">${escapeHtml(nextTask.description)}</div>` : ''}
            <div class="td-task-meta">
              ${nextTask.menu_name ? `<span class="td-badge td-badge-menu">${escapeHtml(nextTask.menu_name)}</span>` : ''}
              ${nextTask.due_time ? `<span class="td-badge td-badge-due">${escapeHtml(nextTask.due_time)}</span>` : ''}
            </div>
          </div>
          <button class="ty-spotlight-clear" title="Clear spotlight" data-task-id="${nextTask.id}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderProgressBar(progress) {
    const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
    return `
      <div class="ty-progress">
        <div class="ty-progress-bar">
          <div class="ty-progress-fill" style="width: ${pct}%"></div>
        </div>
        <div class="ty-progress-text">${progress.completed} of ${progress.total} done</div>
      </div>
    `;
  }

  function renderTaskCard(task, showPhaseActions) {
    const isCompleted = task.completed;
    const priorityClass = `td-priority-${task.priority || 'medium'}`;
    const isNext = task.is_next;
    const menuBadge = task.menu_name
      ? `<span class="td-badge td-badge-menu">${escapeHtml(task.menu_name)}</span>`
      : '';
    const timeBadge = task.due_time
      ? `<span class="td-badge td-badge-due">${escapeHtml(task.due_time)}</span>`
      : '';
    const sourceIcon = task.source === 'auto' ? '<span class="td-auto-badge" title="Auto-generated">auto</span>' : '';

    return `
      <div class="td-task-card ${isCompleted ? 'td-completed' : ''} ${isNext ? 'ty-task-is-next' : ''}" data-id="${task.id}">
        <div class="td-task-left">
          <input type="checkbox" class="td-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${task.id}">
          <span class="td-priority-dot ${priorityClass}" title="${escapeHtml(PRIORITY_LABELS[task.priority] || 'Medium')} priority"></span>
        </div>
        <div class="td-task-body">
          <div class="td-task-title-row">
            <span class="td-task-title">${escapeHtml(task.title)}</span>
            ${sourceIcon}
          </div>
          <div class="td-task-meta">
            ${menuBadge}${timeBadge}
          </div>
          ${task.description ? `<div class="td-task-desc">${escapeHtml(task.description)}</div>` : ''}
        </div>
        <div class="td-task-actions ty-task-actions">
          ${!isCompleted && !isNext ? `<button class="ty-next-btn" data-task-id="${task.id}" title="Do this next">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </button>` : ''}
          ${showPhaseActions ? `<button class="ty-phase-btn" data-task-id="${task.id}" title="Assign phase">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>` : ''}
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

  function renderOverdue(overdueTasks) {
    if (!overdueTasks.length) return '';
    return `
      <div class="ty-overdue-section">
        <div class="ty-section-header ty-overdue-header">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>Overdue</span>
          <span class="ty-section-count">${overdueTasks.length}</span>
        </div>
        <div class="ty-section-tasks">
          ${overdueTasks.map(t => `
            <div class="td-task-card ty-overdue-task" data-id="${t.id}">
              <div class="td-task-left">
                <input type="checkbox" class="td-checkbox" data-task-id="${t.id}">
                <span class="td-priority-dot td-priority-${t.priority || 'medium'}"></span>
              </div>
              <div class="td-task-body">
                <div class="td-task-title-row">
                  <span class="td-task-title">${escapeHtml(t.title)}</span>
                </div>
                <div class="td-task-meta">
                  <span class="td-badge td-badge-overdue">${escapeHtml(formatShortDate(t.due_date))}</span>
                  ${t.menu_name ? `<span class="td-badge td-badge-menu">${escapeHtml(t.menu_name)}</span>` : ''}
                </div>
              </div>
              <div class="td-task-actions ty-task-actions">
                <button class="ty-reschedule-btn" data-task-id="${t.id}" title="Move to today">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                </button>
                <button class="td-delete-btn" data-task-id="${t.id}" title="Delete">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderPhaseSection(phase, currentPhaseId) {
    const isCurrent = phase.id === currentPhaseId;
    const activeTasks = phase.tasks.filter(t => !t.completed);
    const completedTasks = phase.tasks.filter(t => t.completed);
    const isEmpty = phase.tasks.length === 0;

    return `
      <div class="ty-phase ${isCurrent ? 'ty-phase-current' : ''} ${isEmpty ? 'ty-phase-empty' : ''}">
        <div class="ty-phase-header" data-phase-id="${escapeHtml(phase.id)}">
          <div class="ty-phase-icon">${getPhaseIcon(phase.id)}</div>
          <div class="ty-phase-info">
            <div class="ty-phase-name">${escapeHtml(phase.name)}</div>
            <div class="ty-phase-time">${escapeHtml(phase.start)} – ${escapeHtml(phase.end)}</div>
          </div>
          ${isCurrent ? '<span class="ty-phase-now">Now</span>' : ''}
          <span class="ty-phase-count">${activeTasks.length}${completedTasks.length ? ` / ${phase.tasks.length}` : ''}</span>
          <span class="ty-phase-chevron">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </div>
        <div class="ty-phase-body ${isEmpty ? '' : 'ty-phase-body-open'}">
          ${isEmpty ? `<div class="ty-phase-empty-msg">No tasks for this phase</div>` : `
            ${activeTasks.map(t => renderTaskCard(t, false)).join('')}
            ${completedTasks.length ? `
              <div class="ty-phase-completed-group">
                <div class="ty-completed-label">${completedTasks.length} completed</div>
                ${completedTasks.map(t => renderTaskCard(t, false)).join('')}
              </div>
            ` : ''}
          `}
        </div>
      </div>
    `;
  }

  function renderUnscheduled(tasks) {
    if (!tasks.length) return '';
    const active = tasks.filter(t => !t.completed);
    const done = tasks.filter(t => t.completed);

    return `
      <div class="ty-phase ty-phase-unscheduled">
        <div class="ty-phase-header" data-phase-id="unscheduled">
          <div class="ty-phase-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>
          </div>
          <div class="ty-phase-info">
            <div class="ty-phase-name">Unscheduled</div>
            <div class="ty-phase-time">No phase assigned</div>
          </div>
          <span class="ty-phase-count">${active.length}${done.length ? ` / ${tasks.length}` : ''}</span>
          <span class="ty-phase-chevron">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </div>
        <div class="ty-phase-body ty-phase-body-open">
          ${active.map(t => renderTaskCard(t, true)).join('')}
          ${done.length ? `
            <div class="ty-phase-completed-group">
              <div class="ty-completed-label">${done.length} completed</div>
              ${done.map(t => renderTaskCard(t, true)).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function getAllTasks() {
    const all = [];
    for (const p of (data.phases || [])) {
      all.push(...p.tasks);
    }
    all.push(...(data.unscheduled || []));
    all.push(...(data.overdue || []));
    return all;
  }

  function render() {
    const currentPhaseId = getCurrentPhaseId(data.phases || phases);

    container.innerHTML = `
      <div class="ty-page">
        <div class="ty-header">
          <div class="ty-header-left">
            <h1 class="ty-title">Today</h1>
            <div class="ty-date">${formatDateHeading(data.date)}</div>
          </div>
          <div class="ty-header-right">
            <span id="ty-overflow-slot"></span>
          </div>
        </div>

        ${renderProgressBar(data.progress)}
        ${renderSpotlight(data.next_task)}
        ${renderOverdue(data.overdue || [])}

        <div class="ty-phases" id="ty-phases">
          ${(data.phases || []).map(p => renderPhaseSection(p, currentPhaseId)).join('')}
          ${renderUnscheduled(data.unscheduled || [])}
        </div>
      </div>
    `;

    // Overflow menu
    const overflowSlot = container.querySelector('#ty-overflow-slot');
    if (overflowSlot) {
      const menuTrigger = createActionMenu([
        { label: 'Add Task', icon: '+', onClick: () => openAddTaskModal() },
        { label: 'Day Summary', onClick: () => openSummaryModal() },
        { label: 'View All Tasks', onClick: () => { window.location.hash = '#/todos'; } },
      ]);
      overflowSlot.appendChild(menuTrigger);
    }

    attachListeners();
  }

  function attachListeners() {
    // Phase toggle (expand/collapse)
    container.querySelectorAll('.ty-phase-header').forEach(header => {
      header.addEventListener('click', () => {
        const phase = header.closest('.ty-phase');
        const body = phase.querySelector('.ty-phase-body');
        body.classList.toggle('ty-phase-body-open');
        header.classList.toggle('ty-phase-header-collapsed');
      });
    });

    // Checkboxes
    container.querySelectorAll('.td-checkbox').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        e.stopPropagation();
        const taskId = parseInt(cb.dataset.taskId);
        const checked = cb.checked;
        try {
          await updateTask(taskId, { completed: checked });
          if (checked) {
            showToast('Task completed', 'success', 8000, {
              label: 'Undo',
              onClick: async () => {
                try {
                  await updateTask(taskId, { completed: false });
                  await reload();
                } catch (err) {
                  showToast('Failed to undo: ' + err.message, 'error');
                }
              },
            });
          }
          await reload();
        } catch (err) {
          showToast('Failed to update: ' + err.message, 'error');
        }
      });
      // Prevent header toggle when clicking checkbox
      cb.addEventListener('click', (e) => e.stopPropagation());
    });

    // Set next
    container.querySelectorAll('.ty-next-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await setTaskNext(parseInt(btn.dataset.taskId));
          showToast('Set as next task', 'success');
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });

    // Clear spotlight
    container.querySelectorAll('.ty-spotlight-clear').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await clearTaskNext();
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });

    // Spotlight checkbox
    container.querySelectorAll('.ty-spotlight-checkbox').forEach(cb => {
      cb.addEventListener('change', async () => {
        const taskId = parseInt(cb.dataset.taskId);
        try {
          await updateTask(taskId, { completed: true });
          await clearTaskNext();
          showToast('Task completed', 'success');
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });

    // Reschedule overdue to today
    container.querySelectorAll('.ty-reschedule-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await updateTask(parseInt(btn.dataset.taskId), { due_date: today });
          showToast('Moved to today', 'success');
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });

    // Assign phase
    container.querySelectorAll('.ty-phase-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhasePickerModal(parseInt(btn.dataset.taskId));
      });
    });

    // Edit task
    container.querySelectorAll('.td-edit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const allTasks = getAllTasks();
        const task = allTasks.find(t => t.id === parseInt(btn.dataset.taskId));
        if (task) openEditTaskModal(task);
      });
    });

    // Delete task
    container.querySelectorAll('.td-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await deleteTask(parseInt(btn.dataset.taskId));
          showToast('Task deleted', 'success');
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });
  }

  async function reload() {
    try {
      data = await getTodayData();
      render();
    } catch (err) {
      showToast('Failed to reload: ' + err.message, 'error');
    }
  }

  function openAddTaskModal() {
    const phaseOptions = phases.map(p =>
      `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`
    ).join('');

    const html = `
      <form id="ty-add-form" class="td-form">
        <div class="form-group">
          <label for="ty-add-title">Title *</label>
          <input type="text" id="ty-add-title" class="input" required placeholder="e.g., Call fish supplier">
        </div>
        <div class="form-group">
          <label for="ty-add-desc">Description</label>
          <textarea id="ty-add-desc" class="input" rows="2" placeholder="Optional details..."></textarea>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="ty-add-priority">Priority</label>
            <select id="ty-add-priority" class="input">
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ty-add-phase">Day Phase</label>
            <select id="ty-add-phase" class="input">
              <option value="">— None —</option>
              ${phaseOptions}
            </select>
          </div>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="ty-add-time">Time</label>
            <input type="time" id="ty-add-time" class="input">
          </div>
          <div class="form-group">
            <label for="ty-add-type">Type</label>
            <select id="ty-add-type" class="input">
              <option value="custom">Custom</option>
              <option value="prep">Prep</option>
            </select>
          </div>
        </div>
        <div class="td-form-actions">
          <button type="submit" class="btn btn-primary">Create Task</button>
        </div>
      </form>
    `;

    const overlay = openModal('Add Task', html);
    overlay.querySelector('#ty-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = overlay.querySelector('#ty-add-title').value.trim();
      if (!title) return;

      try {
        await createTask({
          title,
          description: overlay.querySelector('#ty-add-desc').value.trim(),
          priority: overlay.querySelector('#ty-add-priority').value,
          day_phase: overlay.querySelector('#ty-add-phase').value || undefined,
          due_date: today,
          due_time: overlay.querySelector('#ty-add-time').value || undefined,
          type: overlay.querySelector('#ty-add-type').value,
        });
        closeModal(overlay);
        showToast('Task created', 'success');
        await reload();
      } catch (err) {
        showToast('Failed: ' + err.message, 'error');
      }
    });
  }

  function openEditTaskModal(task) {
    const phaseOptions = phases.map(p =>
      `<option value="${escapeHtml(p.id)}" ${task.day_phase === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');

    const html = `
      <form id="ty-edit-form" class="td-form">
        <div class="form-group">
          <label for="ty-edit-title">Title *</label>
          <input type="text" id="ty-edit-title" class="input" value="${escapeHtml(task.title)}" required>
        </div>
        <div class="form-group">
          <label for="ty-edit-desc">Description</label>
          <textarea id="ty-edit-desc" class="input" rows="2">${escapeHtml(task.description || '')}</textarea>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="ty-edit-priority">Priority</label>
            <select id="ty-edit-priority" class="input">
              <option value="low" ${task.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="high" ${task.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ty-edit-phase">Day Phase</label>
            <select id="ty-edit-phase" class="input">
              <option value="">— None —</option>
              ${phaseOptions}
            </select>
          </div>
        </div>
        <div class="td-form-row">
          <div class="form-group">
            <label for="ty-edit-date">Due Date</label>
            <input type="date" id="ty-edit-date" class="input" value="${task.due_date || ''}">
          </div>
          <div class="form-group">
            <label for="ty-edit-time">Due Time</label>
            <input type="time" id="ty-edit-time" class="input" value="${task.due_time || ''}">
          </div>
        </div>
        <div class="td-form-actions">
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    `;

    const overlay = openModal('Edit Task', html);
    overlay.querySelector('#ty-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = overlay.querySelector('#ty-edit-title').value.trim();
      if (!title) return;

      try {
        await updateTask(task.id, {
          title,
          description: overlay.querySelector('#ty-edit-desc').value.trim(),
          priority: overlay.querySelector('#ty-edit-priority').value,
          day_phase: overlay.querySelector('#ty-edit-phase').value || null,
          due_date: overlay.querySelector('#ty-edit-date').value || null,
          due_time: overlay.querySelector('#ty-edit-time').value || null,
        });
        closeModal(overlay);
        showToast('Task updated', 'success');
        await reload();
      } catch (err) {
        showToast('Failed: ' + err.message, 'error');
      }
    });
  }

  function openPhasePickerModal(taskId) {
    const html = `
      <div class="ty-phase-picker">
        <button class="ty-phase-pick-btn" data-phase="">None (Unscheduled)</button>
        ${phases.map(p => `
          <button class="ty-phase-pick-btn" data-phase="${escapeHtml(p.id)}">
            <span class="ty-phase-pick-icon">${getPhaseIcon(p.id)}</span>
            <span>${escapeHtml(p.name)}</span>
            <span class="ty-phase-pick-time">${escapeHtml(p.start)} – ${escapeHtml(p.end)}</span>
          </button>
        `).join('')}
      </div>
    `;

    const overlay = openModal('Assign Phase', html);
    overlay.querySelectorAll('.ty-phase-pick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await updateTask(taskId, { day_phase: btn.dataset.phase || null });
          closeModal(overlay);
          showToast('Phase assigned', 'success');
          await reload();
        } catch (err) {
          showToast('Failed: ' + err.message, 'error');
        }
      });
    });
  }

  async function openSummaryModal() {
    let summary;
    try {
      summary = await getTodaySummary();
    } catch (err) {
      showToast('Failed to load summary: ' + err.message, 'error');
      return;
    }

    const html = `
      <div class="ty-summary">
        <div class="ty-summary-section">
          <h3 class="ty-summary-heading ty-summary-completed">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            Completed Today (${summary.completed.length})
          </h3>
          ${summary.completed.length ? `
            <ul class="ty-summary-list">
              ${summary.completed.map(t => `<li class="ty-summary-item ty-summary-done">${escapeHtml(t.title)}</li>`).join('')}
            </ul>
          ` : '<p class="ty-summary-empty">Nothing completed yet</p>'}
        </div>

        <div class="ty-summary-section">
          <h3 class="ty-summary-heading ty-summary-added-h">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Added Today (${summary.added.length})
          </h3>
          ${summary.added.length ? `
            <ul class="ty-summary-list">
              ${summary.added.map(t => `<li class="ty-summary-item">${escapeHtml(t.title)}</li>`).join('')}
            </ul>
          ` : '<p class="ty-summary-empty">No tasks added today</p>'}
        </div>

        <div class="ty-summary-section">
          <h3 class="ty-summary-heading ty-summary-incomplete-h">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Carrying Over (${summary.incomplete.length})
          </h3>
          ${summary.incomplete.length ? `
            <ul class="ty-summary-list">
              ${summary.incomplete.map(t => `<li class="ty-summary-item ty-summary-carry">${escapeHtml(t.title)}${t.due_date && t.due_date < today ? ` <span class="ty-summary-overdue">overdue ${escapeHtml(formatShortDate(t.due_date))}</span>` : ''}</li>`).join('')}
            </ul>
          ` : '<p class="ty-summary-empty">All caught up!</p>'}
        </div>

        <div class="ty-summary-section ty-summary-tomorrow">
          <h3 class="ty-summary-heading">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Tomorrow (${summary.tomorrow.task_count} task${summary.tomorrow.task_count !== 1 ? 's' : ''})
          </h3>
          ${summary.tomorrow.tasks.length ? `
            <ul class="ty-summary-list">
              ${summary.tomorrow.tasks.slice(0, 5).map(t => `<li class="ty-summary-item">${escapeHtml(t.title)}</li>`).join('')}
              ${summary.tomorrow.tasks.length > 5 ? `<li class="ty-summary-item ty-summary-more">+ ${summary.tomorrow.tasks.length - 5} more</li>` : ''}
            </ul>
          ` : '<p class="ty-summary-empty">No tasks scheduled for tomorrow</p>'}
        </div>
      </div>
    `;

    openModal('Day Summary', html);
  }

  // Sync event listeners
  const syncEvents = ['sync:task_created', 'sync:task_updated', 'sync:task_deleted', 'sync:tasks_generated', 'sync:tasks_batch_updated'];
  const syncHandler = () => reload();
  const quickCaptureHandler = () => reload();

  for (const evt of syncEvents) {
    window.addEventListener(evt, syncHandler);
  }
  window.addEventListener('quickcapture:created', quickCaptureHandler);

  const cleanupOnNav = () => {
    for (const evt of syncEvents) {
      window.removeEventListener(evt, syncHandler);
    }
    window.removeEventListener('quickcapture:created', quickCaptureHandler);
    window.removeEventListener('hashchange', cleanupOnNav);
  };
  window.addEventListener('hashchange', cleanupOnNav);

  render();
}
