import { getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword, changePassword, getDayPhases, updateDayPhases, getNotificationPreferences, updateNotificationPreferences } from '../api.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { restartNotifications } from '../utils/notifications.js';

const EU_14 = [
  'celery', 'crustaceans', 'eggs', 'fish', 'gluten', 'lupin',
  'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites',
];

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export async function renderSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
    </div>
    <div class="st-sections">

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Security</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <div class="card st-password-card">
            <h3 class="st-card-heading">Change Password</h3>
            <form id="st-password-form" autocomplete="off">
              <div class="st-form-group">
                <label class="st-label" for="st-current-pw">Current password</label>
                <input type="password" id="st-current-pw" class="input" autocomplete="current-password">
              </div>
              <div class="st-form-group">
                <label class="st-label" for="st-new-pw">New password</label>
                <input type="password" id="st-new-pw" class="input" minlength="6" autocomplete="new-password">
              </div>
              <div class="st-form-group">
                <label class="st-label" for="st-confirm-pw">Confirm new password</label>
                <input type="password" id="st-confirm-pw" class="input" minlength="6" autocomplete="new-password">
              </div>
              <div class="st-form-actions">
                <button type="submit" class="btn btn-primary" id="st-pw-btn">Update password</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Notifications</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            Get reminders for upcoming tasks, phase transitions, overdue items, and expiring specials.
            Notifications only work while the app is open.
          </p>
          <div id="nt-settings" class="card" style="padding: var(--space-md);">
            <div class="nt-status" id="nt-permission-status"></div>

            <div class="nt-toggle-row">
              <label class="nt-toggle-label">
                <input type="checkbox" id="nt-enabled" class="nt-checkbox">
                <span class="nt-toggle-text">Enable notifications</span>
              </label>
            </div>

            <div id="nt-options" class="nt-options">
              <div class="nt-option-group">
                <label class="nt-toggle-label">
                  <input type="checkbox" id="nt-daily-briefing" class="nt-checkbox">
                  <span class="nt-toggle-text">Daily briefing</span>
                </label>
                <div class="nt-option-detail">
                  <label class="nt-inline-label">Time:
                    <input type="time" id="nt-briefing-time" class="input nt-time-input" value="08:00">
                  </label>
                </div>
              </div>

              <div class="nt-option-group">
                <label class="nt-toggle-label">
                  <input type="checkbox" id="nt-prep-reminders" class="nt-checkbox">
                  <span class="nt-toggle-text">Phase transition reminders</span>
                </label>
                <div class="nt-option-detail">
                  <label class="nt-inline-label">Lead time:
                    <input type="number" id="nt-prep-lead" class="input nt-num-input" min="1" max="120" value="15">
                    <span>min</span>
                  </label>
                </div>
              </div>

              <div class="nt-option-group">
                <label class="nt-toggle-label">
                  <input type="checkbox" id="nt-task-due" class="nt-checkbox">
                  <span class="nt-toggle-text">Task due reminders</span>
                </label>
                <div class="nt-option-detail">
                  <label class="nt-inline-label">Lead time:
                    <input type="number" id="nt-task-lead" class="input nt-num-input" min="1" max="120" value="10">
                    <span>min</span>
                  </label>
                </div>
              </div>

              <div class="nt-option-group">
                <label class="nt-toggle-label">
                  <input type="checkbox" id="nt-overdue" class="nt-checkbox">
                  <span class="nt-toggle-text">Overdue task alerts</span>
                </label>
                <div class="nt-option-detail">
                  <label class="nt-inline-label">Repeat every:
                    <input type="number" id="nt-overdue-interval" class="input nt-num-input" min="5" max="120" value="30">
                    <span>min</span>
                  </label>
                </div>
              </div>

              <div class="nt-option-group">
                <label class="nt-toggle-label">
                  <input type="checkbox" id="nt-specials" class="nt-checkbox">
                  <span class="nt-toggle-text">Expiring specials alerts</span>
                </label>
              </div>

              <div class="st-form-actions">
                <button id="nt-save-btn" class="btn btn-primary">Save Notification Settings</button>
                <button id="nt-test-btn" class="btn btn-secondary" style="margin-left:8px;">Test Notification</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Day Phases</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            Customize the phases of your work day. These are used on the Today page to organize tasks.
          </p>
          <div id="dp-editor" class="card" style="padding: var(--space-md);">
            <div id="dp-phases-list" class="dp-phases-list">
              <div class="loading">Loading…</div>
            </div>
            <div class="dp-add-row">
              <button id="dp-add-btn" class="btn btn-secondary btn-sm">+ Add Phase</button>
            </div>
            <div class="dp-save-row">
              <button id="dp-save-btn" class="btn btn-primary">Save Phases</button>
              <button id="dp-reset-btn" class="btn btn-secondary">Reset to Defaults</button>
            </div>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Allergen Detection</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            These keywords are matched against ingredient names to auto-detect EU 14 allergens.
            Add custom keywords or remove ones that aren't relevant to your kitchen.
          </p>
          <div class="ak-add-form card">
            <h3>Add keyword</h3>
            <div class="ak-form-row">
              <input type="text" id="ak-keyword-input" class="input" placeholder="e.g. panko" maxlength="100">
              <select id="ak-allergen-select" class="input">
                ${EU_14.map(a => `<option value="${a}">${capitalize(a)}</option>`).join('')}
              </select>
              <button id="ak-add-btn" class="btn btn-primary">Add</button>
            </div>
          </div>
          <div id="ak-keywords-list" class="ak-keywords-list">
            <div class="loading">Loading…</div>
          </div>
        </div>
      </section>

    </div>
  `;

  // --- Section toggles ---
  container.querySelectorAll('.st-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.st-section');
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      section.classList.toggle('st-section--collapsed', expanded);
    });
  });

  // --- Change Password ---
  const form = container.querySelector('#st-password-form');
  const currentPw = container.querySelector('#st-current-pw');
  const newPw = container.querySelector('#st-new-pw');
  const confirmPw = container.querySelector('#st-confirm-pw');
  const pwBtn = container.querySelector('#st-pw-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (newPw.value !== confirmPw.value) {
      showToast('New passwords do not match', 'error');
      return;
    }
    if (newPw.value.length < 6) {
      showToast('New password must be at least 6 characters', 'error');
      return;
    }
    pwBtn.disabled = true;
    pwBtn.textContent = 'Updating…';
    try {
      await changePassword({ currentPassword: currentPw.value, newPassword: newPw.value });
      showToast('Password updated');
      form.reset();
    } catch (err) {
      showToast(err.message || 'Failed to update password', 'error');
    } finally {
      pwBtn.disabled = false;
      pwBtn.textContent = 'Update password';
    }
  });

  // --- Allergen Keywords ---
  const keywordInput = container.querySelector('#ak-keyword-input');
  const allergenSelect = container.querySelector('#ak-allergen-select');
  const addBtn = container.querySelector('#ak-add-btn');
  const listEl = container.querySelector('#ak-keywords-list');

  async function loadKeywords() {
    let keywords;
    try {
      keywords = await getAllergenKeywords();
    } catch {
      listEl.innerHTML = `<p class="error-text">Failed to load keywords.</p>`;
      return;
    }

    if (!keywords.length) {
      listEl.innerHTML = `<p class="ak-empty">No keywords found.</p>`;
      return;
    }

    const grouped = {};
    for (const row of keywords) {
      if (!grouped[row.allergen]) grouped[row.allergen] = [];
      grouped[row.allergen].push(row);
    }

    const sortedAllergens = Object.keys(grouped).sort();

    listEl.innerHTML = sortedAllergens.map(allergen => `
      <div class="ak-group card">
        <div class="ak-group-header">
          <span class="ak-allergen-name">${escapeHtml(capitalize(allergen))}</span>
          <span class="ak-count">${grouped[allergen].length} keyword${grouped[allergen].length !== 1 ? 's' : ''}</span>
        </div>
        <div class="ak-chips">
          ${grouped[allergen].map(row => `
            <span class="ak-chip">
              <span class="ak-chip-label">${escapeHtml(row.keyword)}</span>
              <button class="ak-chip-delete" data-id="${row.id}" title="Remove keyword" aria-label="Remove ${escapeHtml(row.keyword)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </span>
          `).join('')}
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.ak-chip-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await deleteAllergenKeyword(btn.dataset.id);
          await loadKeywords();
        } catch (e) {
          showToast(e.message || 'Failed to delete keyword', 'error');
        }
      });
    });
  }

  addBtn.addEventListener('click', async () => {
    const keyword = keywordInput.value.trim();
    if (!keyword) {
      showToast('Please enter a keyword', 'error');
      keywordInput.focus();
      return;
    }
    try {
      await addAllergenKeyword({ keyword, allergen: allergenSelect.value });
      keywordInput.value = '';
      keywordInput.focus();
      await loadKeywords();
    } catch (e) {
      showToast(e.message || 'Failed to add keyword', 'error');
    }
  });

  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  await loadKeywords();

  // --- Day Phases Editor ---
  const dpList = container.querySelector('#dp-phases-list');
  const dpAddBtn = container.querySelector('#dp-add-btn');
  const dpSaveBtn = container.querySelector('#dp-save-btn');
  const dpResetBtn = container.querySelector('#dp-reset-btn');

  const DEFAULT_PHASES = [
    { id: 'admin', name: 'Admin & Planning', start: '12:00', end: '14:30' },
    { id: 'prep', name: 'Prep', start: '14:30', end: '17:00' },
    { id: 'service', name: 'Service', start: '17:00', end: '21:00' },
    { id: 'wrapup', name: 'Wrap-up', start: '21:00', end: '22:30' },
  ];

  let currentPhases = [];

  function renderPhaseRows() {
    if (!currentPhases.length) {
      dpList.innerHTML = '<p class="ak-empty">No phases configured.</p>';
      return;
    }
    dpList.innerHTML = currentPhases.map((p, i) => `
      <div class="dp-phase-row" data-index="${i}">
        <div class="dp-phase-name">
          <input type="text" class="input dp-name-input" value="${escapeHtml(p.name)}" placeholder="Phase name">
        </div>
        <div class="dp-phase-time">
          <input type="time" class="input dp-start-input" value="${escapeHtml(p.start)}">
          <span class="dp-phase-time-sep">–</span>
          <input type="time" class="input dp-end-input" value="${escapeHtml(p.end)}">
        </div>
        <button class="dp-phase-remove" title="Remove phase" data-index="${i}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');

    // Remove buttons
    dpList.querySelectorAll('.dp-phase-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPhases.splice(parseInt(btn.dataset.index), 1);
        renderPhaseRows();
      });
    });
  }

  function readPhasesFromDOM() {
    const rows = dpList.querySelectorAll('.dp-phase-row');
    return Array.from(rows).map((row, i) => ({
      id: currentPhases[i]?.id || row.querySelector('.dp-name-input').value.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: row.querySelector('.dp-name-input').value.trim(),
      start: row.querySelector('.dp-start-input').value,
      end: row.querySelector('.dp-end-input').value,
    }));
  }

  async function loadPhases() {
    try {
      currentPhases = await getDayPhases();
    } catch {
      currentPhases = DEFAULT_PHASES;
    }
    renderPhaseRows();
  }

  dpAddBtn.addEventListener('click', () => {
    currentPhases = readPhasesFromDOM();
    currentPhases.push({ id: 'phase_' + Date.now(), name: '', start: '09:00', end: '17:00' });
    renderPhaseRows();
  });

  dpSaveBtn.addEventListener('click', async () => {
    const phasesFromDom = readPhasesFromDOM();
    const valid = phasesFromDom.every(p => p.name && p.start && p.end);
    if (!valid) {
      showToast('All phases need a name and times', 'error');
      return;
    }
    dpSaveBtn.disabled = true;
    dpSaveBtn.textContent = 'Saving…';
    try {
      currentPhases = await updateDayPhases(phasesFromDom);
      showToast('Day phases saved');
      renderPhaseRows();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      dpSaveBtn.disabled = false;
      dpSaveBtn.textContent = 'Save Phases';
    }
  });

  dpResetBtn.addEventListener('click', async () => {
    dpResetBtn.disabled = true;
    try {
      currentPhases = await updateDayPhases(DEFAULT_PHASES);
      showToast('Reset to defaults');
      renderPhaseRows();
    } catch (err) {
      showToast(err.message || 'Failed to reset', 'error');
    } finally {
      dpResetBtn.disabled = false;
    }
  });

  await loadPhases();

  // --- Notification Settings ---
  const ntEnabled = container.querySelector('#nt-enabled');
  const ntOptions = container.querySelector('#nt-options');
  const ntStatus = container.querySelector('#nt-permission-status');
  const ntSaveBtn = container.querySelector('#nt-save-btn');
  const ntTestBtn = container.querySelector('#nt-test-btn');

  function updatePermissionStatus() {
    if (!('Notification' in window)) {
      ntStatus.textContent = 'Notifications are not supported in this browser.';
      ntStatus.className = 'nt-status nt-status--warning';
      ntEnabled.disabled = true;
      return;
    }
    const perm = Notification.permission;
    if (perm === 'granted') {
      ntStatus.textContent = 'Notification permission: granted';
      ntStatus.className = 'nt-status nt-status--ok';
    } else if (perm === 'denied') {
      ntStatus.textContent = 'Notifications are blocked. Please enable them in your browser settings.';
      ntStatus.className = 'nt-status nt-status--warning';
    } else {
      ntStatus.textContent = 'Notification permission not yet requested. Enable below and you\'ll be prompted.';
      ntStatus.className = 'nt-status nt-status--info';
    }
  }

  function applyPrefsToUI(p) {
    ntEnabled.checked = p.enabled;
    ntOptions.style.display = p.enabled ? '' : 'none';
    container.querySelector('#nt-daily-briefing').checked = p.daily_briefing;
    container.querySelector('#nt-briefing-time').value = p.daily_briefing_time || '08:00';
    container.querySelector('#nt-prep-reminders').checked = p.prep_reminders;
    container.querySelector('#nt-prep-lead').value = p.prep_lead_minutes || 15;
    container.querySelector('#nt-task-due').checked = p.task_due_reminders;
    container.querySelector('#nt-task-lead').value = p.task_lead_minutes || 10;
    container.querySelector('#nt-overdue').checked = p.overdue_alerts;
    container.querySelector('#nt-overdue-interval').value = p.overdue_interval_minutes || 30;
    container.querySelector('#nt-specials').checked = p.specials_expiring;
  }

  function readPrefsFromUI() {
    return {
      enabled: ntEnabled.checked,
      daily_briefing: container.querySelector('#nt-daily-briefing').checked,
      daily_briefing_time: container.querySelector('#nt-briefing-time').value || '08:00',
      prep_reminders: container.querySelector('#nt-prep-reminders').checked,
      prep_lead_minutes: parseInt(container.querySelector('#nt-prep-lead').value) || 15,
      task_due_reminders: container.querySelector('#nt-task-due').checked,
      task_lead_minutes: parseInt(container.querySelector('#nt-task-lead').value) || 10,
      overdue_alerts: container.querySelector('#nt-overdue').checked,
      overdue_interval_minutes: parseInt(container.querySelector('#nt-overdue-interval').value) || 30,
      specials_expiring: container.querySelector('#nt-specials').checked,
    };
  }

  updatePermissionStatus();

  // Load current notification preferences
  try {
    const currentPrefs = await getNotificationPreferences();
    applyPrefsToUI(currentPrefs);
  } catch {
    applyPrefsToUI({ enabled: false, daily_briefing: true, daily_briefing_time: '08:00', prep_reminders: true, prep_lead_minutes: 15, task_due_reminders: true, task_lead_minutes: 10, overdue_alerts: true, overdue_interval_minutes: 30, specials_expiring: true });
  }

  ntEnabled.addEventListener('change', () => {
    ntOptions.style.display = ntEnabled.checked ? '' : 'none';
  });

  ntSaveBtn.addEventListener('click', async () => {
    const newPrefs = readPrefsFromUI();

    // Request permission if enabling and not yet granted
    if (newPrefs.enabled && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        showToast('Notification permission was denied', 'warning');
        newPrefs.enabled = false;
        ntEnabled.checked = false;
        ntOptions.style.display = 'none';
      }
      updatePermissionStatus();
    }

    ntSaveBtn.disabled = true;
    ntSaveBtn.textContent = 'Saving…';
    try {
      await updateNotificationPreferences(newPrefs);
      showToast('Notification settings saved');
      restartNotifications();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      ntSaveBtn.disabled = false;
      ntSaveBtn.textContent = 'Save Notification Settings';
    }
  });

  ntTestBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications not supported', 'error');
      return;
    }
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
      updatePermissionStatus();
    }
    if (Notification.permission !== 'granted') {
      showToast('Notification permission denied', 'error');
      return;
    }
    try {
      new Notification('PlateStack Test', {
        body: 'Notifications are working! You\'ll see reminders here.',
        icon: '/favicon.svg',
      });
      showToast('Test notification sent');
    } catch {
      showToast('Failed to show notification', 'error');
    }
  });
}
