import { getDish, createDish, updateDish, uploadDishPhoto, getIngredients, duplicateDish } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openLightbox } from '../components/lightbox.js';
import { CATEGORIES } from '../data/categories.js';
import { UNITS } from '../data/units.js';
import { loadAllergenKeywords, detectAllergensClient } from '../data/allergenKeywords.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { convertUnit as rawConvert, compatibleUnits } from '../utils/unitConversion.js';
import { ALLERGEN_LIST, capitalize } from '../data/allergens.js';

function convertUnit(qty, fromUnit, toUnit) {
  const result = rawConvert(qty, fromUnit, toUnit);
  if (result === null) return null;
  if (result >= 100) return Math.round(result * 10) / 10;
  if (result >= 10)  return Math.round(result * 100) / 100;
  return Math.round(result * 10000) / 10000;
}

export async function renderDishForm(container, dishId) {
  const isEdit = !!dishId;
  let dish = null;
  let allergenKeywords = [];

  container.innerHTML = '<div class="loading">Loading...</div>';

  try {
    allergenKeywords = await loadAllergenKeywords();
    if (isEdit) {
      dish = await getDish(dishId);
    }
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
    return;
  }

  // Check for imported recipe data (from URL import)
  let importedData = null;
  if (!isEdit) {
    try {
      const stored = sessionStorage.getItem('importedRecipe');
      if (stored) {
        importedData = JSON.parse(stored);
        sessionStorage.removeItem('importedRecipe');
      }
    } catch {}
  }

  // Build ingredients list from dish data or imported data
  let ingredients;
  if (dish) {
    ingredients = dish.ingredients;
  } else if (importedData && importedData.ingredients) {
    ingredients = importedData.ingredients.map(ing => ({
      ingredient_name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      prep_note: ing.prep_note || '',
    }));
  } else {
    ingredients = [];
  }

  // Tags
  const existingTags = dish ? (dish.tags || []) : [];
  // Substitutions
  const existingSubs = dish ? (dish.substitutions || []) : [];

  container.innerHTML = `
    <div class="page-header">
      <a href="#/dishes" class="btn btn-back">&larr; Back</a>
      <h1>${isEdit ? 'Edit Dish' : 'New Dish'}</h1>
      ${isEdit ? '<button id="duplicate-dish-btn" class="btn btn-secondary">Duplicate</button>' : ''}
    </div>
    ${importedData ? `
      <div style="padding:12px 16px; background:#e8f5e9; border-radius:var(--radius-sm); margin-bottom:16px; font-size:0.9rem;">
        Imported from: <a href="${escapeHtml(importedData.source_url)}" target="_blank" rel="noopener">${escapeHtml(importedData.source_url)}</a>.
        Review the details below and save when ready.
      </div>
    ` : ''}
    <form id="dish-form" class="form">
      <div class="form-grid">
        <div class="form-main">
          <div class="form-group">
            <label for="dish-name">Dish Name *</label>
            <input type="text" id="dish-name" class="input" required value="${dish ? escapeHtml(dish.name) : (importedData ? escapeHtml(importedData.name) : '')}" placeholder="e.g., Pan-Seared Salmon">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="dish-category">Category</label>
              <select id="dish-category" class="input">
                ${CATEGORIES.map(c => {
                  const selected = (dish && dish.category === c.value) || (!dish && importedData && importedData.category === c.value);
                  return `<option value="${c.value}" ${selected ? 'selected' : ''}>${c.label}</option>`;
                }).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="dish-price">Selling Price ($)</label>
              <input type="number" id="dish-price" class="input" step="0.01" min="0" value="${dish ? dish.suggested_price : ''}" placeholder="0.00">
            </div>
          </div>
          <div class="form-group">
            <label for="dish-tags">Tags</label>
            <input type="text" id="dish-tags" class="input" placeholder="e.g., summer, grill, quick (comma-separated)" value="${escapeHtml(existingTags.join(', '))}">
          </div>
          <div class="form-group">
            <label for="dish-desc">Description</label>
            <textarea id="dish-desc" class="input" rows="2" placeholder="Brief description...">${dish ? escapeHtml(dish.description) : (importedData ? escapeHtml(importedData.description) : '')}</textarea>
          </div>

          <!-- Photo Upload -->
          <div class="form-group">
            <label>Photo</label>
            <div class="photo-upload" id="photo-upload-area">
              ${dish && dish.photo_path
                ? `<img src="${escapeHtml(dish.photo_path)}" alt="Dish photo" class="photo-preview" id="photo-preview">`
                : '<div class="photo-placeholder" id="photo-preview"><span>Tap to upload photo</span></div>'
              }
              <input type="file" id="photo-input" accept="image/*" hidden>
            </div>
          </div>

          <!-- Ingredients -->
          <div class="form-group">
            <label>Ingredients</label>
            <div id="ingredients-list">
              ${ingredients.map((ing, i) => ingredientRow(ing, i)).join('')}
            </div>
            <button type="button" id="add-ingredient" class="btn btn-secondary">+ Add Ingredient</button>
          </div>

          <!-- Allergens (auto-detected) -->
          <div class="form-group">
            <label>Detected Allergens</label>
            <div id="allergen-preview">
              ${dish ? renderAllergenBadges(dish.allergens) : '<span class="text-muted">Add ingredients to detect allergens</span>'}
            </div>
          </div>

          <!-- Allergen Substitutions -->
          <div class="form-group">
            <label>Allergen Substitutions</label>
            <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Add ingredient swaps for allergen-free versions (e.g., wheat flour &rarr; rice flour for gluten-free)</p>
            <div id="substitutions-list">
              ${existingSubs.map((sub, i) => substitutionRow(sub, i)).join('')}
            </div>
            <button type="button" id="add-substitution" class="btn btn-secondary">+ Add Substitution</button>
          </div>

          <!-- Cost Breakdown -->
          <div class="form-group" id="cost-section">
            <label>Cost Breakdown</label>
            <div id="cost-breakdown">
              ${dish && dish.cost ? renderCostBreakdown(dish) : '<span class="text-muted">Add ingredients with costs to see breakdown</span>'}
            </div>
          </div>

          <!-- Chef's Notes -->
          <div class="form-group">
            <label for="dish-notes">Chef's Notes</label>
            <textarea id="dish-notes" class="input" rows="4" placeholder="Prep instructions, timing notes, plating details...&#10;e.g., Marinate overnight. Sear skin-side down 4 minutes.">${dish ? escapeHtml(dish.chefs_notes) : (importedData ? escapeHtml(importedData.instructions) : '')}</textarea>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-lg">${isEdit ? 'Save Changes' : 'Create Dish'}</button>
        <a href="#/dishes" class="btn btn-lg">Cancel</a>
      </div>
    </form>
  `;

  // Wire up interactions
  const form = container.querySelector('#dish-form');
  const ingredientsList = container.querySelector('#ingredients-list');
  const addBtn = container.querySelector('#add-ingredient');
  const photoArea = container.querySelector('#photo-upload-area');
  const photoInput = container.querySelector('#photo-input');
  const allergenPreview = container.querySelector('#allergen-preview');
  const subsList = container.querySelector('#substitutions-list');
  const addSubBtn = container.querySelector('#add-substitution');

  let ingredientCounter = ingredients.length;
  let subCounter = existingSubs.length;

  // Duplicate button (edit mode only)
  const dupBtn = container.querySelector('#duplicate-dish-btn');
  if (dupBtn) {
    dupBtn.addEventListener('click', async () => {
      try {
        const result = await duplicateDish(dishId);
        showToast('Dish duplicated');
        window.location.hash = `#/dishes/${result.id}/edit`;
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // If imported data has ingredients, trigger allergen preview
  if (importedData && ingredients.length) {
    setTimeout(() => updateAllergenPreview(), 0);
  }

  // Photo upload + lightbox
  photoArea.addEventListener('click', (e) => {
    const preview = container.querySelector('#photo-preview');
    if (preview.tagName === 'IMG' && e.target === preview) {
      openLightbox(preview.src, dish ? dish.name : 'Preview');
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const preview = container.querySelector('#photo-preview');
      if (preview.tagName === 'IMG') {
        preview.src = e.target.result;
      } else {
        preview.outerHTML = `<img src="${e.target.result}" alt="Dish photo" class="photo-preview" id="photo-preview">`;
      }
    };
    reader.readAsDataURL(file);

    if (isEdit) {
      const formData = new FormData();
      formData.append('photo', file);
      try {
        await uploadDishPhoto(dishId, formData);
        showToast('Photo updated');
      } catch (err) {
        showToast('Photo upload failed', 'error');
      }
    }
  });

  // Add ingredient row
  addBtn.addEventListener('click', () => {
    ingredientCounter++;
    const div = document.createElement('div');
    div.innerHTML = ingredientRow(null, ingredientCounter);
    ingredientsList.appendChild(div.firstElementChild);
    setupAutocomplete(ingredientsList.lastElementChild.querySelector('.ing-name'));
    updateAllergenPreview();
  });

  // Remove ingredient row
  ingredientsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-ingredient')) {
      e.target.closest('.ingredient-row').remove();
      updateAllergenPreview();
    }

    // Unit converter button
    if (e.target.closest('.ing-convert-btn')) {
      const btn = e.target.closest('.ing-convert-btn');
      const row = btn.closest('.ingredient-row');
      const converterEl = row.querySelector('.ing-converter');
      if (!converterEl) return;

      // Toggle
      if (converterEl.style.display !== 'none' && converterEl.innerHTML) {
        converterEl.style.display = 'none';
        converterEl.innerHTML = '';
        return;
      }

      const fromUnit = row.querySelector('.ing-unit').value;
      const fromQty  = parseFloat(row.querySelector('.ing-qty').value) || 0;
      const compat   = compatibleUnits(fromUnit);
      if (!compat.length) return;

      const defaultTarget = compat[0];
      const initialResult = fromQty ? convertUnit(fromQty, fromUnit, defaultTarget) : null;

      converterEl.innerHTML = `
        <div class="ing-converter-inner">
          <span class="ing-converter-label">Convert <strong>${fromQty || '?'} ${fromUnit}</strong> to:</span>
          <select class="input ing-converter-target" style="flex:0 0 auto;min-width:80px;">
            ${compat.map(u => `<option value="${u}">${u}</option>`).join('')}
          </select>
          <span class="ing-converter-result">${initialResult !== null ? `= <strong>${initialResult} ${defaultTarget}</strong>` : '—'}</span>
          <button type="button" class="btn btn-sm btn-primary ing-converter-apply">Apply</button>
          <button type="button" class="btn btn-sm ing-converter-cancel">✕</button>
        </div>
      `;
      converterEl.style.display = 'block';

      const targetSel    = converterEl.querySelector('.ing-converter-target');
      const resultSpan   = converterEl.querySelector('.ing-converter-result');
      const applyBtn     = converterEl.querySelector('.ing-converter-apply');
      const cancelBtn    = converterEl.querySelector('.ing-converter-cancel');

      function updateResult() {
        const qty = parseFloat(row.querySelector('.ing-qty').value) || 0;
        const to  = targetSel.value;
        const r   = convertUnit(qty, fromUnit, to);
        resultSpan.innerHTML = r !== null ? `= <strong>${r} ${to}</strong>` : '—';
      }

      targetSel.addEventListener('change', updateResult);
      row.querySelector('.ing-qty').addEventListener('input', updateResult);

      applyBtn.addEventListener('click', () => {
        const qty = parseFloat(row.querySelector('.ing-qty').value) || 0;
        const to  = targetSel.value;
        const r   = convertUnit(qty, fromUnit, to);
        if (r === null) return;
        row.querySelector('.ing-qty').value = r;
        // Update the unit select
        row.querySelector('.ing-unit').value = to;
        // Refresh convert button availability
        const newCompat = compatibleUnits(to);
        btn.disabled = !newCompat.length;
        btn.style.opacity = newCompat.length ? '' : '0.35';
        converterEl.style.display = 'none';
        converterEl.innerHTML = '';
        showToast(`Converted: ${qty} ${fromUnit} → ${r} ${to}`);
      });

      cancelBtn.addEventListener('click', () => {
        converterEl.style.display = 'none';
        converterEl.innerHTML = '';
      });
    }
  });

  // Live allergen preview on ingredient name change
  ingredientsList.addEventListener('input', (e) => {
    if (e.target.classList.contains('ing-name')) {
      updateAllergenPreview();
    }
  });

  // Add substitution row
  addSubBtn.addEventListener('click', () => {
    subCounter++;
    const div = document.createElement('div');
    div.innerHTML = substitutionRow(null, subCounter);
    subsList.appendChild(div.firstElementChild);
  });

  // Remove substitution row
  subsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-sub')) {
      e.target.closest('.substitution-row').remove();
    }
  });

  function updateAllergenPreview() {
    const names = Array.from(ingredientsList.querySelectorAll('.ing-name'))
      .map(el => el.value.trim())
      .filter(Boolean);

    if (!names.length) {
      allergenPreview.innerHTML = '<span class="text-muted">Add ingredients to detect allergens</span>';
      return;
    }

    const detected = detectAllergensClient(names, allergenKeywords);
    if (detected.length) {
      allergenPreview.innerHTML = renderAllergenBadges(detected);
    } else {
      allergenPreview.innerHTML = '<span class="text-muted">No allergens detected</span>';
    }
  }

  // Ingredient autocomplete
  function setupAutocomplete(input) {
    let dropdown = null;

    input.addEventListener('input', async () => {
      const val = input.value.trim();
      if (val.length < 2) {
        removeDropdown();
        return;
      }

      try {
        const results = await getIngredients(val);
        if (!results.length) {
          removeDropdown();
          return;
        }

        removeDropdown();
        dropdown = document.createElement('div');
        dropdown.className = 'autocomplete-dropdown';
        results.slice(0, 8).forEach(ing => {
          const item = document.createElement('div');
          item.className = 'autocomplete-item';
          item.textContent = ing.name;
          item.addEventListener('click', () => {
            input.value = ing.name;
            removeDropdown();
            updateAllergenPreview();
          });
          dropdown.appendChild(item);
        });

        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(dropdown);
      } catch {
        removeDropdown();
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(removeDropdown, 200);
    });

    function removeDropdown() {
      if (dropdown) {
        dropdown.remove();
        dropdown = null;
      }
    }
  }

  // Set up autocomplete on existing rows
  ingredientsList.querySelectorAll('.ing-name').forEach(setupAutocomplete);

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = container.querySelector('#dish-name').value.trim();
    if (!name) {
      showToast('Dish name is required', 'error');
      return;
    }

    const ingRows = ingredientsList.querySelectorAll('.ingredient-row');
    const ingData = Array.from(ingRows).map(row => ({
      name: row.querySelector('.ing-name').value.trim(),
      quantity: parseFloat(row.querySelector('.ing-qty').value) || 0,
      unit: row.querySelector('.ing-unit').value,
      prep_note: row.querySelector('.ing-prep').value.trim(),
    })).filter(i => i.name);

    // Collect tags
    const tagsInput = container.querySelector('#dish-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

    // Collect substitutions
    const subRows = subsList.querySelectorAll('.substitution-row');
    const substitutions = Array.from(subRows).map(row => ({
      allergen: row.querySelector('.sub-allergen').value,
      original_ingredient: row.querySelector('.sub-original').value.trim(),
      substitute_ingredient: row.querySelector('.sub-substitute').value.trim(),
      notes: row.querySelector('.sub-notes')?.value.trim() || '',
    })).filter(s => s.allergen && s.original_ingredient && s.substitute_ingredient);

    const data = {
      name,
      description: container.querySelector('#dish-desc').value.trim(),
      category: container.querySelector('#dish-category').value,
      chefs_notes: container.querySelector('#dish-notes').value.trim(),
      suggested_price: parseFloat(container.querySelector('#dish-price').value) || 0,
      ingredients: ingData,
      tags,
      substitutions,
    };

    try {
      if (isEdit) {
        await updateDish(dishId, data);
        showToast('Dish updated');
      } else {
        const result = await createDish(data);
        const file = photoInput.files[0];
        if (file) {
          const formData = new FormData();
          formData.append('photo', file);
          await uploadDishPhoto(result.id, formData);
        }
        showToast('Dish created');
      }
      window.location.hash = '#/dishes';
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Sync listener (edit mode)
  if (isEdit) {
    const onUpdate = (e) => {
      if (e.detail && e.detail.id == dishId) {
        showToast('This dish was updated on another device', 'info', 5000, {
          label: 'Reload',
          onClick: () => { window.location.reload(); }
        });
      }
    };
    window.addEventListener('sync:dish_updated', onUpdate);
    window.addEventListener('hashchange', () => {
      window.removeEventListener('sync:dish_updated', onUpdate);
    }, { once: true });
  }
}

function ingredientRow(ing, index) {
  const currentUnit = ing?.unit || 'g';
  const compat = compatibleUnits(currentUnit);
  const canConvert = compat.length > 0;
  return `
    <div class="ingredient-row" data-index="${index}">
      <div class="ing-main-controls">
        <div class="ing-field ing-name-field">
          <input type="text" class="input ing-name" placeholder="Ingredient name" value="${escapeHtml(ing ? ing.ingredient_name : '')}">
        </div>
        <div class="ing-field ing-qty-field">
          <input type="number" class="input ing-qty" placeholder="Qty" step="0.01" min="0" value="${ing ? ing.quantity : ''}">
        </div>
        <div class="ing-field ing-unit-field">
          <select class="input ing-unit">
            ${UNITS.map(u => `<option value="${u.value}" ${ing && ing.unit === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-icon ing-convert-btn" title="Convert unit"
                ${!canConvert ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''}>⇄</button>
        <div class="ing-field ing-prep-field">
          <input type="text" class="input ing-prep" placeholder="Prep note (e.g., dice, marinate 24hr)" value="${escapeHtml(ing ? ing.prep_note : '')}">
        </div>
        <button type="button" class="btn btn-icon remove-ingredient" title="Remove">&times;</button>
      </div>
      <div class="ing-converter" style="display:none;"></div>
    </div>
  `;
}

function substitutionRow(sub, index) {
  return `
    <div class="substitution-row" data-index="${index}">
      <div class="sub-field sub-allergen-field">
        <select class="input sub-allergen" style="font-size:0.85rem;padding:6px 8px;min-height:36px;">
          <option value="">Allergen...</option>
          ${ALLERGEN_LIST.map(a => `<option value="${a}" ${sub && sub.allergen === a ? 'selected' : ''}>${capitalize(a)}</option>`).join('')}
        </select>
      </div>
      <div class="sub-field sub-original-field">
        <input type="text" class="input sub-original" placeholder="Original ingredient" value="${escapeHtml(sub ? sub.original_ingredient : '')}" style="font-size:0.85rem;padding:6px 8px;min-height:36px;">
      </div>
      <span class="sub-arrow">&rarr;</span>
      <div class="sub-field sub-substitute-field">
        <input type="text" class="input sub-substitute" placeholder="Substitute" value="${escapeHtml(sub ? sub.substitute_ingredient : '')}" style="font-size:0.85rem;padding:6px 8px;min-height:36px;">
      </div>
      <div class="sub-field sub-notes-field">
        <input type="text" class="input sub-notes" placeholder="Notes" value="${escapeHtml(sub ? (sub.notes || '') : '')}" style="font-size:0.85rem;padding:6px 8px;min-height:36px;">
      </div>
      <button type="button" class="btn btn-icon remove-sub" title="Remove">&times;</button>
    </div>
  `;
}

function renderCostBreakdown(dish) {
  if (!dish.cost || !dish.cost.lineItems.length) return '<span class="text-muted">No cost data</span>';

  let html = '<div class="cost-table">';
  for (const item of dish.cost.lineItems) {
    html += `<div class="cost-row">
      <span>${escapeHtml(item.ingredient)}</span>
      <span>${item.quantity} ${item.unit}</span>
      <span>${item.cost !== null ? '$' + item.cost.toFixed(2) : (item.warning ? escapeHtml(item.warning) : 'N/A')}</span>
    </div>`;
  }
  html += `<div class="cost-row cost-total">
    <span>Total Dish Cost</span>
    <span></span>
    <span>$${dish.cost.totalCost.toFixed(2)}</span>
  </div>`;

  if (dish.food_cost_percent !== null) {
    html += `<div class="cost-row">
      <span>Food Cost %</span>
      <span></span>
      <span class="${dish.food_cost_percent > 35 ? 'text-danger' : dish.food_cost_percent > 30 ? 'text-warning' : 'text-success'}">${dish.food_cost_percent}%</span>
    </div>`;
  }
  if (dish.suggested_price_calc) {
    html += `<div class="cost-row">
      <span>Suggested Price (30% food cost)</span>
      <span></span>
      <span>$${dish.suggested_price_calc.toFixed(2)}</span>
    </div>`;
  }

  html += '</div>';
  return html;
}
