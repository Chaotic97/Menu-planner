/**
 * Chat Drawer — Level 2 conversational AI panel.
 * Skeleton for future implementation.
 * Will slide out from the right with multi-turn conversation support.
 *
 * NOT wired up in v1 — this is structural prep only.
 * To activate: import and call initChatDrawer() from app.js,
 * add a trigger button to the command bar.
 */

import { aiCommand } from '../api.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

let drawerEl = null;
let isOpen = false;
let conversationHistory = [];

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
        <button class="chat-drawer-close" title="Close" aria-label="Close chat">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="chat-drawer-messages" id="chat-messages"></div>
      <div class="chat-drawer-input-row">
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
  const input = drawerEl.querySelector('.chat-drawer-input');
  const sendBtn = drawerEl.querySelector('.chat-drawer-send');

  backdrop.addEventListener('click', closeDrawer);
  closeBtn.addEventListener('click', closeDrawer);

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    appendMessage('user', text);

    sendBtn.disabled = true;
    input.disabled = true;

    try {
      const context = getPageContext();
      const result = await aiCommand({
        message: text,
        context,
        conversationHistory: conversationHistory.slice(-10),
      });

      conversationHistory.push({ role: 'user', content: text });
      conversationHistory.push({ role: 'assistant', content: result.response });

      appendMessage('assistant', result.response);
    } catch (err) {
      appendMessage('error', err.message || 'Failed to get response');
    } finally {
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
 * Append a message to the chat
 */
function appendMessage(role, text) {
  const messagesEl = document.getElementById('chat-messages');
  if (!messagesEl) return;

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
 * Clear conversation history
 */
export function clearChat() {
  conversationHistory = [];
  const messagesEl = document.getElementById('chat-messages');
  if (messagesEl) messagesEl.innerHTML = '';
}

/**
 * Initialize the chat drawer (call from app.js when ready for Level 2)
 */
export function initChatDrawer() {
  createDrawer();
  showToast('Chat drawer initialized', 'success');
}
