import { getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword, changePassword, getDayPhases, updateDayPhases } from '../api.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

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
}
