import { createTask } from '../api.js';
import { showToast } from './toast.js';

// Routes where quick capture should be hidden (editing contexts)
const HIDDEN_ROUTES = [
  /^#\/dishes\/new$/,
  /^#\/dishes\/\d+\/edit$/,
  /^#\/menus\/\d+$/,         // menu builder
  /^#\/service-notes$/,
  /^#\/settings$/,
  /^#\/login$/,
];

let barEl = null;
let isVisible = false;

function shouldShow(hash) {
  if (!hash) return false;
  for (const pattern of HIDDEN_ROUTES) {
    if (pattern.test(hash)) return false;
  }
  // Don't show on login/setup
  if (hash === '#/login' || hash.startsWith('#/reset-password')) return false;
  return true;
}

function createBar() {
  if (barEl) return barEl;

  barEl = document.createElement('div');
  barEl.className = 'qc-bar';
  barEl.innerHTML = `
    <div class="qc-inner">
      <input type="text" class="qc-input" placeholder="Quick add a task..." aria-label="Quick add task">
      <button class="qc-send" title="Add task" aria-label="Add task">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>
  `;

  const input = barEl.querySelector('.qc-input');
  const sendBtn = barEl.querySelector('.qc-send');

  async function submit() {
    const title = input.value.trim();
    if (!title) return;

    sendBtn.disabled = true;
    input.disabled = true;

    try {
      const today = new Date().toISOString().slice(0, 10);
      await createTask({
        title,
        due_date: today,
        type: 'custom',
        priority: 'medium',
      });
      input.value = '';
      showToast('Task added to today', 'success');

      // Notify the today page to refresh
      window.dispatchEvent(new CustomEvent('quickcapture:created'));
    } catch (err) {
      showToast('Failed to add task: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
    // Escape blurs the input
    if (e.key === 'Escape') {
      input.blur();
    }
  });

  sendBtn.addEventListener('click', submit);

  document.body.appendChild(barEl);
  return barEl;
}

export function initQuickCapture() {
  createBar();
  updateVisibility(window.location.hash);

  window.addEventListener('hashchange', () => {
    updateVisibility(window.location.hash);
  });
}

export function updateVisibility(hash) {
  if (!barEl) return;
  const show = shouldShow(hash);
  if (show && !isVisible) {
    barEl.classList.add('qc-bar-visible');
    isVisible = true;
  } else if (!show && isVisible) {
    barEl.classList.remove('qc-bar-visible');
    isVisible = false;
  }
}

export function showQuickCapture() {
  if (barEl) {
    barEl.classList.add('qc-bar-visible');
    isVisible = true;
  }
}

export function hideQuickCapture() {
  if (barEl) {
    barEl.classList.remove('qc-bar-visible');
    isVisible = false;
  }
}
