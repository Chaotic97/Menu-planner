import { createTask, aiCommand, aiConfirm, aiUndo } from '../api.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { toggleDrawer } from './chatDrawer.js';

// Routes where command bar should be hidden
const HIDDEN_ROUTES = [
  /^#\/dishes\/new$/,
  /^#\/dishes\/\d+\/edit$/,
  /^#\/menus\/\d+$/,
  /^#\/service-notes$/,
  /^#\/settings$/,
  /^#\/login$/,
];

let barEl = null;
let previewEl = null;
let isVisible = false;
let isAiMode = true;
let isProcessing = false;
let currentConfirmationId = null;
let _currentToolName = null;

function shouldShow(hash) {
  if (!hash) return false;
  for (const pattern of HIDDEN_ROUTES) {
    if (pattern.test(hash)) return false;
  }
  if (hash === '#/login' || hash.startsWith('#/reset-password')) return false;
  return true;
}

/**
 * Get current page context for AI
 */
function getPageContext() {
  const hash = window.location.hash || '';
  const ctx = { page: hash };

  // Dish view or edit
  const dishMatch = hash.match(/^#\/dishes\/(\d+)(\/edit)?$/);
  if (dishMatch) {
    ctx.entityType = 'dish';
    ctx.entityId = parseInt(dishMatch[1]);
  }

  // Menu builder
  const menuMatch = hash.match(/^#\/menus\/(\d+)$/);
  if (menuMatch) {
    ctx.entityType = 'menu';
    ctx.entityId = parseInt(menuMatch[1]);
  }

  return ctx;
}

/**
 * Sparkle icon for AI mode
 */
const sparkleIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/>
  <path d="M19 15l.5 1.5L21 17l-1.5.5L19 19l-.5-1.5L17 17l1.5-.5L19 15z" opacity="0.6"/>
</svg>`;

/**
 * Plus icon for plain task mode
 */
const plusIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
</svg>`;

/**
 * Create the command bar element
 */
function createBar() {
  if (barEl) return barEl;

  // Detect online status
  isAiMode = navigator.onLine;

  barEl = document.createElement('div');
  barEl.className = 'cb-bar';
  barEl.innerHTML = `
    <div class="cb-preview" id="cb-preview"></div>
    <div class="cb-inner">
      <button class="cb-mode-toggle" title="Toggle AI mode" aria-label="Toggle AI mode">
        <span class="cb-mode-icon">${isAiMode ? sparkleIcon : plusIcon}</span>
      </button>
      <input type="text" class="cb-input" placeholder="${isAiMode ? 'Ask AI or add a task...' : 'Quick add a task...'}" aria-label="Command bar input">
      <button class="cb-send" title="${isAiMode ? 'Send to AI' : 'Add task'}" aria-label="${isAiMode ? 'Send to AI' : 'Add task'}">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
      <button class="cb-chat-toggle" title="Open chat (Ctrl+Shift+K)" aria-label="Open AI chat drawer">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>
  `;

  previewEl = barEl.querySelector('#cb-preview');
  const input = barEl.querySelector('.cb-input');
  const sendBtn = barEl.querySelector('.cb-send');
  const modeToggle = barEl.querySelector('.cb-mode-toggle');

  // Chat drawer toggle
  const chatToggle = barEl.querySelector('.cb-chat-toggle');
  chatToggle.addEventListener('click', () => toggleDrawer());

  // Mode toggle
  modeToggle.addEventListener('click', () => {
    if (!navigator.onLine) {
      showToast('AI features require an internet connection', 'warning');
      return;
    }
    isAiMode = !isAiMode;
    updateModeUI();
  });

  // Submit handler
  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    if (isProcessing) return;

    if (isAiMode) {
      await submitAiCommand(text, input, sendBtn);
    } else {
      await submitPlainTask(text, input, sendBtn);
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      if (currentConfirmationId) {
        dismissPreview();
      } else {
        input.blur();
      }
    }
  });

  sendBtn.addEventListener('click', submit);

  // Online/offline detection
  window.addEventListener('online', () => {
    isAiMode = true;
    updateModeUI();
  });
  window.addEventListener('offline', () => {
    isAiMode = false;
    updateModeUI();
    dismissPreview();
  });

  document.body.appendChild(barEl);
  return barEl;
}

/**
 * Update UI elements based on current mode
 */
function updateModeUI() {
  if (!barEl) return;
  const input = barEl.querySelector('.cb-input');
  const modeIcon = barEl.querySelector('.cb-mode-icon');
  const sendBtn = barEl.querySelector('.cb-send');

  input.placeholder = isAiMode ? 'Ask AI or add a task...' : 'Quick add a task...';
  modeIcon.innerHTML = isAiMode ? sparkleIcon : plusIcon;
  sendBtn.title = isAiMode ? 'Send to AI' : 'Add task';

  barEl.classList.toggle('cb-ai-mode', isAiMode);
}

/**
 * Submit as plain task (offline/plain mode)
 */
async function submitPlainTask(text, input, sendBtn) {
  isProcessing = true;
  sendBtn.disabled = true;
  input.disabled = true;

  try {
    const today = new Date().toISOString().slice(0, 10);
    await createTask({ title: text, due_date: today, type: 'custom', priority: 'medium' });
    input.value = '';
    showToast('Task added to today', 'success');
    window.dispatchEvent(new CustomEvent('quickcapture:created'));
  } catch (err) {
    showToast('Failed to add task: ' + err.message, 'error');
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

/**
 * Submit as AI command
 */
async function submitAiCommand(text, input, sendBtn) {
  isProcessing = true;
  sendBtn.disabled = true;
  input.disabled = true;
  showProcessing();

  try {
    const context = getPageContext();
    const result = await aiCommand({ message: text, context });

    if (result.needsSetup) {
      showPreviewMessage(result.response, 'warning');
      return;
    }

    if (result.rateLimited) {
      showPreviewMessage(result.response, 'warning');
      return;
    }

    if (result.confirmationId) {
      // Show confirmation preview
      currentConfirmationId = result.confirmationId;
      _currentToolName = result.toolName;
      showConfirmationPreview(result.response, result.preview);
      input.value = '';
    } else {
      // Text-only response
      showPreviewMessage(result.response, 'info');
      input.value = '';
    }
  } catch (err) {
    showPreviewMessage(err.message || 'AI request failed', 'error');
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

/**
 * Show processing indicator
 */
function showProcessing() {
  if (!previewEl) return;
  previewEl.innerHTML = `
    <div class="cb-preview-card cb-processing">
      <div class="cb-preview-spinner"></div>
      <span>Thinking...</span>
    </div>
  `;
  previewEl.classList.add('cb-preview-visible');
}

/**
 * Show a simple message in the preview area
 */
function showPreviewMessage(message, type) {
  if (!previewEl) return;
  const typeClass = type ? `cb-preview-${type}` : '';
  previewEl.innerHTML = `
    <div class="cb-preview-card ${typeClass}">
      <div class="cb-preview-message">${escapeHtml(message)}</div>
      <button class="cb-preview-dismiss" title="Dismiss">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  `;
  previewEl.classList.add('cb-preview-visible');

  previewEl.querySelector('.cb-preview-dismiss')?.addEventListener('click', dismissPreview);

  // Auto-dismiss info messages after 6s
  if (type === 'info') {
    setTimeout(() => {
      if (previewEl?.classList.contains('cb-preview-visible')) {
        dismissPreview();
      }
    }, 6000);
  }
}

/**
 * Show confirmation preview with Confirm/Cancel buttons
 */
function showConfirmationPreview(message, preview) {
  if (!previewEl) return;

  previewEl.innerHTML = `
    <div class="cb-preview-card cb-preview-confirm">
      <div class="cb-preview-message">${escapeHtml(message)}</div>
      ${preview ? `<div class="cb-preview-action">${escapeHtml(preview)}</div>` : ''}
      <div class="cb-preview-buttons">
        <button class="btn btn-primary btn-sm cb-confirm-btn">Confirm</button>
        <button class="btn btn-secondary btn-sm cb-cancel-btn">Cancel</button>
      </div>
    </div>
  `;
  previewEl.classList.add('cb-preview-visible');

  previewEl.querySelector('.cb-confirm-btn')?.addEventListener('click', handleConfirm);
  previewEl.querySelector('.cb-cancel-btn')?.addEventListener('click', dismissPreview);
}

/**
 * Handle confirmation
 */
async function handleConfirm() {
  if (!currentConfirmationId) return;

  const confirmId = currentConfirmationId;
  currentConfirmationId = null;

  // Show processing
  showProcessing();

  try {
    const result = await aiConfirm(confirmId);

    dismissPreview();

    if (result.success === false) {
      showToast(result.response || 'Action failed', 'error');
      return;
    }

    // Success toast with undo option
    const undoId = result.undoId;
    if (undoId) {
      showToast(result.response || 'Done', 'success', 15000, {
        label: 'Undo',
        onClick: () => handleUndo(undoId),
      });
    } else {
      showToast(result.response || 'Done', 'success');
    }

    // Navigate if requested
    if (result.navigateTo) {
      window.location.hash = result.navigateTo;
    }

    // Notify other components
    window.dispatchEvent(new CustomEvent('quickcapture:created'));
  } catch (err) {
    dismissPreview();
    showToast(err.message || 'Failed to execute action', 'error');
  }
}

/**
 * Handle undo
 */
async function handleUndo(undoId) {
  try {
    const result = await aiUndo(undoId);
    showToast(result.message || 'Undone', 'success');
    // Refresh current page
    window.dispatchEvent(new CustomEvent('quickcapture:created'));
    window.dispatchEvent(new Event('hashchange'));
  } catch (err) {
    showToast(err.message || 'Undo failed', 'error');
  }
}

/**
 * Dismiss the preview card
 */
function dismissPreview() {
  if (!previewEl) return;
  previewEl.classList.remove('cb-preview-visible');
  previewEl.innerHTML = '';
  currentConfirmationId = null;
  _currentToolName = null;
}

function syncAppContentPadding(show) {
  const appContent = document.getElementById('app-content');
  if (appContent) {
    appContent.classList.toggle('qc-bar-active', show);
  }
}

export function initCommandBar() {
  createBar();
  updateModeUI();
  updateVisibility(window.location.hash);

  window.addEventListener('hashchange', () => {
    updateVisibility(window.location.hash);
    dismissPreview();
  });

  // Keyboard shortcut: Ctrl/Cmd+K to focus
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      const input = barEl?.querySelector('.cb-input');
      if (input && isVisible) {
        input.focus();
        input.select();
      }
    }
  });
}

export function updateVisibility(hash) {
  if (!barEl) return;
  const show = shouldShow(hash);
  if (show && !isVisible) {
    barEl.classList.add('cb-bar-visible');
    isVisible = true;
    syncAppContentPadding(true);
  } else if (!show && isVisible) {
    barEl.classList.remove('cb-bar-visible');
    isVisible = false;
    syncAppContentPadding(false);
    dismissPreview();
  }
}

export function showCommandBar() {
  if (barEl) {
    barEl.classList.add('cb-bar-visible');
    isVisible = true;
    syncAppContentPadding(true);
  }
}

export function hideCommandBar() {
  if (barEl) {
    barEl.classList.remove('cb-bar-visible');
    isVisible = false;
    syncAppContentPadding(false);
    dismissPreview();
  }
}
