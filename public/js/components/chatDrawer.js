/**
 * Chat Drawer — conversational AI panel.
 * Slides out from the right with multi-turn conversation support.
 * Sessions persist across navigations but auto-clear after 1 hour of inactivity.
 */

import { aiCommand } from '../api.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let drawerEl = null;
let isOpen = false;
let conversationHistory = [];
let lastActivityTime = Date.now();
let isSending = false;

const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if session has expired and clear if so
 */
function checkSessionTimeout() {
  if (conversationHistory.length === 0) return;
  if (Date.now() - lastActivityTime > SESSION_TIMEOUT_MS) {
    clearChat();
  }
}

/**
 * Touch the session (update last activity time)
 */
function touchSession() {
  lastActivityTime = Date.now();
}

/**
 * Get current page context
 */
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
 * Create the drawer element
 */
function createDrawer() {
  if (drawerEl) return drawerEl;

  drawerEl = document.createElement('div');
  drawerEl.className = 'chat-drawer';
  drawerEl.innerHTML = `
    <div class="chat-drawer-backdrop"></div>
    <div class="chat-drawer-panel">
      <div class="chat-drawer-header">
        <h3 class="chat-drawer-title">AI Assistant</h3>
        <div class="chat-drawer-header-actions">
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
      <div class="chat-drawer-input-row">
        <label class="chat-drawer-attach" title="Attach file" aria-label="Attach file">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          <input type="file" class="chat-drawer-file-input" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.csv,.xlsx,.xls,.doc,.docx" hidden>
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
  const input = drawerEl.querySelector('.chat-drawer-input');
  const sendBtn = drawerEl.querySelector('.chat-drawer-send');
  const fileInput = drawerEl.querySelector('.chat-drawer-file-input');
  const attachBtn = drawerEl.querySelector('.chat-drawer-attach');

  backdrop.addEventListener('click', closeDrawer);
  closeBtn.addEventListener('click', closeDrawer);
  newChatBtn.addEventListener('click', () => {
    clearChat();
    input.focus();
  });

  // File attachment
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    handleFileAttachment(file, input, sendBtn);
    fileInput.value = '';
  });

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || isSending) return;

    input.value = '';
    appendMessage('user', text);
    touchSession();

    isSending = true;
    sendBtn.disabled = true;
    input.disabled = true;
    appendTypingIndicator();

    try {
      const context = getPageContext();
      const result = await aiCommand({
        message: text,
        context,
        conversationHistory: conversationHistory.slice(-10),
      });

      removeTypingIndicator();
      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: result.response });

      appendMessage('assistant', result.response);

      // Handle auto-executed tool side effects
      if (result.autoExecuted && result.navigateTo) {
        window.location.hash = result.navigateTo;
      }
    } catch (err) {
      removeTypingIndicator();
      appendMessage('error', err.message || 'Failed to get response');
    } finally {
      isSending = false;
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
  return drawerEl;
}

/**
 * Handle file attachment — show in chat and send to AI
 */
async function handleFileAttachment(file, input, sendBtn) {
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    appendMessage('error', `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max size is 10MB.`);
    return;
  }

  appendMessage('user', `[Attached: ${escapeHtml(file.name)}]`);
  touchSession();

  isSending = true;
  sendBtn.disabled = true;
  input.disabled = true;
  appendTypingIndicator();

  try {
    const text = await extractFileText(file);
    if (!text) {
      removeTypingIndicator();
      appendMessage('error', 'Could not extract text from this file type.');
      return;
    }

    const prompt = `The user attached a file: "${file.name}" (${file.type || 'unknown type'}).\n\nFile contents:\n${text.slice(0, 8000)}\n\nAnalyze this document and tell me what you found. If it contains recipes, menus, ingredient lists, or pricing — extract the key information.`;

    const context = getPageContext();
    const result = await aiCommand({
      message: prompt,
      context,
      conversationHistory: conversationHistory.slice(-10),
    });

    removeTypingIndicator();
    conversationHistory.push({ role: 'user', content: prompt });
    conversationHistory.push({ role: 'assistant', content: result.response });

    appendMessage('assistant', result.response);
  } catch (err) {
    removeTypingIndicator();
    appendMessage('error', err.message || 'Failed to process file');
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

/**
 * Extract text from various file types
 */
async function extractFileText(file) {
  const type = file.type || '';
  const name = file.name.toLowerCase();

  // CSV/text files
  if (type.startsWith('text/') || name.endsWith('.csv')) {
    return await file.text();
  }

  // JSON
  if (type === 'application/json' || name.endsWith('.json')) {
    return await file.text();
  }

  // For PDF, images, docx — send to server for extraction
  if (type === 'application/pdf' || name.endsWith('.pdf') ||
      type.startsWith('image/') ||
      name.endsWith('.xlsx') || name.endsWith('.xls') ||
      name.endsWith('.docx') || name.endsWith('.doc')) {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/ai/extract-text', {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Extraction failed' }));
      throw new Error(err.error || 'File extraction failed');
    }
    const data = await res.json();
    return data.text;
  }

  return null;
}

/**
 * Show typing indicator
 */
function appendTypingIndicator() {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  const indicator = document.createElement('div');
  indicator.className = 'chat-msg chat-msg-assistant chat-typing-indicator';
  indicator.innerHTML = `<div class="chat-msg-text"><span class="chat-typing-dots"><span></span><span></span><span></span></span></div>`;
  messagesEl.appendChild(indicator);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Remove typing indicator
 */
function removeTypingIndicator() {
  const indicator = document.querySelector('.chat-typing-indicator');
  if (indicator) indicator.remove();
}

/**
 * Append a message to the chat
 */
function appendMessage(role, text) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

  // Remove welcome message on first real message
  const welcome = messagesEl.querySelector('.chat-drawer-welcome');
  if (welcome) welcome.remove();

  const msg = document.createElement('div');
  msg.className = `chat-msg chat-msg-${role}`;
  msg.innerHTML = `<div class="chat-msg-text">${escapeHtml(text)}</div>`;
  messagesEl.appendChild(msg);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Open the chat drawer
 */
export function openDrawer() {
  createDrawer();
  checkSessionTimeout();
  drawerEl.classList.add('chat-drawer-open');
  isOpen = true;
  const input = drawerEl.querySelector('.chat-drawer-input');
  if (input) setTimeout(() => input.focus(), 300);
}

/**
 * Close the chat drawer
 */
export function closeDrawer() {
  if (drawerEl) {
    drawerEl.classList.remove('chat-drawer-open');
    isOpen = false;
  }
}

/**
 * Toggle the drawer
 */
export function toggleDrawer() {
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

/**
 * Clear conversation history and reset UI
 */
export function clearChat() {
  conversationHistory = [];
  lastActivityTime = Date.now();
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) {
    messagesEl.innerHTML = `
      <div class="chat-drawer-welcome">
        <p>Ask me anything about your dishes, menus, ingredients, tasks, or kitchen workflow.</p>
        <p class="chat-drawer-welcome-hint">I can search your data, look up details, create tasks, and more.</p>
      </div>
    `;
  }
}

/**
 * Initialize the chat drawer
 */
export function initChatDrawer() {
  createDrawer();

  // Keyboard shortcut: Ctrl/Cmd+Shift+K to toggle drawer
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
      e.preventDefault();
      toggleDrawer();
    }
  });
}
