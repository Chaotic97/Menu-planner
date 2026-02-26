import { getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword } from '../api.js';
import { showToast } from '../components/toast.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const EU_14 = [
  'celery', 'crustaceans', 'eggs', 'fish', 'gluten', 'lupin',
  'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites',
];

export async function renderAllergenKeywords(container) {
  container.innerHTML = `
    <div class="page-header">
      <h1>Allergen Keywords</h1>
    </div>
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
  `;

  const keywordInput = container.querySelector('#ak-keyword-input');
  const allergenSelect = container.querySelector('#ak-allergen-select');
  const addBtn = container.querySelector('#ak-add-btn');
  const listEl = container.querySelector('#ak-keywords-list');

  async function load() {
    let keywords;
    try {
      keywords = await getAllergenKeywords();
    } catch (e) {
      listEl.innerHTML = `<p class="error-text">Failed to load keywords.</p>`;
      return;
    }

    if (!keywords.length) {
      listEl.innerHTML = `<p class="ak-empty">No keywords found.</p>`;
      return;
    }

    // Group by allergen
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
        const id = btn.dataset.id;
        try {
          await deleteAllergenKeyword(id);
          await load();
        } catch (e) {
          showToast(e.message || 'Failed to delete keyword', { type: 'error' });
        }
      });
    });
  }

  addBtn.addEventListener('click', async () => {
    const keyword = keywordInput.value.trim();
    const allergen = allergenSelect.value;
    if (!keyword) {
      showToast('Please enter a keyword', { type: 'error' });
      keywordInput.focus();
      return;
    }
    try {
      await addAllergenKeyword({ keyword, allergen });
      keywordInput.value = '';
      keywordInput.focus();
      await load();
    } catch (e) {
      showToast(e.message || 'Failed to add keyword', { type: 'error' });
    }
  });

  keywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  await load();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
