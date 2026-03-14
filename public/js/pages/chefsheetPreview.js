import { getChefSheet, updateChefSheetActions, confirmChefSheet } from '../api.js';
import { showToast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { loadingHTML } from '../utils/loadingState.js';

const TYPE_CONFIG = {
  task:         { label: 'Task',         color: '#2e7d32', icon: 'check-square' },
  service_note: { label: 'Service Note', color: '#1565c0', icon: 'clipboard' },
  menu_change:  { label: 'Menu Change',  color: '#e65100', icon: 'menu' },
  order:        { label: 'Order',        color: '#6a1b9a', icon: 'shopping-cart' },
  recipe_note:  { label: 'Recipe Note',  color: '#c62828', icon: 'book' },
};

const CONFIDENCE_COLORS = { high: '#2e7d32', medium: '#f57f17', low: '#c62828' };

function confidenceDot(level) {
  const color = CONFIDENCE_COLORS[level] || CONFIDENCE_COLORS.medium;
  return `<span class="cs-confidence" style="background:${color}" title="${escapeHtml(level)} confidence"></span>`;
}

function typeBadge(type) {
  const cfg = TYPE_CONFIG[type] || { label: type, color: '#546e7a' };
  return `<span class="cs-type-badge" style="background:${cfg.color}">${escapeHtml(cfg.label)}</span>`;
}

function renderActionCard(action, index) {
  const excluded = action.excluded ? 'cs-action-excluded' : '';
  const checked = action.excluded ? '' : 'checked';
  const parsed = action.parsed || {};

  let fieldsHtml = '';
  if (parsed.title) fieldsHtml += `<div class="cs-field"><strong>Title:</strong> ${escapeHtml(parsed.title)}</div>`;
  if (parsed.content) fieldsHtml += `<div class="cs-field"><strong>Content:</strong> ${escapeHtml(parsed.content)}</div>`;
  if (parsed.date) fieldsHtml += `<div class="cs-field"><strong>Date:</strong> ${escapeHtml(parsed.date)}</div>`;
  if (parsed.shift) fieldsHtml += `<div class="cs-field"><strong>Shift:</strong> ${escapeHtml(parsed.shift)}</div>`;
  if (parsed.dish_name) fieldsHtml += `<div class="cs-field"><strong>Dish:</strong> ${escapeHtml(parsed.dish_name)}</div>`;
  if (parsed.menu_name) fieldsHtml += `<div class="cs-field"><strong>Menu:</strong> ${escapeHtml(parsed.menu_name)}</div>`;
  if (parsed.action) fieldsHtml += `<div class="cs-field"><strong>Action:</strong> ${escapeHtml(parsed.action)}</div>`;

  return `
    <div class="cs-action-card cs-preview-card ${excluded}" data-index="${index}">
      <div class="cs-action-header">
        <label class="cs-action-check">
          <input type="checkbox" ${checked} data-index="${index}">
        </label>
        ${typeBadge(action.type)}
        ${confidenceDot(action.confidence)}
      </div>
      <div class="cs-raw-text">${escapeHtml(action.raw_text)}</div>
      <div class="cs-parsed-fields">${fieldsHtml}</div>
      <button class="btn btn-sm cs-edit-btn" data-index="${index}">Edit</button>
    </div>
  `;
}

function renderEditModal(action, index, onSave) {
  const parsed = action.parsed || {};
  const fields = ['title', 'content', 'date', 'shift', 'dish_name', 'menu_name', 'action', 'priority', 'timing_bucket'];

  const fieldsHtml = fields.map(f => {
    const val = parsed[f] || '';
    const label = f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `
      <div class="form-group">
        <label>${escapeHtml(label)}</label>
        <input type="text" name="${f}" value="${escapeHtml(val)}" class="form-control">
      </div>
    `;
  }).join('');

  const html = `
    <form id="cs-edit-form">
      <div class="form-group">
        <label>Type</label>
        <select name="type" class="form-control">
          ${Object.keys(TYPE_CONFIG).map(t =>
    `<option value="${t}" ${t === action.type ? 'selected' : ''}>${escapeHtml(TYPE_CONFIG[t].label)}</option>`
  ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Raw Text</label>
        <textarea name="raw_text" class="form-control" rows="2">${escapeHtml(action.raw_text)}</textarea>
      </div>
      ${fieldsHtml}
      <button type="submit" class="btn btn-primary" style="margin-top:12px">Save</button>
    </form>
  `;

  openModal('Edit Action', html);

  document.getElementById('cs-edit-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const updated = {
      ...action,
      type: form.type.value,
      raw_text: form.raw_text.value,
      parsed: {},
    };
    fields.forEach(f => {
      const val = form[f].value.trim();
      if (val) updated.parsed[f] = val;
    });
    onSave(index, updated);
    closeModal();
  });
}

export async function renderChefSheetPreview(container, id) {
  container.innerHTML = loadingHTML();

  let sheet;
  try {
    sheet = await getChefSheet(id);
  } catch (err) {
    container.innerHTML = `<div class="empty-message">ChefSheet not found</div>`;
    return;
  }

  const actions = sheet.raw_parse || [];
  const isConfirmed = sheet.status === 'confirmed';
  const executionLog = sheet.execution_log || [];

  function render() {
    const includedCount = actions.filter(a => !a.excluded).length;

    container.innerHTML = `
      <div class="page-header">
        <h1>ChefSheet Review</h1>
        <a href="#/chefsheet" class="btn">Back</a>
      </div>

      <div class="cs-preview-layout">
        <div class="cs-photo-section">
          <img src="${escapeHtml(sheet.photo_path)}" alt="ChefSheet photo" class="cs-photo-thumb" id="cs-photo-thumb">
        </div>

        <div class="cs-actions-section">
          ${isConfirmed ? `<div class="cs-confirmed-banner">Actions executed successfully</div>` : ''}

          <div id="cs-action-list">
            ${actions.length === 0
    ? '<p class="empty-message">No actions detected</p>'
    : actions.map((a, i) => renderActionCard(a, i)).join('')
}
          </div>

          ${isConfirmed ? renderSummary(executionLog) : `
            <div class="cs-sticky-bar">
              <button class="btn" id="cs-cancel-btn">Cancel</button>
              <button class="btn btn-primary" id="cs-confirm-btn" ${includedCount === 0 ? 'disabled' : ''}>
                Execute ${includedCount} Item${includedCount !== 1 ? 's' : ''}
              </button>
            </div>
          `}
        </div>
      </div>
    `;

    // Photo lightbox
    container.querySelector('#cs-photo-thumb')?.addEventListener('click', () => {
      openModal('ChefSheet Photo', `<img src="${escapeHtml(sheet.photo_path)}" style="width:100%;border-radius:8px">`);
    });

    // Checkboxes
    container.querySelectorAll('.cs-action-check input').forEach(cb => {
      cb.addEventListener('change', () => {
        const idx = parseInt(cb.dataset.index);
        actions[idx].excluded = !cb.checked;
        render();
        saveActions();
      });
    });

    // Edit buttons
    container.querySelectorAll('.cs-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        renderEditModal(actions[idx], idx, (i, updated) => {
          actions[i] = updated;
          render();
          saveActions();
        });
      });
    });

    // Cancel
    container.querySelector('#cs-cancel-btn')?.addEventListener('click', () => {
      window.location.hash = '#/chefsheet';
    });

    // Confirm
    container.querySelector('#cs-confirm-btn')?.addEventListener('click', async () => {
      const btn = container.querySelector('#cs-confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Executing...';

      try {
        await saveActions();
        const result = await confirmChefSheet(id);
        showToast(formatSummary(result.summary), 'success', 5000);
        // Reload to show confirmed state
        sheet = await getChefSheet(id);
        render();
      } catch (err) {
        showToast(err.message || 'Execution failed', 'error');
        btn.disabled = false;
        btn.textContent = `Execute ${actions.filter(a => !a.excluded).length} Items`;
      }
    });
  }

  async function saveActions() {
    try {
      if (sheet.status === 'parsed') {
        await updateChefSheetActions(id, actions);
      }
    } catch {
      // Silently fail — actions are saved locally anyway
    }
  }

  render();
}

function renderSummary(log) {
  if (!log || !log.length) return '';

  const successes = log.filter(r => !r.error);
  const errors = log.filter(r => r.error);

  return `
    <div class="cs-summary">
      <h3>Execution Summary</h3>
      ${successes.length ? `
        <div class="cs-summary-success">
          ${successes.map(r => `<div class="cs-summary-item">${escapeHtml(r.type)}: ${escapeHtml(r.title || r.note || r.action || 'done')}</div>`).join('')}
        </div>
      ` : ''}
      ${errors.length ? `
        <div class="cs-summary-errors">
          <h4>Issues</h4>
          ${errors.map(r => `<div class="cs-summary-item cs-summary-error">${escapeHtml(r.type)}: ${escapeHtml(r.error)}</div>`).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function formatSummary(summary) {
  const parts = [];
  if (summary.tasks) parts.push(`${summary.tasks} task${summary.tasks > 1 ? 's' : ''}`);
  if (summary.service_notes) parts.push(`${summary.service_notes} note${summary.service_notes > 1 ? 's' : ''}`);
  if (summary.menu_changes) parts.push(`${summary.menu_changes} menu change${summary.menu_changes > 1 ? 's' : ''}`);
  if (summary.orders) parts.push(`${summary.orders} order${summary.orders > 1 ? 's' : ''}`);
  if (summary.recipe_notes) parts.push(`${summary.recipe_notes} recipe note${summary.recipe_notes > 1 ? 's' : ''}`);
  return parts.length ? `Created: ${parts.join(', ')}` : 'No actions executed';
}
