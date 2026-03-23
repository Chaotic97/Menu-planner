import { createTask, aiCommand, aiConfirm, aiUndo, aiVoice, createConversation, addConversationMessage, getAiSuggestions } from '../api.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { toggleDrawer } from './chatDrawer.js';
import { createMicButton } from '../utils/speechToText.js';

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
let suggestionsEl = null;
let isVisible = false;
let isAiMode = true;
let isProcessing = false;
let currentConfirmationId = null;
let _currentToolName = null;
let _commandBarConversationId = null;
const _sessionApprovedTools = new Set();

/**
 * Static suggested prompts — always-available fallbacks per page
 */
const STATIC_PROMPTS = {
  '#/dishes': [
    { icon: '🔍', text: 'Search for a dish', prompt: 'Search dishes: ' },
    { icon: '➕', text: 'Create a new dish', prompt: 'Create a dish called ' },
    { icon: '📊', text: 'Get a system overview', prompt: 'Give me an overview of all my data' },
  ],
  '#/dishes/:id': [
    { icon: '🧪', text: 'Check allergens', prompt: 'Check the allergens on this dish' },
    { icon: '📐', text: 'Scale this recipe', prompt: 'Scale this recipe to 20 portions' },
    { icon: '🔄', text: 'Convert a unit', prompt: 'Convert 500ml cream to cups' },
  ],
  '#/menus': [
    { icon: '➕', text: 'Create a new menu', prompt: 'Create a menu called ' },
    { icon: '🔍', text: 'Search menus', prompt: 'Show me all my menus' },
    { icon: '📊', text: 'Get system overview', prompt: 'Give me an overview of all my data' },
  ],
  '#/menus/:id': [
    { icon: '🍽️', text: 'Add a dish to this menu', prompt: 'Add ' },
    { icon: '💰', text: 'Check food cost', prompt: 'What is the food cost on this menu?' },
    { icon: '🛒', text: 'Get shopping list', prompt: 'Get the shopping list for this menu' },
  ],
  '#/todos': [
    { icon: '➕', text: 'Add a task', prompt: 'Create a task: ' },
    { icon: '📋', text: 'Search tasks', prompt: 'Show me overdue tasks' },
    { icon: '📊', text: 'Task summary', prompt: 'Give me a summary of my tasks' },
  ],
  '#/shopping': [
    { icon: '🛒', text: 'Get shopping list', prompt: 'Get the shopping list' },
    { icon: '🔍', text: 'Search ingredients', prompt: 'Search ingredients: ' },
  ],
  '#/service-notes': [
    { icon: '📝', text: 'Add a service note', prompt: 'Add a service note: ' },
    { icon: '🔍', text: 'Search notes', prompt: 'Search service notes for ' },
  ],
  '_default': [
    { icon: '🔍', text: 'Search dishes', prompt: 'Search dishes: ' },
    { icon: '➕', text: 'Create a task', prompt: 'Create a task: ' },
    { icon: '📊', text: 'System overview', prompt: 'Give me an overview of all my data' },
  ],
};

// Dynamic suggestions cache — fetched lazily, refreshed on navigation
let _dynamicCache = { page: null, hints: [], time: 0 };
const DYNAMIC_CACHE_TTL = 60000; // 60 seconds

function getStaticForPage() {
  const hash = window.location.hash || '';
  if (hash.match(/^#\/dishes\/\d+(\/edit)?$/)) return STATIC_PROMPTS['#/dishes/:id'];
  if (hash.match(/^#\/menus\/\d+$/)) return STATIC_PROMPTS['#/menus/:id'];
  if (hash === '#/dishes' || hash === '#/' || hash === '') return STATIC_PROMPTS['#/dishes'];
  if (hash === '#/menus') return STATIC_PROMPTS['#/menus'];
  if (hash === '#/todos') return STATIC_PROMPTS['#/todos'];
  if (hash === '#/shopping' || hash.match(/^#\/menus\/\d+\/shopping$/)) return STATIC_PROMPTS['#/shopping'];
  if (hash === '#/service-notes') return STATIC_PROMPTS['#/service-notes'];
  return STATIC_PROMPTS['_default'];
}

function getSuggestionsForPage() {
  const hash = window.location.hash || '';
  const staticList = getStaticForPage();

  // If we have fresh dynamic hints, put them first then fill with static
  if (_dynamicCache.page === hash && Date.now() - _dynamicCache.time < DYNAMIC_CACHE_TTL && _dynamicCache.hints.length) {
    const maxDynamic = 2;
    const dynamic = _dynamicCache.hints.slice(0, maxDynamic);
    const remaining = staticList.filter(s => !dynamic.some(d => d.prompt === s.prompt));
    return [...dynamic, ...remaining.slice(0, 3 - dynamic.length)];
  }

  return staticList;
}

/**
 * Fetch dynamic suggestions in background — non-blocking, fire-and-forget
 */
function refreshDynamicSuggestions() {
  const hash = window.location.hash || '';
  if (_dynamicCache.page === hash && Date.now() - _dynamicCache.time < DYNAMIC_CACHE_TTL) return;

  getAiSuggestions(hash).then(data => {
    _dynamicCache = { page: hash, hints: data.suggestions || [], time: Date.now() };
    // If suggestions are currently visible and input is empty, refresh them
    if (suggestionsEl && suggestionsEl.classList.contains('cb-suggestions-visible')) {
      const input = barEl ? barEl.querySelector('.cb-input') : null;
      if (input && !input.value.trim()) {
        showSuggestions();
      }
    }
  }).catch(() => {
    // Silent fail — static suggestions remain
  });
}

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
      <input type="text" class="cb-input" autocorrect="off" placeholder="${isAiMode ? 'Ask AI or add a task...' : 'Quick add a task...'}" aria-label="Command bar input">
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

  // Insert mic button between input and send — local Whisper or cloud Gemini
  const micBtn = createMicButton(input);
  sendBtn.parentNode.insertBefore(micBtn, sendBtn);

  // Cloud voice mic button (Gemini transcription)
  const cloudMicBtn = document.createElement('button');
  cloudMicBtn.className = 'cb-cloud-mic';
  cloudMicBtn.title = 'Cloud voice (Gemini)';
  cloudMicBtn.setAttribute('aria-label', 'Cloud voice input');
  cloudMicBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><circle cx="18" cy="5" r="2" fill="currentColor" stroke="none" opacity="0.6"/></svg>`;
  cloudMicBtn.style.display = 'none'; // Hidden by default, toggled via settings
  sendBtn.parentNode.insertBefore(cloudMicBtn, sendBtn);

  let _cloudRecording = false;
  let _cloudMediaRecorder = null;
  let _cloudChunks = [];

  cloudMicBtn.addEventListener('click', async () => {
    if (_cloudRecording) {
      // Stop recording
      if (_cloudMediaRecorder && _cloudMediaRecorder.state !== 'inactive') {
        _cloudMediaRecorder.stop();
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _cloudChunks = [];
      _cloudMediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      _cloudMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) _cloudChunks.push(e.data);
      };

      _cloudMediaRecorder.onstop = async () => {
        _cloudRecording = false;
        cloudMicBtn.classList.remove('cb-cloud-mic--recording');
        stream.getTracks().forEach(t => t.stop());

        if (!_cloudChunks.length) return;

        const blob = new Blob(_cloudChunks, { type: 'audio/webm' });
        cloudMicBtn.disabled = true;

        try {
          const context = getPageContext();
          const result = await aiVoice(blob, context);
          if (result.text) {
            input.value = result.text;
            input.focus();
          }
        } catch (err) {
          showToast('Voice transcription failed: ' + err.message, 'error');
        } finally {
          cloudMicBtn.disabled = false;
        }
      };

      _cloudMediaRecorder.start();
      _cloudRecording = true;
      cloudMicBtn.classList.add('cb-cloud-mic--recording');

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (_cloudRecording && _cloudMediaRecorder && _cloudMediaRecorder.state !== 'inactive') {
          _cloudMediaRecorder.stop();
        }
      }, 30000);
    } catch (err) {
      showToast('Microphone access denied', 'error');
    }
  });

  // Check voice mode preference and toggle buttons
  function updateVoiceMode() {
    const mode = localStorage.getItem('voice_mode') || 'local';
    micBtn.style.display = mode === 'local' ? '' : 'none';
    cloudMicBtn.style.display = mode === 'cloud' ? '' : 'none';
  }
  updateVoiceMode();
  window.addEventListener('storage', (e) => {
    if (e.key === 'voice_mode') updateVoiceMode();
  });
  window.addEventListener('voicemode:changed', updateVoiceMode);

  // Create suggestions dropdown
  suggestionsEl = document.createElement('div');
  suggestionsEl.className = 'cb-suggestions';
  suggestionsEl.id = 'cb-suggestions';
  barEl.querySelector('.cb-inner').appendChild(suggestionsEl);

  // Show suggestions on focus (when input is empty and in AI mode)
  input.addEventListener('focus', () => {
    if (isAiMode && !input.value.trim() && !currentConfirmationId && !isProcessing) {
      refreshDynamicSuggestions();
      showSuggestions();
    }
  });
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      hideSuggestions();
    } else if (isAiMode && !currentConfirmationId && !isProcessing) {
      showSuggestions();
    }
  });
  input.addEventListener('blur', () => {
    // Delay to allow click on suggestion
    setTimeout(hideSuggestions, 150);
  });

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

    hideSuggestions();

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
      if (currentConfirmationId || previewEl?.classList.contains('cb-preview-visible')) {
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
 * Save a command bar exchange to chat drawer conversation history
 */
async function saveToChatHistory(userMessage, assistantResponse) {
  try {
    if (!_commandBarConversationId) {
      const conv = await createConversation('');
      _commandBarConversationId = conv.id;
    }
    await addConversationMessage(_commandBarConversationId, 'user', userMessage);
    await addConversationMessage(_commandBarConversationId, 'assistant', assistantResponse);
  } catch {
    // Non-critical — don't block the UI
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
    const payload = { message: text, context };
    if (_sessionApprovedTools.size > 0) {
      payload.approvedTools = [..._sessionApprovedTools];
    }
    const result = await aiCommand(payload);

    if (result.needsSetup) {
      showPreviewMessage(result.response, 'warning');
      return;
    }

    if (result.rateLimited) {
      showPreviewMessage(result.response, 'warning');
      return;
    }

    if (result.autoExecuted) {
      // Auto-executed tool — show result directly
      dismissPreview();
      if (result.undoId) {
        showToast(result.response || 'Done', 'success', 15000, {
          label: 'Undo',
          onClick: () => handleUndo(result.undoId),
        });
      } else {
        showPreviewMessage(result.response, 'info');
      }
      input.value = '';
      if (result.navigateTo) {
        window.location.hash = result.navigateTo;
      }
      window.dispatchEvent(new CustomEvent('quickcapture:created'));
      // Save to chat history
      saveToChatHistory(text, result.response || 'Done');
    } else if (result.confirmationId) {
      // Show confirmation preview
      currentConfirmationId = result.confirmationId;
      _currentToolName = result.toolName;
      showConfirmationPreview(result.response, result.preview);
      input.value = '';
      // Save the prompt and pending response to chat history
      saveToChatHistory(text, result.response);
    } else {
      // Text-only response
      showPreviewMessage(result.response, 'info');
      input.value = '';
      // Save to chat history
      saveToChatHistory(text, result.response);
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
        <button class="btn btn-primary btn-sm cb-confirm-all-btn" title="Auto-approve this action type for the rest of this session">Confirm All</button>
        <button class="btn btn-secondary btn-sm cb-cancel-btn">Cancel</button>
      </div>
    </div>
  `;
  previewEl.classList.add('cb-preview-visible');

  previewEl.querySelector('.cb-confirm-btn')?.addEventListener('click', handleConfirm);
  previewEl.querySelector('.cb-confirm-all-btn')?.addEventListener('click', handleConfirmAll);
  previewEl.querySelector('.cb-cancel-btn')?.addEventListener('click', dismissPreview);
}

/**
 * Handle confirmation. Returns true if the action succeeded.
 */
async function handleConfirm() {
  if (!currentConfirmationId) return false;

  const confirmId = currentConfirmationId;
  currentConfirmationId = null;

  // Show processing
  showProcessing();

  try {
    const result = await aiConfirm(confirmId);

    dismissPreview();

    if (result.success === false) {
      showToast(result.response || 'Action failed', 'error');
      return false;
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

    // Save confirmation result to chat history
    saveToChatHistory('(confirmed action)', result.response || 'Done');

    // Navigate if requested
    if (result.navigateTo) {
      window.location.hash = result.navigateTo;
    }

    // Notify other components
    window.dispatchEvent(new CustomEvent('quickcapture:created'));
    return true;
  } catch (err) {
    dismissPreview();
    showToast(err.message || 'Failed to execute action', 'error');
    return false;
  }
}

/**
 * Handle "Confirm All" — approve this action AND auto-approve this tool type for the session.
 * After successful confirmation, auto-resume the AI to continue remaining operations.
 */
async function handleConfirmAll() {
  if (_currentToolName) {
    _sessionApprovedTools.add(_currentToolName);
  }
  const success = await handleConfirm();

  // Auto-resume: send a follow-up so the AI continues with remaining items
  if (success && _sessionApprovedTools.size > 0) {
    const input = barEl?.querySelector('.cb-input');
    const sendBtn = barEl?.querySelector('.cb-send');
    if (input && sendBtn) {
      await submitAiCommand('Continue with the remaining items.', input, sendBtn);
    }
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

/**
 * Show context-aware suggested prompts dropdown
 */
function showSuggestions() {
  if (!suggestionsEl || !barEl) return;
  const suggestions = getSuggestionsForPage();
  if (!suggestions || !suggestions.length) return;

  suggestionsEl.innerHTML = suggestions.map(s => `
    <button class="cb-suggestion" data-prompt="${escapeHtml(s.prompt)}" type="button">
      <span class="cb-suggestion-icon">${s.icon}</span>
      <span class="cb-suggestion-text">${escapeHtml(s.text)}</span>
    </button>
  `).join('');

  suggestionsEl.querySelectorAll('.cb-suggestion').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent blur
      const prompt = btn.dataset.prompt;
      const input = barEl.querySelector('.cb-input');
      if (input) {
        input.value = prompt;
        input.focus();
        // Place cursor at end
        input.setSelectionRange(prompt.length, prompt.length);
      }
      hideSuggestions();
    });
  });

  suggestionsEl.classList.add('cb-suggestions-visible');
}

/**
 * Hide the suggestions dropdown
 */
function hideSuggestions() {
  if (suggestionsEl) {
    suggestionsEl.classList.remove('cb-suggestions-visible');
  }
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
    hideSuggestions();
    refreshDynamicSuggestions();
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
