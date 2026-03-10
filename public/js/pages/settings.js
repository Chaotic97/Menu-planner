import { getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword, changePassword, getDayPhases, updateDayPhases, getNotificationPreferences, updateNotificationPreferences, restoreBackup, getAiSettings, saveAiSettings, getAiUsage, getCalendarSettings, saveCalendarSettings, getCalendarAuthUrl, disconnectCalendar, getCalendarList } from '../api.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { restartNotifications } from '../utils/notifications.js';
import { checkModelCached, preDownloadModel, deleteModelCache } from '../utils/speechToText.js';

const EU_14 = [
  'celery', 'crustaceans', 'eggs', 'fish', 'gluten', 'lupin',
  'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites',
];

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Extracted helper functions ──────────────────────────────────────────────

/** Wire up section toggle collapse/expand behavior */
function setupSectionToggles(container) {
  container.querySelectorAll('.st-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.st-section');
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      section.classList.toggle('st-section--collapsed', expanded);
    });
  });
}

/** Wire up change password form */
function setupPasswordSection(container) {
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
    pwBtn.textContent = 'Updating\u2026';
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
}

/** Wire up allergen keyword management (add, delete, list) */
async function setupAllergenKeywordsSection(container) {
  const keywordInput = container.querySelector('#ak-keyword-input');
  const allergenSelect = container.querySelector('#ak-allergen-select');
  const addBtn = container.querySelector('#ak-add-btn');
  const listEl = container.querySelector('#ak-keywords-list');

  async function loadKeywords() {
    let keywords;
    try {
      keywords = await getAllergenKeywords();
    } catch {
      listEl.innerHTML = '<p class="error-text">Failed to load keywords.</p>';
      return;
    }

    if (!keywords.length) {
      listEl.innerHTML = '<p class="ak-empty">No keywords found.</p>';
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
}

/** Wire up day phases editor (add, remove, save, reset) */
async function setupDayPhasesSection(container) {
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
          <span class="dp-phase-time-sep">\u2013</span>
          <input type="time" class="input dp-end-input" value="${escapeHtml(p.end)}">
        </div>
        <button class="dp-phase-remove" title="Remove phase" data-index="${i}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    `).join('');

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
    dpSaveBtn.textContent = 'Saving\u2026';
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
}

/** Wire up notification settings (enable, prefs, save, test) */
async function setupNotificationsSection(container) {
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
    ntSaveBtn.textContent = 'Saving\u2026';
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

/** Wire up voice input model download/delete */
function setupVoiceInputSection(container) {
  const sttBadge = container.querySelector('#stt-status-badge');
  const sttProgressContainer = container.querySelector('#stt-progress-container');
  const sttProgressFill = container.querySelector('#stt-progress-fill');
  const sttProgressText = container.querySelector('#stt-progress-text');
  const sttDownloadBtn = container.querySelector('#stt-download-btn');
  const sttDeleteBtn = container.querySelector('#stt-delete-btn');

  function setSttStatus(cached) {
    if (cached) {
      sttBadge.textContent = 'Downloaded';
      sttBadge.className = 'st-stt-badge st-stt-badge--ok';
      sttDownloadBtn.style.display = 'none';
      sttDeleteBtn.style.display = 'inline-block';
    } else {
      sttBadge.textContent = 'Not downloaded';
      sttBadge.className = 'st-stt-badge st-stt-badge--warning';
      sttDownloadBtn.style.display = 'inline-block';
      sttDeleteBtn.style.display = 'none';
    }
    sttProgressContainer.style.display = 'none';
  }

  checkModelCached().then(({ cached }) => setSttStatus(cached)).catch(() => setSttStatus(false));

  sttDownloadBtn.addEventListener('click', async () => {
    sttDownloadBtn.disabled = true;
    sttDownloadBtn.textContent = 'Downloading...';
    sttProgressContainer.style.display = 'flex';
    sttProgressFill.style.width = '0%';
    sttProgressText.textContent = '0%';

    const fileProgress = {};

    try {
      await preDownloadModel((progress) => {
        if (progress.status === 'progress' && progress.file) {
          fileProgress[progress.file] = progress.progress || 0;
          const total = Object.values(fileProgress);
          const avg = total.reduce((a, b) => a + b, 0) / total.length;
          const pct = Math.round(avg);
          sttProgressFill.style.width = pct + '%';
          sttProgressText.textContent = pct + '%';
        } else if (progress.status === 'done') {
          sttProgressFill.style.width = '100%';
          sttProgressText.textContent = '100%';
        }
      });
      showToast('Voice model downloaded successfully');
      setSttStatus(true);
    } catch (err) {
      showToast('Failed to download voice model: ' + (err.message || 'Unknown error'), 'error');
      setSttStatus(false);
    } finally {
      sttDownloadBtn.disabled = false;
      sttDownloadBtn.textContent = 'Download Voice Model';
    }
  });

  sttDeleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete the cached voice model? You will need to re-download it to use voice input.')) return;
    try {
      await deleteModelCache();
      showToast('Voice model cache deleted');
      setSttStatus(false);
    } catch (err) {
      showToast('Failed to delete cache: ' + (err.message || 'Unknown error'), 'error');
    }
  });
}

/** Wire up AI assistant settings (API key, features, usage, save) */
async function setupAiSection(container) {
  const aiKeyInput = container.querySelector('#ai-api-key');
  const aiKeyToggle = container.querySelector('#ai-key-toggle');
  const aiKeyStatus = container.querySelector('#ai-key-status');
  const aiDailyLimit = container.querySelector('#ai-daily-limit');
  const aiMonthlyLimit = container.querySelector('#ai-monthly-limit');
  const aiSaveBtn = container.querySelector('#ai-save-btn');
  const aiUsageStats = container.querySelector('#ai-usage-stats');

  aiKeyToggle.addEventListener('click', () => {
    const isPassword = aiKeyInput.type === 'password';
    aiKeyInput.type = isPassword ? 'text' : 'password';
    aiKeyToggle.textContent = isPassword ? 'Hide' : 'Show';
  });

  async function loadAiSettings() {
    try {
      const settings = await getAiSettings();
      if (settings.hasApiKey) {
        aiKeyInput.placeholder = settings.apiKey || 'Key configured';
        aiKeyStatus.textContent = 'API key is configured';
        aiKeyStatus.className = 'ai-key-status ai-key-status--ok';
      } else {
        aiKeyStatus.textContent = 'No API key set \u2014 AI features disabled';
        aiKeyStatus.className = 'ai-key-status ai-key-status--warning';
      }
      aiDailyLimit.value = settings.dailyLimit || 0;
      aiMonthlyLimit.value = settings.monthlyLimit || 0;

      const feats = settings.features || {};
      container.querySelector('#ai-feat-cleanup').checked = feats.cleanup !== false;
      container.querySelector('#ai-feat-matching').checked = feats.matching !== false;
      container.querySelector('#ai-feat-allergens').checked = feats.allergens !== false;
      container.querySelector('#ai-feat-scaling').checked = feats.scaling !== false;
    } catch {
      aiKeyStatus.textContent = 'Failed to load AI settings';
      aiKeyStatus.className = 'ai-key-status ai-key-status--warning';
    }
  }

  async function loadAiUsage() {
    try {
      const usage = await getAiUsage();
      const dailyLabel = usage.limits.daily > 0 ? ` / ${usage.limits.daily}` : '';
      const monthlyLabel = usage.limits.monthly > 0 ? ` / ${usage.limits.monthly}` : '';
      aiUsageStats.innerHTML = `
        <div class="ai-usage-row">
          <span class="ai-usage-label">Today</span>
          <span class="ai-usage-value">${usage.today.requests}${dailyLabel} requests</span>
          <span class="ai-usage-tokens">${(usage.today.tokens_in + usage.today.tokens_out).toLocaleString()} tokens</span>
        </div>
        <div class="ai-usage-row">
          <span class="ai-usage-label">This month</span>
          <span class="ai-usage-value">${usage.month.requests}${monthlyLabel} requests</span>
          <span class="ai-usage-tokens">${(usage.month.tokens_in + usage.month.tokens_out).toLocaleString()} tokens</span>
        </div>
      `;
    } catch {
      aiUsageStats.innerHTML = '<p class="ai-usage-empty">No usage data yet</p>';
    }
  }

  aiSaveBtn.addEventListener('click', async () => {
    aiSaveBtn.disabled = true;
    aiSaveBtn.textContent = 'Saving...';

    const body = {
      features: {
        cleanup: container.querySelector('#ai-feat-cleanup').checked,
        matching: container.querySelector('#ai-feat-matching').checked,
        allergens: container.querySelector('#ai-feat-allergens').checked,
        scaling: container.querySelector('#ai-feat-scaling').checked,
      },
      dailyLimit: parseInt(aiDailyLimit.value) || 0,
      monthlyLimit: parseInt(aiMonthlyLimit.value) || 0,
    };

    if (aiKeyInput.value.trim()) {
      body.apiKey = aiKeyInput.value.trim();
    }

    try {
      await saveAiSettings(body);
      showToast('AI settings saved');
      aiKeyInput.value = '';
      await loadAiSettings();
      await loadAiUsage();
    } catch (err) {
      showToast(err.message || 'Failed to save AI settings', 'error');
    } finally {
      aiSaveBtn.disabled = false;
      aiSaveBtn.textContent = 'Save AI Settings';
    }
  });

  await loadAiSettings();
  await loadAiUsage();
}

/** Wire up Google Calendar OAuth settings */
async function setupGoogleCalendarSection(container) {
  const gcalClientId = container.querySelector('#gcal-client-id');
  const gcalClientSecret = container.querySelector('#gcal-client-secret');
  const gcalSecretToggle = container.querySelector('#gcal-secret-toggle');
  const gcalRedirectUri = container.querySelector('#gcal-redirect-uri');
  const gcalSaveCredsBtn = container.querySelector('#gcal-save-creds-btn');
  const gcalConnectBtn = container.querySelector('#gcal-connect-btn');
  const gcalDisconnectBtn = container.querySelector('#gcal-disconnect-btn');
  const gcalStatusBanner = container.querySelector('#gcal-status-banner');
  const gcalCalendarPicker = container.querySelector('#gcal-calendar-picker');
  const gcalCalendarSelect = container.querySelector('#gcal-calendar-select');
  const gcalSaveCalBtn = container.querySelector('#gcal-save-calendar-btn');
  const gcalTestResult = container.querySelector('#gcal-test-result');

  gcalSecretToggle.addEventListener('click', () => {
    const isPassword = gcalClientSecret.type === 'password';
    gcalClientSecret.type = isPassword ? 'text' : 'password';
    gcalSecretToggle.textContent = isPassword ? 'Hide' : 'Show';
  });

  async function loadCalendarList(currentCalendarId) {
    try {
      const result = await getCalendarList();
      gcalCalendarSelect.innerHTML = result.calendars.map(cal =>
        `<option value="${escapeHtml(cal.id)}" ${cal.id === currentCalendarId ? 'selected' : ''}>${escapeHtml(cal.summary)}${cal.primary ? ' (Primary)' : ''}</option>`
      ).join('');
    } catch {
      gcalCalendarSelect.innerHTML = '<option value="">Failed to load calendars</option>';
    }
  }

  async function loadGcalSettings() {
    try {
      const settings = await getCalendarSettings();
      gcalClientId.value = settings.clientId || '';
      gcalRedirectUri.value = settings.redirectUri || '';

      if (settings.connected) {
        gcalStatusBanner.innerHTML = '<p class="ai-key-status ai-key-status--ok" style="margin-bottom: var(--space-md);">Connected to Google Calendar</p>';
        gcalConnectBtn.style.display = 'none';
        gcalDisconnectBtn.style.display = 'inline-block';
        gcalCalendarPicker.style.display = 'block';
        await loadCalendarList(settings.calendarId);
      } else {
        gcalStatusBanner.innerHTML = settings.hasClientId
          ? '<p class="ai-key-status ai-key-status--warning" style="margin-bottom: var(--space-md);">Not connected \u2014 click "Connect Google Calendar" below</p>'
          : '<p class="ai-key-status ai-key-status--warning" style="margin-bottom: var(--space-md);">Enter your OAuth credentials to get started</p>';
        gcalConnectBtn.style.display = 'inline-block';
        gcalConnectBtn.disabled = !settings.hasClientId;
        gcalDisconnectBtn.style.display = 'none';
        gcalCalendarPicker.style.display = 'none';
      }
    } catch {
      gcalStatusBanner.innerHTML = '<p class="ai-key-status ai-key-status--warning" style="margin-bottom: var(--space-md);">Failed to load settings</p>';
    }
  }

  gcalSaveCredsBtn.addEventListener('click', async () => {
    const id = gcalClientId.value.trim();
    const secret = gcalClientSecret.value.trim();
    if (!id) {
      showToast('Client ID is required', 'error');
      return;
    }
    gcalSaveCredsBtn.disabled = true;
    gcalSaveCredsBtn.textContent = 'Saving...';
    try {
      const body = { clientId: id };
      if (secret) body.clientSecret = secret;
      await saveCalendarSettings(body);
      showToast('Credentials saved');
      gcalClientSecret.value = '';
      await loadGcalSettings();
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    } finally {
      gcalSaveCredsBtn.disabled = false;
      gcalSaveCredsBtn.textContent = 'Save Credentials';
    }
  });

  gcalConnectBtn.addEventListener('click', async () => {
    const id = gcalClientId.value.trim();
    const secret = gcalClientSecret.value.trim();
    if (id && secret) {
      try {
        await saveCalendarSettings({ clientId: id, clientSecret: secret });
        gcalClientSecret.value = '';
      } catch (err) {
        showToast('Save credentials first: ' + err.message, 'error');
        return;
      }
    }

    gcalConnectBtn.disabled = true;
    gcalConnectBtn.textContent = 'Redirecting...';
    try {
      const result = await getCalendarAuthUrl();
      window.location.href = result.url;
    } catch (err) {
      showToast(err.message || 'Failed to get auth URL', 'error');
      gcalConnectBtn.disabled = false;
      gcalConnectBtn.textContent = 'Connect Google Calendar';
    }
  });

  gcalDisconnectBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect Google Calendar? Your calendar events will no longer appear.')) return;
    try {
      await disconnectCalendar();
      showToast('Google Calendar disconnected');
      await loadGcalSettings();
    } catch (err) {
      showToast(err.message || 'Failed to disconnect', 'error');
    }
  });

  gcalSaveCalBtn.addEventListener('click', async () => {
    const calId = gcalCalendarSelect.value;
    try {
      await saveCalendarSettings({ calendarId: calId });
      showToast('Calendar selected');
    } catch (err) {
      showToast(err.message || 'Failed to save', 'error');
    }
  });

  // Check for OAuth callback result in URL hash params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('gcal') === 'success') {
    gcalTestResult.innerHTML = '<p style="color: var(--success);">Google Calendar connected successfully!</p>';
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  } else if (urlParams.get('gcal') === 'error') {
    const msg = urlParams.get('msg') || 'Unknown error';
    gcalTestResult.innerHTML = `<p style="color: var(--danger);">Connection failed: ${escapeHtml(decodeURIComponent(msg))}</p>`;
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }

  await loadGcalSettings();
}

/** Wire up backup download and restore upload */
function setupBackupSection(container) {
  const restoreInput = container.querySelector('#st-restore-input');
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files[0];
    if (!file) return;
    if (!file.name.endsWith('.db')) {
      showToast('Please select a .db backup file', 'error');
      restoreInput.value = '';
      return;
    }
    const confirmed = confirm('Are you sure you want to restore from this backup? This will replace all current data. The server will need to restart.');
    if (!confirmed) {
      restoreInput.value = '';
      return;
    }
    try {
      const result = await restoreBackup(file);
      showToast(result.message || 'Backup restored successfully');
    } catch (err) {
      showToast(err.message || 'Failed to restore backup', 'error');
    }
    restoreInput.value = '';
  });
}

// ── Main render function ──────────────────────────────────────────────────────

export async function renderSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Settings</h1>
    </div>
    <div class="st-sections">

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">AI Assistant</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            Connect to Claude Haiku for recipe cleanup, smart commands, and kitchen workflow assistance.
            AI features require an Anthropic API key.
          </p>
          <div class="card" style="padding: var(--space-md);">
            <h3 class="st-card-heading">API Key</h3>
            <div class="st-form-group">
              <label class="st-label" for="ai-api-key">Anthropic API Key</label>
              <div class="ai-key-row">
                <input type="password" id="ai-api-key" class="input" placeholder="sk-ant-..." autocomplete="off">
                <button id="ai-key-toggle" class="btn btn-secondary btn-sm" type="button">Show</button>
              </div>
              <p id="ai-key-status" class="ai-key-status"></p>
            </div>

            <h3 class="st-card-heading" style="margin-top: var(--space-lg);">Usage Limits</h3>
            <div class="ai-limits-row">
              <div class="st-form-group">
                <label class="st-label" for="ai-daily-limit">Daily limit (0 = unlimited)</label>
                <input type="number" id="ai-daily-limit" class="input ai-limit-input" min="0" value="0">
              </div>
              <div class="st-form-group">
                <label class="st-label" for="ai-monthly-limit">Monthly limit (0 = unlimited)</label>
                <input type="number" id="ai-monthly-limit" class="input ai-limit-input" min="0" value="0">
              </div>
            </div>

            <h3 class="st-card-heading" style="margin-top: var(--space-lg);">Features</h3>
            <div class="ai-features-list">
              <label class="nt-toggle-label">
                <input type="checkbox" id="ai-feat-cleanup" class="nt-checkbox" checked>
                <span class="nt-toggle-text">Recipe cleanup</span>
              </label>
              <label class="nt-toggle-label">
                <input type="checkbox" id="ai-feat-matching" class="nt-checkbox" checked>
                <span class="nt-toggle-text">Smart ingredient matching</span>
              </label>
              <label class="nt-toggle-label">
                <input type="checkbox" id="ai-feat-allergens" class="nt-checkbox" checked>
                <span class="nt-toggle-text">Allergen verification</span>
              </label>
              <label class="nt-toggle-label">
                <input type="checkbox" id="ai-feat-scaling" class="nt-checkbox" checked>
                <span class="nt-toggle-text">Smart recipe scaling</span>
              </label>
            </div>

            <h3 class="st-card-heading" style="margin-top: var(--space-lg);">Usage</h3>
            <div id="ai-usage-stats" class="ai-usage-stats">
              <div class="loading">Loading...</div>
            </div>

            <div class="st-form-actions">
              <button id="ai-save-btn" class="btn btn-primary">Save AI Settings</button>
            </div>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Voice Input</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            Voice input uses a local Whisper model (~150 MB) that runs entirely in your browser.
            Pre-download it here so it's ready when you tap the microphone.
          </p>
          <div class="card" style="padding: var(--space-md);">
            <div id="stt-status-row" class="st-stt-status-row">
              <span id="stt-status-badge" class="st-stt-badge st-stt-badge--warning">Checking...</span>
            </div>
            <div id="stt-progress-container" class="st-stt-progress-container" style="display:none;">
              <div class="st-stt-progress">
                <div class="st-stt-progress-fill" id="stt-progress-fill"></div>
              </div>
              <span id="stt-progress-text" class="st-stt-progress-text">0%</span>
            </div>
            <div class="st-form-actions">
              <button id="stt-download-btn" class="btn btn-primary">Download Voice Model</button>
              <button id="stt-delete-btn" class="btn btn-ghost" style="color:var(--danger); display:none;">Delete Cached Model</button>
            </div>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Google Calendar</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <p class="ak-intro">
            Connect your Google Calendar to see events on the calendar page.
            Events are read-only &mdash; you can create menus from them with one click.
            Requires a Google Cloud project with the Calendar API enabled.
          </p>
          <div class="card" style="padding: var(--space-md);">
            <div id="gcal-status-banner"></div>

            <h3 class="st-card-heading">1. OAuth Credentials</h3>
            <div class="st-form-group">
              <label class="st-label" for="gcal-client-id">Client ID</label>
              <input type="text" id="gcal-client-id" class="input" placeholder="123456789.apps.googleusercontent.com" autocomplete="off">
            </div>
            <div class="st-form-group">
              <label class="st-label" for="gcal-client-secret">Client Secret</label>
              <div class="ai-key-row">
                <input type="password" id="gcal-client-secret" class="input" placeholder="GOCSPX-..." autocomplete="off">
                <button id="gcal-secret-toggle" class="btn btn-secondary btn-sm" type="button">Show</button>
              </div>
            </div>
            <div class="st-form-group">
              <label class="st-label">Redirect URI</label>
              <input type="text" id="gcal-redirect-uri" class="input" readonly style="background: var(--surface); cursor: default;">
              <p class="st-help-text" style="margin-top:4px; font-size: var(--text-xs); color: var(--text-muted);">
                Add this as an "Authorized redirect URI" in your Google Cloud Console OAuth credentials.
              </p>
            </div>
            <button id="gcal-save-creds-btn" class="btn btn-secondary" style="margin-bottom: var(--space-lg);">Save Credentials</button>

            <h3 class="st-card-heading">2. Connect Account</h3>
            <div id="gcal-connect-area">
              <button id="gcal-connect-btn" class="btn btn-primary" disabled>Connect Google Calendar</button>
              <button id="gcal-disconnect-btn" class="btn btn-ghost" style="margin-left:8px; color: var(--danger); display:none;">Disconnect</button>
            </div>

            <div id="gcal-calendar-picker" style="margin-top: var(--space-lg); display:none;">
              <h3 class="st-card-heading">3. Choose Calendar</h3>
              <div class="st-form-group">
                <label class="st-label" for="gcal-calendar-select">Calendar</label>
                <select id="gcal-calendar-select" class="input"></select>
              </div>
              <button id="gcal-save-calendar-btn" class="btn btn-secondary">Save Calendar Choice</button>
            </div>

            <div id="gcal-test-result" style="margin-top: var(--space-sm);"></div>
          </div>
        </div>
      </section>

      <section class="st-section">
        <button class="st-section-toggle" aria-expanded="true">
          <span class="st-section-title">Backup &amp; Restore</span>
          <span class="st-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
        </button>
        <div class="st-section-body">
          <div class="card st-backup-card">
            <div class="st-backup-row">
              <div class="st-backup-info">
                <h3 class="st-card-heading">Download Backup</h3>
                <p class="st-backup-desc">Download a copy of your entire database. Keep this file safe.</p>
              </div>
              <a href="/api/settings/backup" class="btn btn-primary" id="st-backup-btn" download>Download .db</a>
            </div>
          </div>
          <div class="card st-backup-card" style="margin-top: var(--space-sm);">
            <div class="st-backup-row">
              <div class="st-backup-info">
                <h3 class="st-card-heading">Restore from Backup</h3>
                <p class="st-backup-desc">Upload a previously downloaded .db file. The server will need to restart for changes to take effect.</p>
              </div>
              <label class="btn btn-secondary st-restore-label" for="st-restore-input">
                Upload .db
                <input type="file" id="st-restore-input" accept=".db" hidden>
              </label>
            </div>
          </div>
        </div>
      </section>

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

  // Wire up all sections via extracted helpers
  setupSectionToggles(container);
  setupPasswordSection(container);
  await setupAllergenKeywordsSection(container);
  await setupDayPhasesSection(container);
  await setupNotificationsSection(container);
  setupVoiceInputSection(container);
  await setupAiSection(container);
  await setupGoogleCalendarSection(container);
  setupBackupSection(container);
}
