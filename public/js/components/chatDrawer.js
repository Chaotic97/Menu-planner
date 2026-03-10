/**
 * Chat Drawer — conversational AI panel with streaming responses.
 * Slides out from the right with multi-turn conversation support.
 * Features: markdown rendering, SSE streaming, tool/context indicators.
 * Conversations are saved to the database and persist across sessions.
 * Auto-clears after 1 hour of inactivity. Session viewer for past conversations.
 */

import { aiCommandStream, aiConfirm, aiUndo, aiExtractText, getConversations, createConversation, getConversationMessages, addConversationMessage, deleteConversation } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { renderMarkdown } from '../utils/markdown.js';
import { showToast } from './toast.js';
import { createMicButton } from '../utils/speechToText.js';

let drawerEl = null;
let fabEl = null;
let isOpen = false;
let conversationHistory = [];
let currentConversationId = null;
let lastActivityTime = Date.now();
let isSending = false;
let showingHistory = false;
let currentStream = null;
let pendingAttachment = null; // { file, extractedText }
let sendingWatchdog = null; // Watchdog timer to auto-recover from stuck state
const sessionApprovedTools = new Set();

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const MAX_HISTORY_LENGTH = 100; // Cap in-memory history to prevent unbounded growth
const SENDING_WATCHDOG_MS = 60 * 1000; // 60s max for any single AI interaction
const STREAM_THROTTLE_MS = 50; // Batch streaming text re-renders

// Tool name → friendly label map
const TOOL_LABELS = {
  search_dishes: 'Searching dishes',
  lookup_dish: 'Looking up dish',
  lookup_menu: 'Looking up menu',
  search_ingredients: 'Searching ingredients',
  search_tasks: 'Searching tasks',
  search_service_notes: 'Searching notes',
  get_shopping_list: 'Fetching shopping list',
  get_system_summary: 'Getting system overview',
  create_menu: 'Creating menu',
  create_dish: 'Creating dish',
  create_task: 'Creating task',
  add_dish_to_menu: 'Adding dish to menu',
  add_service_note: 'Adding service note',
  cleanup_recipe: 'Cleaning up recipe',
  check_allergens: 'Checking allergens',
  scale_recipe: 'Scaling recipe',
  convert_units: 'Converting units',
};

function getToolLabel(name) {
  return TOOL_LABELS[name] || name.replace(/_/g, ' ');
}

/** Track the last user message for retry functionality */
let lastUserMessage = '';

/**
 * Set the sending state and arm/disarm the watchdog timer.
 * Swaps send button ↔ stop button. If stuck for >60s, auto-recover with inline retry.
 */
function setSending(active) {
  isSending = active;
  if (sendingWatchdog) {
    clearTimeout(sendingWatchdog);
    sendingWatchdog = null;
  }

  // Swap send ↔ stop button
  if (drawerEl) {
    const inputRow = drawerEl.querySelector('.chat-drawer-input-row');
    if (inputRow) {
      const sendBtn = inputRow.querySelector('.chat-drawer-send');
      const stopBtn = inputRow.querySelector('.chat-drawer-stop');
      if (active) {
        if (sendBtn) sendBtn.style.display = 'none';
        if (!stopBtn) {
          const btn = document.createElement('button');
          btn.className = 'chat-drawer-stop';
          btn.title = 'Stop generating';
          btn.setAttribute('aria-label', 'Stop generating');
          btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
          btn.addEventListener('click', stopGenerating);
          inputRow.appendChild(btn);
        }
      } else {
        if (stopBtn) stopBtn.remove();
        if (sendBtn) sendBtn.style.display = '';
      }
    }
  }

  if (active) {
    sendingWatchdog = setTimeout(() => {
      console.warn('Chat drawer: sending watchdog fired — auto-recovering from stuck state');
      cleanupSendingState();
      // Inline error with retry button instead of just a toast
      appendErrorWithRetry('The assistant took too long to respond.');
    }, SENDING_WATCHDOG_MS);
  }
}

/**
 * Stop the current AI generation.
 */
function stopGenerating() {
  if (currentStream) {
    currentStream.abort();
    currentStream = null;
  }
  cleanupSendingState();
  // Mark the current streaming message as stopped
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    const streamingMsg = messagesEl.querySelector('.chat-msg-streaming');
    if (streamingMsg) {
      const textEl = streamingMsg.querySelector('.chat-msg-text');
      if (textEl) {
        const stopped = document.createElement('span');
        stopped.className = 'chat-error-text';
        stopped.textContent = ' [Stopped]';
        textEl.appendChild(stopped);
      }
      streamingMsg.classList.remove('chat-msg-streaming');
    }
  }
}

/**
 * Reset all sending-related state. Used by watchdog and stop button.
 */
function cleanupSendingState() {
  isSending = false;
  if (sendingWatchdog) {
    clearTimeout(sendingWatchdog);
    sendingWatchdog = null;
  }
  if (currentStream) {
    currentStream.abort();
    currentStream = null;
  }
  if (drawerEl) {
    const inp = drawerEl.querySelector('.chat-drawer-input');
    const sendBtn = drawerEl.querySelector('.chat-drawer-send');
    const stopBtn = drawerEl.querySelector('.chat-drawer-stop');
    if (inp) inp.disabled = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.display = ''; }
    if (stopBtn) stopBtn.remove();
  }
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    const cursor = messagesEl.querySelector('.chat-stream-cursor');
    if (cursor) cursor.remove();
    const streamingMsg = messagesEl.querySelector('.chat-msg-streaming');
    if (streamingMsg) streamingMsg.classList.remove('chat-msg-streaming');
    // Remove any lingering thinking indicators
    const thinking = messagesEl.querySelector('.chat-thinking-indicator');
    if (thinking) thinking.remove();
  }
}

/**
 * Append an error message with an inline Retry button.
 */
function appendErrorWithRetry(errorMsg) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  const welcome = messagesEl.querySelector('.chat-drawer-welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = 'chat-msg chat-msg-error chat-msg-enter';
  msg.innerHTML = `<div class="chat-msg-text"><div class="chat-inline-error">
    <span>${escapeHtml(errorMsg)}</span>
    <button class="chat-retry-btn">Retry</button>
  </div></div>`;

  msg.querySelector('.chat-retry-btn').addEventListener('click', () => {
    msg.remove();
    if (lastUserMessage && drawerEl) {
      const input = drawerEl.querySelector('.chat-drawer-input');
      if (input) {
        input.value = lastUserMessage;
        const sendBtn = drawerEl.querySelector('.chat-drawer-send');
        if (sendBtn) sendBtn.click();
      }
    }
  });

  msg.addEventListener('animationend', () => msg.classList.remove('chat-msg-enter'));
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function checkSessionTimeout() {
  if (conversationHistory.length === 0) return;
  if (Date.now() - lastActivityTime > SESSION_TIMEOUT_MS) {
    clearChat();
  }
}

function touchSession() {
  lastActivityTime = Date.now();
}

function getPageContext() {
  const hash = window.location.hash || '';
  const ctx = { page: hash };

  const dishMatch = hash.match(/^#\/dishes\/(\d+)(\/edit)?$/);
  if (dishMatch) {
    ctx.entityType = 'dish';
    ctx.entityId = parseInt(dishMatch[1]);
  }

  const menuMatch = hash.match(/^#\/menus\/(\d+)$/);
  if (menuMatch) {
    ctx.entityType = 'menu';
    ctx.entityId = parseInt(menuMatch[1]);
  }

  return ctx;
}

/**
 * Get a human-readable context label for the header
 */
function getContextLabel() {
  const hash = window.location.hash || '';
  if (hash.match(/^#\/dishes\/\d+(\/edit)?$/)) return 'Dish';
  if (hash.match(/^#\/menus\/\d+$/)) return 'Menu';
  if (hash === '#/dishes' || hash === '#/') return 'Dishes';
  if (hash === '#/menus') return 'Menus';
  if (hash === '#/todos') return 'Tasks';
  if (hash === '#/shopping' || hash.match(/^#\/menus\/\d+\/shopping$/)) return 'Shopping';
  if (hash === '#/service-notes') return 'Notes';
  if (hash === '#/specials') return 'Specials';
  return null;
}

function createDrawer() {
  if (drawerEl) return drawerEl;

  drawerEl = document.createElement('div');
  drawerEl.className = 'chat-drawer';
  drawerEl.innerHTML = `
    <div class="chat-drawer-backdrop"></div>
    <div class="chat-drawer-panel">
      <div class="chat-drawer-header">
        <div class="chat-drawer-title-row">
          <h3 class="chat-drawer-title">AI Assistant</h3>
          <span class="chat-context-badge" id="chat-context-badge"></span>
        </div>
        <div class="chat-drawer-header-actions">
          <button class="chat-drawer-history-btn" title="Chat history" aria-label="View chat history">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </button>
          <button class="chat-drawer-new-chat" title="New conversation" aria-label="Start new conversation">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>New Chat</span>
          </button>
          <button class="chat-drawer-close" title="Close" aria-label="Close chat">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-drawer-messages" id="chat-messages">
        <div class="chat-drawer-welcome">
          <p>Ask me anything about your dishes, menus, ingredients, tasks, or kitchen workflow.</p>
          <p class="chat-drawer-welcome-hint">I can search your data, look up details, create tasks, and more.</p>
        </div>
      </div>
      <div class="chat-drawer-attachment-bar" id="chat-attachment-bar" style="display:none;">
        <div class="chat-drawer-attachment-chip">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          <span class="chat-drawer-attachment-name" id="chat-attachment-name"></span>
          <button class="chat-drawer-attachment-remove" id="chat-attachment-remove" title="Remove attachment" aria-label="Remove attachment">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="chat-drawer-input-row">
        <label class="chat-drawer-attach" title="Attach file" aria-label="Attach file">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          <input type="file" class="chat-drawer-file-input" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.doc,.docx">
        </label>
        <input type="text" class="chat-drawer-input" placeholder="Ask anything..." aria-label="Chat input">
        <button class="chat-drawer-send" title="Send" aria-label="Send message">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const backdrop = drawerEl.querySelector('.chat-drawer-backdrop');
  const closeBtn = drawerEl.querySelector('.chat-drawer-close');
  const newChatBtn = drawerEl.querySelector('.chat-drawer-new-chat');
  const historyBtn = drawerEl.querySelector('.chat-drawer-history-btn');
  const input = drawerEl.querySelector('.chat-drawer-input');
  const sendBtn = drawerEl.querySelector('.chat-drawer-send');
  const fileInput = drawerEl.querySelector('.chat-drawer-file-input');

  // Insert mic button between input and send
  const chatMicBtn = createMicButton(input);
  sendBtn.parentNode.insertBefore(chatMicBtn, sendBtn);

  backdrop.addEventListener('click', closeDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  newChatBtn.addEventListener('click', () => {
    clearChat();
    input.focus();
  });
  historyBtn.addEventListener('click', () => {
    if (showingHistory) {
      hideHistoryView();
    } else {
      showHistoryView();
    }
  });

  // File attachment — use change listener only; the <label> natively opens the picker.
  // Do NOT call fileInput.click() manually — on iOS Safari, a <label> wrapping
  // a hidden input already triggers the picker, and a second .click() causes a
  // double-fire that cancels itself out (nothing happens).
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    stageAttachment(file);
    fileInput.value = '';
  });

  const removeAttachBtn = drawerEl.querySelector('#chat-attachment-remove');
  removeAttachBtn.addEventListener('click', clearPendingAttachment);

  async function sendMessage() {
    const userText = input.value.trim();
    const attachment = pendingAttachment;

    // Need either text or attachment to send
    if (!userText && !attachment) return;

    // Safety net: if isSending is stuck, force-reset before proceeding (1C)
    if (isSending) {
      cleanupSendingState();
    }

    if (showingHistory) hideHistoryView();

    input.value = '';
    clearPendingAttachment();

    // Show user message in chat
    if (attachment && userText) {
      appendMessage('user', `[Attached: ${escapeHtml(attachment.file.name)}]\n${escapeHtml(userText)}`);
    } else if (attachment) {
      appendMessage('user', `[Attached: ${escapeHtml(attachment.file.name)}]`);
    } else {
      appendMessage('user', userText);
    }
    touchSession();
    lastUserMessage = userText;

    // Show thinking indicator immediately (1B)
    showThinkingIndicator();

    // Ensure we have a conversation ID
    if (!currentConversationId) {
      try {
        const conv = await createConversation('');
        currentConversationId = conv.id;
      } catch {
        // Continue without persistence
      }
    }

    setSending(true);
    sendBtn.disabled = true;
    input.disabled = true;

    try {
      let prompt;
      if (attachment) {
        // Extract text if not already done (pre-extraction failed or skipped)
        let fileText = attachment.extractedText;
        if (!fileText) {
          fileText = await extractFileText(attachment.file);
          if (!fileText) {
            appendMessage('error', 'Could not extract text from this file type.');
            setSending(false);
            sendBtn.disabled = false;
            input.disabled = false;
            return;
          }
        }

        const fileHeader = `The user attached a file: "${attachment.file.name}" (${attachment.file.type || 'unknown type'}).\n\nFile contents:\n${fileText.slice(0, 8000)}`;
        if (userText) {
          prompt = `${fileHeader}\n\nUser's message: ${userText}`;
        } else {
          prompt = `${fileHeader}\n\nAnalyze this document and tell me what you found. If it contains recipes, menus, ingredient lists, or pricing — extract the key information.`;
        }

        if (currentConversationId) {
          const persistMsg = userText ? `[Attached: ${attachment.file.name}]\n${userText}` : `[Attached: ${attachment.file.name}]`;
          try { await addConversationMessage(currentConversationId, 'user', persistMsg); } catch {}
        }
      } else {
        prompt = userText;
        if (currentConversationId) {
          try { await addConversationMessage(currentConversationId, 'user', userText); } catch {}
        }
      }

      await sendStreamingMessage(prompt, input, sendBtn);
    } catch {
      // Guarantee UI recovery if streaming throws
      setSending(false);
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Escape') {
      closeDrawer();
    }
  });

  sendBtn.addEventListener('click', sendMessage);

  document.body.appendChild(drawerEl);
  updateContextBadge();
  return drawerEl;
}

/**
 * Show a thinking indicator (animated dots) while waiting for first token.
 */
function showThinkingIndicator() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;
  // Remove any existing thinking indicator
  const existing = messagesEl.querySelector('.chat-thinking-indicator');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.className = 'chat-msg chat-msg-assistant chat-thinking-indicator chat-msg-enter';
  indicator.innerHTML = `<div class="chat-msg-text"><div class="chat-typing-dots"><span></span><span></span><span></span></div></div>`;
  indicator.addEventListener('animationend', () => indicator.classList.remove('chat-msg-enter'));
  messagesEl.appendChild(indicator);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Remove the thinking indicator.
 */
function removeThinkingIndicator() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;
  const indicator = messagesEl.querySelector('.chat-thinking-indicator');
  if (indicator) indicator.remove();
}

/**
 * Send a message via SSE streaming with progressive rendering
 */
async function sendStreamingMessage(text, input, sendBtn) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  // Create the assistant message container for streaming
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg chat-msg-assistant chat-msg-streaming chat-msg-enter';
  msgEl.addEventListener('animationend', () => msgEl.classList.remove('chat-msg-enter'));

  const toolIndicatorEl = document.createElement('div');
  toolIndicatorEl.className = 'chat-tool-indicator';
  toolIndicatorEl.style.display = 'none';

  const textEl = document.createElement('div');
  textEl.className = 'chat-msg-text';

  const cursorEl = document.createElement('span');
  cursorEl.className = 'chat-stream-cursor';

  msgEl.appendChild(toolIndicatorEl);
  msgEl.appendChild(textEl);

  // Don't append yet — wait for first real content to replace thinking indicator

  let fullText = '';
  let pendingConfirmation = null;
  let firstContentReceived = false;
  let throttleTimer = null;
  let throttledText = '';

  function ensureMsgInDom() {
    if (!firstContentReceived) {
      firstContentReceived = true;
      removeThinkingIndicator();
      messagesEl.appendChild(msgEl);
    }
  }

  function flushThrottledRender() {
    if (throttledText !== fullText) {
      throttledText = fullText;
      requestAnimationFrame(() => {
        textEl.innerHTML = renderMarkdown(fullText);
        textEl.appendChild(cursorEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  }

  const context = getPageContext();

  const streamPayload = {
    message: text,
    context,
    conversationHistory: conversationHistory.slice(-10),
  };
  if (sessionApprovedTools.size > 0) {
    streamPayload.approvedTools = [...sessionApprovedTools];
  }

  currentStream = aiCommandStream(streamPayload, {
    onTextDelta(data) {
      ensureMsgInDom();
      fullText += data.text;
      // Throttle renders to reduce flicker (5B)
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          flushThrottledRender();
        }, STREAM_THROTTLE_MS);
      }
    },

    onTextClear() {
      fullText = '';
      throttledText = '';
      textEl.innerHTML = '';
    },

    onToolStart(data) {
      ensureMsgInDom();
      // Remove any existing tool indicator to prevent duplicates (1A)
      const existing = msgEl.querySelector('.chat-tool-indicator');
      if (existing && existing !== toolIndicatorEl) existing.remove();

      toolIndicatorEl.style.display = 'flex';
      toolIndicatorEl.classList.remove('chat-tool-done');
      toolIndicatorEl.innerHTML = `
        <span class="chat-tool-spinner"></span>
        <span class="chat-tool-label">${escapeHtml(getToolLabel(data.name))}</span>
      `;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    },

    onToolResult(data) {
      toolIndicatorEl.innerHTML = `
        <svg class="chat-tool-check" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span class="chat-tool-label">${escapeHtml(getToolLabel(data.name))}</span>
      `;
    },

    onProgress(data) {
      // Show step progress from agentic loop (1F)
      if (data.round !== undefined) {
        const label = toolIndicatorEl.querySelector('.chat-progress-label');
        if (label) {
          label.textContent = `Step ${data.round + 1}...`;
        } else {
          const span = document.createElement('span');
          span.className = 'chat-progress-label';
          span.textContent = `Step ${data.round + 1}...`;
          toolIndicatorEl.appendChild(span);
        }
      }
    },

    onConfirmation(data) {
      pendingConfirmation = data;
    },

    onError(data) {
      ensureMsgInDom();
      const errorMsg = (typeof data === 'string' ? data : data.message) || 'Something went wrong';
      if (!fullText) {
        textEl.innerHTML = `<span class="chat-error-text">${escapeHtml(errorMsg)}</span>`;
      } else {
        textEl.innerHTML = renderMarkdown(fullText) + `<br><span class="chat-error-text">${escapeHtml(errorMsg)}</span>`;
      }
      // Run the same cleanup as onDone on error (1C)
      cleanupSendingState();
      if (input) input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    },

    onDone(_data) {
      // Clear any pending throttle timer
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }

      currentStream = null;
      try { cursorEl.remove(); } catch {}

      // If no content was received at all, still ensure the msg is in DOM
      if (!firstContentReceived) {
        removeThinkingIndicator();
        // Only add to DOM if we have something to show
        if (fullText || pendingConfirmation) {
          messagesEl.appendChild(msgEl);
        }
      }

      msgEl.classList.remove('chat-msg-streaming');

      // Hide tool indicator after a brief delay
      if (toolIndicatorEl.style.display !== 'none') {
        setTimeout(() => { toolIndicatorEl.classList.add('chat-tool-done'); }, 500);
      }

      // Final immediate render with markdown (5B)
      if (fullText) {
        try { textEl.innerHTML = renderMarkdown(fullText); } catch {}
      }

      // Handle confirmation flow
      if (pendingConfirmation) {
        appendConfirmation(pendingConfirmation, messagesEl);
      }

      // Save to conversation history and DB
      const responseText = fullText || (pendingConfirmation ? pendingConfirmation.message : '');
      if (responseText) {
        conversationHistory.push({ role: 'user', content: text });
        conversationHistory.push({ role: 'assistant', content: responseText });

        // Trim oldest entries to prevent unbounded memory growth
        if (conversationHistory.length > MAX_HISTORY_LENGTH) {
          conversationHistory = conversationHistory.slice(-MAX_HISTORY_LENGTH);
        }

        // Persist with retry on failure (2B)
        if (currentConversationId) {
          persistMessage(currentConversationId, 'assistant', responseText, msgEl);
        }
      }

      setSending(false);
      if (sendBtn) sendBtn.disabled = false;
      if (input) { input.disabled = false; input.focus(); }
    },
  });
}

/**
 * Append a confirmation card for actions requiring user approval
 */
function appendConfirmation(data, messagesEl) {
  const card = document.createElement('div');
  card.className = 'chat-confirmation-card chat-msg-enter';
  card.addEventListener('animationend', () => card.classList.remove('chat-msg-enter'));
  card.innerHTML = `
    <div class="chat-confirmation-header">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <span>Confirm action</span>
    </div>
    ${data.preview ? `<div class="chat-confirmation-preview">${escapeHtml(data.preview)}</div>` : ''}
    <div class="chat-confirmation-actions">
      <button class="btn btn-primary btn-sm chat-confirm-btn">Confirm</button>
      <button class="btn btn-primary btn-sm chat-confirm-all-btn" title="Auto-approve this action type for the rest of this session">Confirm All</button>
      <button class="btn btn-secondary btn-sm chat-cancel-btn">Cancel</button>
      <button class="btn btn-sm chat-skip-btn" title="Skip this action and continue with remaining items">Skip</button>
    </div>
  `;

  messagesEl.appendChild(card);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  async function executeConfirmation(shouldResume = false) {
    card.querySelector('.chat-confirmation-actions').innerHTML = '<span class="chat-tool-spinner"></span> Executing...';
    try {
      // Retry once on network errors (e.g. Safari "Load failed")
      let result;
      try {
        result = await aiConfirm(data.confirmationId);
      } catch (firstErr) {
        const msg = firstErr.message || '';
        const isNetwork = msg === 'Load failed' || msg === 'Failed to fetch' || msg.includes('NetworkError');
        if (isNetwork) {
          await new Promise(r => setTimeout(r, 1500));
          result = await aiConfirm(data.confirmationId);
        } else {
          throw firstErr;
        }
      }
      card.remove();
      if (result.success !== false) {
        const responseText = result.response || 'Done';
        appendMessage('assistant', responseText);

        // Track in conversation history so AI has context for continuation
        conversationHistory.push({ role: 'assistant', content: responseText });
        if (currentConversationId) {
          addConversationMessage(currentConversationId, 'assistant', responseText).catch(err => console.warn('Failed to save message:', err.message));
        }

        if (result.undoId) {
          showToast(responseText, 'success', 15000, {
            label: 'Undo',
            onClick: async () => {
              try {
                await aiUndo(result.undoId);
                showToast('Undone', 'success');
                window.dispatchEvent(new Event('hashchange'));
              } catch (err) {
                showToast(err.message || 'Undo failed', 'error');
              }
            },
          });
        }
        if (result.navigateTo) {
          window.location.hash = result.navigateTo;
        }

        // Auto-resume: feed the result back to AI so it can continue
        if (shouldResume) {
          const resumeText = 'Confirmed. Continue with the remaining items.';
          appendMessage('user', resumeText);
          conversationHistory.push({ role: 'user', content: resumeText });
          if (currentConversationId) {
            addConversationMessage(currentConversationId, 'user', resumeText).catch(err => console.warn('Failed to save message:', err.message));
          }

          const input = drawerEl.querySelector('.chat-drawer-input');
          const sendBtn = drawerEl.querySelector('.chat-drawer-send');
          setSending(true);
          if (input) input.disabled = true;
          if (sendBtn) sendBtn.disabled = true;

          try {
            await sendStreamingMessage(resumeText, input, sendBtn);
          } catch {
            setSending(false);
            if (input) input.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
          }
        }
      } else {
        appendMessage('error', result.response || 'Action failed');
      }
    } catch (err) {
      card.remove();
      appendMessage('error', err.message || 'Failed to execute action');
    }
  }

  card.querySelector('.chat-confirm-btn').addEventListener('click', () => executeConfirmation(false));

  card.querySelector('.chat-confirm-all-btn').addEventListener('click', () => {
    if (data.toolName) sessionApprovedTools.add(data.toolName);
    executeConfirmation(true);
  });

  card.querySelector('.chat-cancel-btn').addEventListener('click', () => {
    card.remove();
    appendMessage('assistant', 'Action cancelled.');
  });

  card.querySelector('.chat-skip-btn').addEventListener('click', async () => {
    card.remove();
    appendMessage('assistant', 'Action skipped.');

    // Tell the AI to skip this action and continue with the rest
    const skipText = 'That was wrong — skip it and continue with the remaining items.';
    appendMessage('user', skipText);
    conversationHistory.push({ role: 'user', content: skipText });
    if (currentConversationId) {
      addConversationMessage(currentConversationId, 'user', skipText).catch(err => console.warn('Failed to save message:', err.message));
    }

    const input = drawerEl.querySelector('.chat-drawer-input');
    const sendBtn = drawerEl.querySelector('.chat-drawer-send');
    setSending(true);
    if (input) input.disabled = true;
    if (sendBtn) sendBtn.disabled = true;

    try {
      await sendStreamingMessage(skipText, input, sendBtn);
    } catch {
      setSending(false);
      if (input) input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  });
}

/**
 * Stage a file attachment — show indicator chip and wait for user to send.
 */
async function stageAttachment(file) {
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    appendMessage('error', `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max size is 10MB.`);
    return;
  }

  // Show attachment chip in loading state immediately (4A)
  const bar = document.getElementById('chat-attachment-bar');
  const nameEl = document.getElementById('chat-attachment-name');
  const chip = bar ? bar.querySelector('.chat-drawer-attachment-chip') : null;
  if (bar && nameEl) {
    nameEl.textContent = 'Extracting text...';
    bar.style.display = '';
    if (chip) chip.classList.add('chat-attachment-loading');
  }

  // Pre-extract text so send is fast
  let extractedText = null;
  try {
    extractedText = await extractFileText(file);
    if (!extractedText) {
      if (bar) bar.style.display = 'none';
      if (chip) chip.classList.remove('chat-attachment-loading');
      appendMessage('error', 'Could not extract text from this file type.');
      return;
    }
  } catch (err) {
    if (bar) bar.style.display = 'none';
    if (chip) chip.classList.remove('chat-attachment-loading');
    appendMessage('error', err.message || 'Failed to process file');
    return;
  }

  pendingAttachment = { file, extractedText };

  // Update chip to ready state
  if (nameEl) nameEl.textContent = file.name;
  if (chip) chip.classList.remove('chat-attachment-loading');
}

/**
 * Clear any pending attachment and hide the indicator.
 */
function clearPendingAttachment() {
  pendingAttachment = null;
  const bar = document.getElementById('chat-attachment-bar');
  if (bar) bar.style.display = 'none';
}

async function extractFileText(file) {
  const type = file.type || '';
  const name = file.name.toLowerCase();

  if (type.startsWith('text/') || name.endsWith('.csv')) {
    return await file.text();
  }

  if (type === 'application/json' || name.endsWith('.json')) {
    return await file.text();
  }

  if (type === 'application/pdf' || name.endsWith('.pdf') ||
      type.startsWith('image/') ||
      name.endsWith('.xlsx') || name.endsWith('.xls') ||
      name.endsWith('.docx') || name.endsWith('.doc')) {
    const formData = new FormData();
    formData.append('file', file);
    const data = await aiExtractText(formData);
    return data.text;
  }

  return null;
}

async function showHistoryView() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  showingHistory = true;
  const historyBtn = drawerEl.querySelector('.chat-drawer-history-btn');
  if (historyBtn) historyBtn.classList.add('active');

  messagesEl.innerHTML = '<div class="chat-history-loading">Loading conversations...</div>';

  try {
    const conversations = await getConversations();

    if (!conversations.length) {
      messagesEl.innerHTML = `
        <div class="chat-history-empty">
          <p>No past conversations.</p>
          <p class="chat-drawer-welcome-hint">Start a new chat to begin.</p>
        </div>`;
      return;
    }

    messagesEl.innerHTML = `
      <div class="chat-history-list">
        <div class="chat-history-header">Past Conversations</div>
        ${conversations.map(c => `
          <div class="chat-history-item" data-id="${c.id}">
            <div class="chat-history-item-content">
              <div class="chat-history-item-title">${escapeHtml(c.title || 'Untitled')}</div>
              <div class="chat-history-item-date">${formatDate(c.updated_at)}</div>
            </div>
            <button class="chat-history-item-delete" data-id="${c.id}" title="Delete conversation" aria-label="Delete conversation">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `).join('')}
      </div>`;

    messagesEl.querySelectorAll('.chat-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.chat-history-item-delete')) return;
        const id = parseInt(item.dataset.id);
        loadConversation(id);
      });
    });

    messagesEl.querySelectorAll('.chat-history-item-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        try {
          await deleteConversation(id);
          btn.closest('.chat-history-item').remove();
          if (currentConversationId === id) {
            clearChat();
          }
          if (!messagesEl.querySelector('.chat-history-item')) {
            messagesEl.innerHTML = `
              <div class="chat-history-empty">
                <p>No past conversations.</p>
                <p class="chat-drawer-welcome-hint">Start a new chat to begin.</p>
              </div>`;
          }
        } catch {}
      });
    });
  } catch {
    messagesEl.innerHTML = '<div class="chat-history-empty"><p>Failed to load conversations.</p></div>';
  }
}

function hideHistoryView() {
  showingHistory = false;
  const historyBtn = drawerEl.querySelector('.chat-drawer-history-btn');
  if (historyBtn) historyBtn.classList.remove('active');
  // Always restore from conversationHistory since history view replaced the DOM
  restoreMessages();
}

async function loadConversation(convId) {
  showingHistory = false;
  const historyBtn = drawerEl.querySelector('.chat-drawer-history-btn');
  if (historyBtn) historyBtn.classList.remove('active');

  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  // If reloading the same conversation, don't rebuild DOM (2A)
  if (convId === currentConversationId && messagesEl.querySelector('.chat-msg')) {
    return;
  }

  messagesEl.innerHTML = '<div class="chat-history-loading">Loading...</div>';

  try {
    const messages = await getConversationMessages(convId);
    currentConversationId = convId;
    conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
    lastActivityTime = Date.now();

    messagesEl.innerHTML = '';
    for (const msg of messages) {
      const el = document.createElement('div');
      el.className = `chat-msg chat-msg-${msg.role}`;
      if (msg.id) el.setAttribute('data-message-id', msg.id);
      const contentHtml = msg.role === 'assistant' ? renderMarkdown(msg.content) : escapeHtml(msg.content);
      el.innerHTML = `<div class="chat-msg-text">${contentHtml}</div>`;
      messagesEl.appendChild(el);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch {
    messagesEl.innerHTML = '<div class="chat-history-empty"><p>Failed to load conversation.</p></div>';
  }
}

function restoreMessages() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  if (!conversationHistory.length) {
    messagesEl.innerHTML = `
      <div class="chat-drawer-welcome">
        <p>Ask me anything about your dishes, menus, ingredients, tasks, or kitchen workflow.</p>
        <p class="chat-drawer-welcome-hint">I can search your data, look up details, create tasks, and more.</p>
      </div>`;
    return;
  }

  messagesEl.innerHTML = '';
  for (const msg of conversationHistory) {
    const el = document.createElement('div');
    el.className = `chat-msg chat-msg-${msg.role}`;
    const contentHtml = msg.role === 'assistant' ? renderMarkdown(msg.content) : escapeHtml(msg.content);
    el.innerHTML = `<div class="chat-msg-text">${contentHtml}</div>`;
    messagesEl.appendChild(el);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'Z');
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

function appendMessage(role, text) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  const welcome = messagesEl.querySelector('.chat-drawer-welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg chat-msg-${role} chat-msg-enter`;
  const contentHtml = role === 'assistant' ? renderMarkdown(text) : escapeHtml(text);
  msg.innerHTML = `<div class="chat-msg-text">${contentHtml}</div>`;
  msg.addEventListener('animationend', () => msg.classList.remove('chat-msg-enter'));
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Persist a message to the database with one retry on failure (2B).
 * Marks the message element with an unsaved indicator if both attempts fail.
 */
async function persistMessage(conversationId, role, content, msgEl) {
  try {
    await addConversationMessage(conversationId, role, content);
  } catch {
    // Retry once after 2s
    try {
      await new Promise(r => setTimeout(r, 2000));
      await addConversationMessage(conversationId, role, content);
    } catch {
      // Both attempts failed — mark as unsaved
      if (msgEl) msgEl.classList.add('chat-msg-unsaved');
    }
  }
}

/**
 * Update the context badge in the header
 */
function updateContextBadge() {
  const badge = document.getElementById('chat-context-badge');
  if (!badge) return;
  const label = getContextLabel();
  if (label) {
    badge.textContent = label;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

let savedScrollY = 0;

export function openDrawer() {
  createDrawer();
  checkSessionTimeout();
  updateContextBadge();
  drawerEl.classList.add('chat-drawer-open');

  // Lock body scroll — position:fixed is required for iOS/iPad
  savedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.overflow = 'hidden';

  isOpen = true;
  updateFabVisibility();
  const input = drawerEl.querySelector('.chat-drawer-input');
  if (input) setTimeout(() => input.focus(), 300);
}

export function closeDrawer() {
  if (drawerEl) {
    drawerEl.classList.remove('chat-drawer-open');

    // Abort any in-flight stream so it doesn't keep processing in the background
    if (currentStream) {
      currentStream.abort();
      currentStream = null;
      setSending(false);
      const inp = drawerEl.querySelector('.chat-drawer-input');
      const btn = drawerEl.querySelector('.chat-drawer-send');
      if (inp) inp.disabled = false;
      if (btn) btn.disabled = false;
    }

    // Restore body scroll
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);

    isOpen = false;
    updateFabVisibility();
  }
}

export function toggleDrawer() {
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

export function clearChat() {
  if (currentStream) {
    currentStream.abort();
    currentStream = null;
  }
  conversationHistory = [];
  currentConversationId = null;
  lastActivityTime = Date.now();
  showingHistory = false;
  setSending(false);
  sessionApprovedTools.clear();
  clearPendingAttachment();
  const historyBtn = drawerEl ? drawerEl.querySelector('.chat-drawer-history-btn') : null;
  if (historyBtn) historyBtn.classList.remove('active');
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = `
      <div class="chat-drawer-welcome">
        <p>Ask me anything about your dishes, menus, ingredients, tasks, or kitchen workflow.</p>
        <p class="chat-drawer-welcome-hint">I can search your data, look up details, create tasks, and more.</p>
      </div>
    `;
  }
  // Re-enable inputs
  if (drawerEl) {
    const inp = drawerEl.querySelector('.chat-drawer-input');
    const btn = drawerEl.querySelector('.chat-drawer-send');
    if (inp) inp.disabled = false;
    if (btn) btn.disabled = false;
  }
}

function createFab() {
  if (fabEl) return;
  fabEl = document.createElement('button');
  fabEl.className = 'chat-fab no-print';
  fabEl.title = 'Open AI chat (Ctrl+Shift+K)';
  fabEl.setAttribute('aria-label', 'Open AI chat drawer');
  fabEl.innerHTML = `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  `;
  fabEl.addEventListener('click', () => toggleDrawer());
  document.body.appendChild(fabEl);
}

function updateFabVisibility() {
  if (!fabEl) return;
  const hash = window.location.hash || '';
  if (hash === '#/login' || hash.startsWith('#/reset-password') || isOpen) {
    fabEl.classList.remove('chat-fab-visible');
  } else {
    fabEl.classList.add('chat-fab-visible');
  }
}

export function initChatDrawer() {
  createDrawer();
  createFab();
  updateFabVisibility();

  // Keyboard shortcut: Ctrl/Cmd+Shift+K to toggle drawer
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggleDrawer();
    }
  });

  // Update context badge on navigation
  window.addEventListener('hashchange', () => {
    updateContextBadge();
    updateFabVisibility();
  });
}
