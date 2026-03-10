import { getDish, createDish, updateDish, uploadDishPhoto, deleteDishPhoto, getIngredients, duplicateDish, updateDishAllergen, aiCleanupRecipe, aiConfirm, aiUndo } from '../api.js';
import { showToast } from '../components/toast.js';
import { openLightbox } from '../components/lightbox.js';
import { createActionMenu } from '../components/actionMenu.js';
import { makeCollapsible, collapsibleHeader } from '../components/collapsible.js';
import { CATEGORIES } from '../data/categories.js';
import { UNITS } from '../data/units.js';
import { loadAllergenKeywords, detectAllergensClient, ALLERGEN_INFO } from '../data/allergenKeywords.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { convertUnit as rawConvert, compatibleUnits } from '../utils/unitConversion.js';
import { ALLERGEN_LIST, capitalize } from '../data/allergens.js';

/** Render allergen badges grouped by source ingredient */
function renderAllergenBadgesWithSource(allergens) {
  if (!allergens || !allergens.length) return '';
  // Group by allergen, collect ingredient names
  const grouped = {};
  for (const a of allergens) {
    const name = typeof a === 'string' ? a : a.allergen;
    if (!grouped[name]) grouped[name] = [];
    if (a.ingredient_name) grouped[name].push(a.ingredient_name);
  }
  return '<div class="allergen-badges">' + Object.entries(grouped).map(([allergen, ingredients]) => {
    const info = ALLERGEN_INFO[allergen] || { label: allergen, color: '#999' };
    const title = ingredients.length
      ? `${escapeHtml(info.label)} (from: ${ingredients.map(n => escapeHtml(n)).join(', ')})`
      : escapeHtml(info.label);
    return `<span class="allergen-badge" style="background:${info.color}" title="${title}">${escapeHtml(info.label)}</span>`;
  }).join('') + '</div>';
}

function convertUnit(qty, fromUnit, toUnit) {
  const result = rawConvert(qty, fromUnit, toUnit);
  if (result === null) return null;
  if (result >= 100) return Math.round(result * 10) / 10;
  if (result >= 10)  return Math.round(result * 100) / 100;
  return Math.round(result * 10000) / 10000;
}

// ── Extracted helper functions ──────────────────────────────────────────────

/** Update the allergen preview badges based on current ingredient names */
function updateAllergenPreview(ingredientsList, allergenPreview, allergenKeywords) {
  const names = Array.from(ingredientsList.querySelectorAll('.ing-name'))
    .map(el => el.value.trim())
    .filter(Boolean);

  if (!names.length) {
    allergenPreview.innerHTML = '<span class="text-muted">Add ingredients to detect allergens</span>';
    return;
  }

  const allergenEntries = [];
  for (const name of names) {
    const detected = detectAllergensClient([name], allergenKeywords);
    for (const allergen of detected) {
      allergenEntries.push({ allergen, ingredient_name: name });
    }
  }

  if (allergenEntries.length) {
    allergenPreview.innerHTML = renderAllergenBadgesWithSource(allergenEntries);
  } else {
    allergenPreview.innerHTML = '<span class="text-muted">No allergens detected</span>';
  }
}

/** Update the ingredient count subtitle on the collapsible section */
function updateIngredientSubtitle(container) {
  const count = container.querySelectorAll('.ingredient-row').length;
  const el = container.querySelector('#section-ingredients .collapsible-section__subtitle');
  if (el) {
    el.textContent = count ? `${count} ingredient${count !== 1 ? 's' : ''}` : '';
  }
}

/** Update both prep and service direction subtitles */
function updateDirectionSubtitles(container) {
  const prepCount = container.querySelectorAll('#directions-list .dir-step-row').length;
  const prepEl = container.querySelector('#section-prep-directions .collapsible-section__subtitle');
  if (prepEl) {
    prepEl.textContent = prepCount ? `${prepCount} step${prepCount !== 1 ? 's' : ''}` : '';
  }
  const svcCount = container.querySelectorAll('#service-directions-list .dir-step-row').length;
  const svcEl = container.querySelector('#section-svc-directions .collapsible-section__subtitle');
  if (svcEl) {
    svcEl.textContent = svcCount ? `${svcCount} step${svcCount !== 1 ? 's' : ''}` : '';
  }
}

/** Set up ingredient name autocomplete with debounced API lookup */
function setupAutocomplete(input, updateAllergenPreviewFn) {
  let dropdown = null;
  let acDebounce = null;

  input.addEventListener('input', () => {
    clearTimeout(acDebounce);
    const val = input.value.trim();
    if (val.length < 2) {
      removeDropdown();
      return;
    }

    acDebounce = setTimeout(async () => {
      const currentVal = input.value.trim();
      if (currentVal !== val) return;

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
            updateAllergenPreviewFn();
          });
          dropdown.appendChild(item);
        });

        input.parentElement.style.position = 'relative';
        input.parentElement.appendChild(dropdown);
      } catch {
        removeDropdown();
      }
    }, 250);
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

/** Wire up photo upload area: click, delete, file input change */
function setupPhotoHandlers(ctx) {
  const { container, photoArea, photoInput, isEdit, dishId, dish } = ctx;

  photoArea.addEventListener('click', (e) => {
    if (e.target.closest('#photo-delete-btn')) return;
    const preview = container.querySelector('#photo-preview');
    if (preview && preview.tagName === 'IMG' && e.target === preview) {
      openLightbox(preview.src, dish ? dish.name : 'Preview');
      return;
    }
    photoInput.click();
  });

  photoArea.addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('#photo-delete-btn');
    if (!deleteBtn) return;
    e.stopPropagation();

    if (isEdit) {
      deleteBtn.disabled = true;
      try {
        await deleteDishPhoto(dishId);
        showToast('Photo removed');
      } catch (_err) {
        showToast('Failed to remove photo', 'error');
        deleteBtn.disabled = false;
        return;
      }
    }

    const wrap = container.querySelector('#photo-preview-wrap');
    if (wrap) {
      wrap.outerHTML = '<div class="photo-placeholder" id="photo-preview"><span>Tap to upload photo</span></div>';
    }
    photoInput.value = '';
  });

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const existingWrap = container.querySelector('#photo-preview-wrap');
      const existingPlaceholder = container.querySelector('#photo-preview');
      const newHtml = `<div class="photo-preview-wrap" id="photo-preview-wrap">
        <img src="${evt.target.result}" alt="Dish photo" class="photo-preview" id="photo-preview">
        <button type="button" class="photo-delete-btn" id="photo-delete-btn" title="Remove photo">&times;</button>
      </div>`;
      if (existingWrap) {
        existingWrap.outerHTML = newHtml;
      } else if (existingPlaceholder) {
        existingPlaceholder.outerHTML = newHtml;
      }
    };
    reader.readAsDataURL(file);

    if (isEdit) {
      const formData = new FormData();
      formData.append('photo', file);
      try {
        await uploadDishPhoto(dishId, formData);
        showToast('Photo updated');
      } catch (_err) {
        showToast('Photo upload failed', 'error');
      }
    }
  });
}

/** Wire up ingredient add, section add, remove, unit converter, live allergen preview */
function setupIngredientHandlers(ctx) {
  const { container, ingredientsList, allergenPreview, allergenKeywords, counters } = ctx;
  const addBtn = container.querySelector('#add-ingredient');
  const addSectionBtn = container.querySelector('#add-section-header');

  const updatePreview = () => updateAllergenPreview(ingredientsList, allergenPreview, allergenKeywords);
  const updateSubtitle = () => updateIngredientSubtitle(container);

  addBtn.addEventListener('click', () => {
    counters.ingredient++;
    const div = document.createElement('div');
    div.innerHTML = ingredientRow(null, counters.ingredient);
    ingredientsList.appendChild(div.firstElementChild);
    setupAutocomplete(ingredientsList.lastElementChild.querySelector('.ing-name'), updatePreview);
    updatePreview();
    updateSubtitle();
  });

  addSectionBtn.addEventListener('click', () => {
    counters.section++;
    const div = document.createElement('div');
    div.innerHTML = sectionHeaderRow(null, `s${counters.section}`);
    ingredientsList.appendChild(div.firstElementChild);
  });

  ingredientsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-ingredient')) {
      e.target.closest('.ingredient-row').remove();
      updatePreview();
      updateSubtitle();
      return;
    }

    if (e.target.closest('.remove-section-header')) {
      e.target.closest('.section-header-row').remove();
      return;
    }

    if (e.target.closest('.ing-convert-btn')) {
      const btn = e.target.closest('.ing-convert-btn');
      const row = btn.closest('.ingredient-row');
      const converterEl = row.querySelector('.ing-converter');
      if (!converterEl) return;

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
          <button type="button" class="btn btn-sm ing-converter-cancel">&#10005;</button>
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
        row.querySelector('.ing-unit').value = to;
        const newCompat = compatibleUnits(to);
        btn.disabled = !newCompat.length;
        btn.style.opacity = newCompat.length ? '' : '0.35';
        converterEl.style.display = 'none';
        converterEl.innerHTML = '';
        showToast(`Converted: ${qty} ${fromUnit} \u2192 ${r} ${to}`);
      });

      cancelBtn.addEventListener('click', () => {
        converterEl.style.display = 'none';
        converterEl.innerHTML = '';
      });
    }
  });

  ingredientsList.addEventListener('input', (e) => {
    if (e.target.classList.contains('ing-name')) {
      updatePreview();
    }
  });

  ingredientsList.querySelectorAll('.ing-name').forEach(input => setupAutocomplete(input, updatePreview));
}

/** Wire up substitution add/remove, manual allergen toggles, manual cost items */
function setupSubstitutionAndAllergenHandlers(ctx) {
  const { container, subsList, isEdit, dishId, manualAllergens, counters } = ctx;
  const addSubBtn = container.querySelector('#add-substitution');

  addSubBtn.addEventListener('click', () => {
    counters.sub++;
    const div = document.createElement('div');
    div.innerHTML = substitutionRow(null, counters.sub);
    subsList.appendChild(div.firstElementChild);
  });

  subsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-sub')) {
      e.target.closest('.substitution-row').remove();
    }
  });

  const allergenToggleGrid = container.querySelector('#allergen-manual-toggles');
  allergenToggleGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.allergen-toggle');
    if (!btn) return;
    const allergen = btn.dataset.allergen;
    const isActive = btn.classList.contains('active');

    if (isEdit) {
      try {
        await updateDishAllergen(dishId, { allergen, action: isActive ? 'remove' : 'add' });
        btn.classList.toggle('active');
        showToast(isActive ? `Removed ${allergen}` : `Added ${allergen}`);
      } catch (_err) {
        showToast('Failed to update allergen', 'error');
      }
    } else {
      btn.classList.toggle('active');
      if (!isActive) {
        manualAllergens.add(allergen);
      } else {
        manualAllergens.delete(allergen);
      }
    }
  });

  const manualCostsList = container.querySelector('#manual-costs-list');
  const addManualCostBtn = container.querySelector('#add-manual-cost');

  addManualCostBtn.addEventListener('click', () => {
    counters.manualCost++;
    const div = document.createElement('div');
    div.innerHTML = manualCostRow(null, counters.manualCost);
    manualCostsList.appendChild(div.firstElementChild);
  });

  manualCostsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-manual-cost')) {
      e.target.closest('.manual-cost-row').remove();
    }
  });
}

/** Wire up service component add/remove and drag-drop */
function setupComponentHandlers(ctx) {
  const { container, counters } = ctx;
  const componentsList = container.querySelector('#components-list');

  container.querySelector('#add-component').addEventListener('click', () => {
    const div = document.createElement('div');
    div.innerHTML = componentRow(null, counters.component++);
    componentsList.appendChild(div.firstElementChild);
  });

  componentsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-component')) {
      e.target.closest('.component-row').remove();
    }
  });

  setupComponentDragDrop(componentsList);
}

/** Wire up prep and service direction add/remove, drag-drop, and AI cleanup */
function setupDirectionHandlers(ctx) {
  const { container, dish, counters } = ctx;
  const directionsList = container.querySelector('#directions-list');
  const svcDirectionsList = container.querySelector('#service-directions-list');

  const updateSubtitles = () => updateDirectionSubtitles(container);

  container.querySelector('#add-direction-step').addEventListener('click', () => {
    counters.dirStep++;
    const div = document.createElement('div');
    div.innerHTML = directionStepRow(null, counters.dirStep);
    directionsList.appendChild(div.firstElementChild);
    const rows = directionsList.querySelectorAll('.dir-step-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.dir-text').focus();
    updateSubtitles();
  });

  container.querySelector('#add-direction-section').addEventListener('click', () => {
    counters.dirStep++;
    const div = document.createElement('div');
    div.innerHTML = directionSectionRow(null, counters.dirStep);
    directionsList.appendChild(div.firstElementChild);
    const rows = directionsList.querySelectorAll('.dir-section-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.dir-section-label').focus();
  });

  directionsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-dir-step')) {
      e.target.closest('.dir-step-row').remove();
      updateSubtitles();
      return;
    }
    if (e.target.closest('.remove-dir-section')) {
      e.target.closest('.dir-section-row').remove();
    }
  });

  // AI Cleanup button
  const aiCleanupBtn = container.querySelector('#ai-cleanup-btn');
  const aiCleanupPreview = container.querySelector('#ai-cleanup-preview');

  if (aiCleanupBtn && aiCleanupPreview) {
    aiCleanupBtn.addEventListener('click', async () => {
      if (!dish) return;

      aiCleanupBtn.disabled = true;
      aiCleanupBtn.textContent = 'Thinking...';
      aiCleanupPreview.style.display = 'block';
      aiCleanupPreview.innerHTML = '<div class="cb-processing"><div class="cb-preview-spinner"></div><span>Cleaning up directions...</span></div>';

      try {
        const result = await aiCleanupRecipe(dish.id);

        const beforeHtml = result.before.map(line => `<div class="ai-diff-line">${escapeHtml(line)}</div>`).join('');
        const afterHtml = result.after.map(line => `<div class="ai-diff-line">${escapeHtml(line)}</div>`).join('');

        aiCleanupPreview.innerHTML = `
          <div class="ai-diff-container">
            <div class="ai-diff-panel">
              <div class="ai-diff-header">Before</div>
              <div class="ai-diff-body">${beforeHtml}</div>
            </div>
            <div class="ai-diff-panel ai-diff-after">
              <div class="ai-diff-header">After</div>
              <div class="ai-diff-body">${afterHtml}</div>
            </div>
          </div>
          <div class="ai-diff-actions">
            <button class="btn btn-primary btn-sm" id="ai-cleanup-confirm">Apply Changes</button>
            <button class="btn btn-secondary btn-sm" id="ai-cleanup-cancel">Cancel</button>
          </div>
        `;

        container.querySelector('#ai-cleanup-confirm').addEventListener('click', async () => {
          try {
            const confirmResult = await aiConfirm(result.confirmationId);
            if (confirmResult.success) {
              showToast('Directions cleaned up', 'success', 15000, confirmResult.undoId ? {
                label: 'Undo',
                onClick: async () => {
                  try {
                    await aiUndo(confirmResult.undoId);
                    showToast('Directions restored', 'success');
                    const { renderDishForm } = await import('./dishForm.js');
                    renderDishForm(container.parentElement || container, dish.id);
                  } catch (err) {
                    showToast('Undo failed: ' + err.message, 'error');
                  }
                },
              } : undefined);

              const { renderDishForm } = await import('./dishForm.js');
              renderDishForm(container.parentElement || container, dish.id);
            } else {
              showToast(confirmResult.response || 'Failed to apply', 'error');
            }
          } catch (err) {
            showToast(err.message || 'Failed to apply changes', 'error');
          }
        });

        container.querySelector('#ai-cleanup-cancel').addEventListener('click', () => {
          aiCleanupPreview.style.display = 'none';
          aiCleanupPreview.innerHTML = '';
        });

      } catch (err) {
        aiCleanupPreview.innerHTML = `<div class="ai-cleanup-error">${escapeHtml(err.message || 'Cleanup failed')}</div>`;
      } finally {
        aiCleanupBtn.disabled = false;
        aiCleanupBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></svg> Clean up with AI`;
      }
    });
  }

  setupDirectionDragDrop(directionsList);

  // Service Directions
  container.querySelector('#add-svc-direction-step').addEventListener('click', () => {
    counters.svcDirStep++;
    const div = document.createElement('div');
    div.innerHTML = serviceDirectionStepRow(null, counters.svcDirStep);
    svcDirectionsList.appendChild(div.firstElementChild);
    const rows = svcDirectionsList.querySelectorAll('.svc-dir-step-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.svc-dir-text').focus();
    updateSubtitles();
  });

  container.querySelector('#add-svc-direction-section').addEventListener('click', () => {
    counters.svcDirStep++;
    const div = document.createElement('div');
    div.innerHTML = serviceDirectionSectionRow(null, counters.svcDirStep);
    svcDirectionsList.appendChild(div.firstElementChild);
    const rows = svcDirectionsList.querySelectorAll('.svc-dir-section-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('.svc-dir-section-label').focus();
  });

  svcDirectionsList.addEventListener('click', (e) => {
    if (e.target.closest('.remove-svc-dir-step')) {
      e.target.closest('.svc-dir-step-row').remove();
      updateSubtitles();
      return;
    }
    if (e.target.closest('.remove-svc-dir-section')) {
      e.target.closest('.svc-dir-section-row').remove();
    }
  });

  setupServiceDirectionDragDrop(svcDirectionsList);
}

/** Collect all form data from the DOM and return a data object ready for API */
function collectFormData(ctx) {
  const { container, dish } = ctx;
  const ingredientsList = container.querySelector('#ingredients-list');
  const subsList = container.querySelector('#substitutions-list');
  const manualCostsList = container.querySelector('#manual-costs-list');
  const componentsList = container.querySelector('#components-list');
  const directionsList = container.querySelector('#directions-list');
  const svcDirectionsList = container.querySelector('#service-directions-list');

  const allRows = ingredientsList.querySelectorAll('.ingredient-row, .section-header-row');
  const ingData = Array.from(allRows).map((row, idx) => {
    if (row.classList.contains('section-header-row')) {
      const label = row.querySelector('.section-header-label').value.trim();
      return label ? { section_header: label, sort_order: idx } : null;
    } else {
      const nameVal = row.querySelector('.ing-name').value.trim();
      if (!nameVal) return null;
      return {
        name: nameVal,
        quantity: parseFloat(row.querySelector('.ing-qty').value) || 0,
        unit: row.querySelector('.ing-unit').value,
        prep_note: row.querySelector('.ing-prep').value.trim(),
        unit_cost: row.querySelector('.ing-unit-cost').value !== '' ? parseFloat(row.querySelector('.ing-unit-cost').value) : null,
        base_unit: row.querySelector('.ing-base-unit').value,
        sort_order: idx,
      };
    }
  }).filter(Boolean);

  const tagsInput = container.querySelector('#dish-tags').value;
  const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);

  const subRows = subsList.querySelectorAll('.substitution-row');
  const substitutions = Array.from(subRows).map(row => ({
    allergen: row.querySelector('.sub-allergen').value,
    original_ingredient: row.querySelector('.sub-original').value.trim(),
    substitute_ingredient: row.querySelector('.sub-substitute').value.trim(),
    notes: row.querySelector('.sub-notes')?.value.trim() || '',
  })).filter(s => s.allergen && s.original_ingredient && s.substitute_ingredient);

  const costRows = manualCostsList.querySelectorAll('.manual-cost-row');
  const manual_costs = Array.from(costRows).map(row => ({
    label: row.querySelector('.manual-cost-label').value.trim(),
    amount: parseFloat(row.querySelector('.manual-cost-amount').value) || 0,
  })).filter(item => item.label || item.amount > 0);

  const compRows = componentsList.querySelectorAll('.component-row');
  const components = Array.from(compRows).map((row, idx) => ({
    name: row.querySelector('.comp-name').value.trim(),
    sort_order: idx,
  })).filter(c => c.name);

  const dirRows = directionsList.querySelectorAll('.dir-step-row, .dir-section-row');
  const directions = Array.from(dirRows).map((row, idx) => {
    if (row.classList.contains('dir-section-row')) {
      const label = row.querySelector('.dir-section-label').value.trim();
      return label ? { type: 'section', text: label, sort_order: idx } : null;
    } else {
      const text = row.querySelector('.dir-text').value.trim();
      return text ? { type: 'step', text, sort_order: idx } : null;
    }
  }).filter(Boolean);

  const svcDirRows = svcDirectionsList.querySelectorAll('.svc-dir-step-row, .svc-dir-section-row');
  const service_directions = Array.from(svcDirRows).map((row, idx) => {
    if (row.classList.contains('svc-dir-section-row')) {
      const label = row.querySelector('.svc-dir-section-label').value.trim();
      return label ? { type: 'section', text: label, sort_order: idx } : null;
    } else {
      const text = row.querySelector('.svc-dir-text').value.trim();
      return text ? { type: 'step', text, sort_order: idx } : null;
    }
  }).filter(Boolean);

  const hasDirections = directions.some(d => d.type === 'step');
  const name = container.querySelector('#dish-name').value.trim();

  return {
    name,
    description: container.querySelector('#dish-desc').value.trim(),
    category: container.querySelector('#dish-category').value,
    chefs_notes: hasDirections ? '' : (dish ? dish.chefs_notes || '' : ''),
    service_notes: container.querySelector('#dish-service-notes').value.trim(),
    suggested_price: parseFloat(container.querySelector('#dish-price').value) || 0,
    batch_yield: parseFloat(container.querySelector('#dish-batch-yield').value) || 1,
    ingredients: ingData,
    tags,
    substitutions,
    manual_costs,
    components,
    directions,
    service_directions,
  };
}

/** Wire up the form submit handler */
function setupFormSubmit(ctx) {
  const { container, form, isEdit, dishId, photoInput, manualAllergens } = ctx;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = container.querySelector('#dish-name').value.trim();
    if (!name) {
      showToast('Dish name is required', 'error');
      return;
    }

    const submitBtns = container.querySelectorAll('button[type="submit"], #header-save-btn');
    submitBtns.forEach(b => { b.disabled = true; b.dataset.origText = b.textContent; b.textContent = 'Saving\u2026'; });

    const data = collectFormData(ctx);

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
        for (const allergen of manualAllergens) {
          try {
            await updateDishAllergen(result.id, { allergen, action: 'add' });
          } catch {}
        }
        showToast('Dish created');
      }
      const savedBackTo = sessionStorage.getItem('dishNav_backTo');
      if (savedBackTo) {
        sessionStorage.removeItem('dishNav_backTo');
        window.location.hash = savedBackTo;
      } else {
        window.location.hash = '#/dishes';
      }
    } catch (err) {
      submitBtns.forEach(b => { b.disabled = false; b.textContent = b.dataset.origText || (isEdit ? 'Save Changes' : 'Create Dish'); });
      showToast(err.message, 'error');
    }
  });
}

/** Set up WebSocket sync listener for edit mode */
function setupSyncListener(isEdit, dishId) {
  if (!isEdit) return;

  const onUpdate = (e) => {
    if (e.detail && String(e.detail.id) === String(dishId)) {
      showToast('This dish was updated on another device', 'info', 5000, {
        label: 'Reload',
        onClick: () => { window.location.reload(); }
      });
    }
  };
  window.addEventListener('sync:dish_updated', onUpdate);
  const cleanup = () => {
    window.removeEventListener('sync:dish_updated', onUpdate);
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}

/** Set up collapsible sections */
function setupCollapsibles(ctx) {
  const { container, dish, isEdit } = ctx;

  makeCollapsible(container.querySelector('#section-photo'), { open: !!(dish && dish.photo_path) || !isEdit, storageKey: 'dish_sec_photo' });
  makeCollapsible(container.querySelector('#section-ingredients'), { open: true, storageKey: 'dish_sec_ingredients' });
  makeCollapsible(container.querySelector('#section-allergens'), { open: false, storageKey: 'dish_sec_allergens' });
  makeCollapsible(container.querySelector('#section-substitutions'), { open: false, storageKey: 'dish_sec_subs' });
  makeCollapsible(container.querySelector('#section-components'), { open: false, storageKey: 'dish_sec_components' });
  makeCollapsible(container.querySelector('#section-costing'), { open: false, storageKey: 'dish_sec_costing' });
  makeCollapsible(container.querySelector('#section-manual-costs'), { open: false, storageKey: 'dish_sec_manualcosts' });
  makeCollapsible(container.querySelector('#section-prep-directions'), { open: true, storageKey: 'dish_sec_prep_directions' });
  makeCollapsible(container.querySelector('#section-svc-directions'), { open: false, storageKey: 'dish_sec_svc_directions' });
  makeCollapsible(container.querySelector('#section-service-notes'), { open: false, storageKey: 'dish_sec_servicenotes' });
}

/** Set up overflow menu (duplicate button, edit mode only) */
function setupOverflowMenu(ctx) {
  const { container, dishId } = ctx;

  const overflowSlot = container.querySelector('#dish-overflow-menu');
  if (overflowSlot) {
    const menuBtn = createActionMenu([
      { label: 'Duplicate', icon: '\u29C9', onClick: async () => {
        try {
          const result = await duplicateDish(dishId);
          showToast('Dish duplicated');
          window.location.hash = `#/dishes/${result.id}/edit`;
        } catch (err) {
          showToast(err.message, 'error');
        }
      }},
    ]);
    overflowSlot.appendChild(menuBtn);
  }
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
    container.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
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
  // dish.ingredients now contains merged rows: { row_type: 'ingredient'|'section', ... }
  let ingredients;
  if (dish) {
    ingredients = dish.ingredients; // already has row_type from API
  } else if (importedData && importedData.ingredients) {
    ingredients = importedData.ingredients.map(ing => {
      if (ing.section_header) {
        return { row_type: 'section', label: ing.section_header };
      }
      return {
        row_type: 'ingredient',
        ingredient_name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        prep_note: ing.prep_note || '',
      };
    });
  } else {
    ingredients = [];
  }

  // Tags
  const existingTags = dish ? (dish.tags || []) : [];
  // Substitutions
  const existingSubs = dish ? (dish.substitutions || []) : [];
  // Service Components (never populated from URL import)
  const existingComponents = dish ? (dish.components || []) : [];
  // Service Directions (plating/assembly steps)
  const existingServiceDirections = dish ? (dish.service_directions || []) : [];

  // Directions (structured steps)
  let existingDirections;
  if (dish && dish.directions && dish.directions.length) {
    existingDirections = dish.directions;
  } else if (importedData && importedData.directions && importedData.directions.length) {
    existingDirections = importedData.directions;
  } else if (importedData && importedData.instructions) {
    // Parse legacy free-text instructions into direction steps
    existingDirections = importedData.instructions
      .split(/\n+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        if (/^[^a-z]*:$/.test(line) || (line.endsWith(':') && !/^\d/.test(line))) {
          return { type: 'section', text: line.replace(/:$/, '').trim() };
        }
        return { type: 'step', text: line };
      });
  } else {
    existingDirections = [];
  }

  const backTo = sessionStorage.getItem('dishNav_backTo') || '#/dishes';

  // Compute subtitle values for collapsible sections
  const ingredientCount = ingredients.filter(r => r.row_type === 'ingredient').length;
  const ingredientSubtitle = ingredientCount ? `${ingredientCount} ingredient${ingredientCount !== 1 ? 's' : ''}` : '';
  const prepStepCount = existingDirections.filter(d => d.type === 'step').length;
  const prepSubtitle = prepStepCount ? `${prepStepCount} step${prepStepCount !== 1 ? 's' : ''}` : '';
  const svcStepCount = existingServiceDirections.filter(d => d.type === 'step').length;
  const svcSubtitle = svcStepCount ? `${svcStepCount} step${svcStepCount !== 1 ? 's' : ''}` : '';
  const costSubtitle = dish && dish.cost && dish.cost.cost_per_portion
    ? `$${dish.cost.cost_per_portion.toFixed(2)}/portion` +
      (dish.suggested_price ? ` (${((dish.cost.cost_per_portion / dish.suggested_price) * 100).toFixed(0)}%)` : '')
    : '';
  const photoSubtitle = dish && dish.photo_path ? 'Uploaded' : '';

  container.innerHTML = `
    <div class="page-header">
      <a href="${backTo}" class="btn btn-back">&larr; Back</a>
      <h1>${isEdit ? 'Edit Dish' : 'New Dish'}</h1>
      <div class="header-actions">
        ${isEdit ? '<button type="button" id="header-save-btn" class="btn btn-primary">Save Changes</button>' : ''}
        ${isEdit ? '<span id="dish-overflow-menu"></span>' : ''}
      </div>
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
            <div class="form-group">
              <label for="dish-batch-yield">Batch Yield</label>
              <input type="number" id="dish-batch-yield" class="input" step="0.5" min="0.5" value="${dish ? (dish.batch_yield || 1) : 1}" placeholder="1">
              <span class="text-muted" style="font-size:0.78rem;">Portions per batch</span>
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

          <!-- Photo Upload (collapsible) -->
          <div class="collapsible-section" id="section-photo">
            ${collapsibleHeader('Photo', photoSubtitle)}
            <div class="collapsible-section__body">
              <div class="photo-upload" id="photo-upload-area">
                ${dish && dish.photo_path
                  ? `<div class="photo-preview-wrap" id="photo-preview-wrap">
                      <img src="${escapeHtml(dish.photo_path)}" alt="Dish photo" class="photo-preview" id="photo-preview">
                      <button type="button" class="photo-delete-btn" id="photo-delete-btn" title="Remove photo">&times;</button>
                    </div>`
                  : '<div class="photo-placeholder" id="photo-preview"><span>Tap to upload photo</span></div>'
                }
                <input type="file" id="photo-input" accept="image/*" hidden>
              </div>
            </div>
          </div>

          <!-- Ingredients (collapsible) -->
          <div class="collapsible-section" id="section-ingredients">
            ${collapsibleHeader('Ingredients', ingredientSubtitle)}
            <div class="collapsible-section__body">
              <div id="ingredients-list">
                ${ingredients.map((ing, i) =>
                  ing.row_type === 'section'
                    ? sectionHeaderRow(ing, i)
                    : ingredientRow(ing, i)
                ).join('')}
              </div>
              <div class="ing-add-buttons">
                <button type="button" id="add-ingredient" class="btn btn-secondary">+ Add Ingredient</button>
                <button type="button" id="add-section-header" class="btn btn-secondary">+ Add Section</button>
              </div>
            </div>
          </div>

          <!-- Allergens & Safety group -->
          <div class="df-section-group">
            <span class="df-section-group__label">Allergens & Safety</span>

            <!-- Allergens (collapsible) -->
            <div class="collapsible-section" id="section-allergens">
              ${collapsibleHeader('Allergens', dish && dish.allergens && dish.allergens.length ? `${dish.allergens.length} detected` : '')}
              <div class="collapsible-section__body">
                <div style="margin-bottom:8px;">
                  <span class="text-muted" style="font-size:0.83rem;">From ingredients:</span>
                  <div id="allergen-preview" style="margin-top:4px;min-height:24px;">
                    ${dish ? renderAllergenBadgesWithSource(dish.allergens.filter(a => a.ingredient_name)) : '<span class="text-muted">Add ingredients to detect allergens</span>'}
                  </div>
                </div>
                <div>
                  <span class="text-muted" style="font-size:0.83rem;">Dish-level manual tags — click to toggle:</span>
                  <div class="allergen-toggle-grid" id="allergen-manual-toggles" style="margin-top:6px;">
                    ${ALLERGEN_LIST.map(a => {
                      const isManual = dish && dish.allergens.some(al => al.allergen === a && al.source === 'manual' && !al.ingredient_name);
                      return `<button type="button" class="allergen-toggle ${isManual ? 'active' : ''}" data-allergen="${a}">${capitalize(a)}</button>`;
                    }).join('')}
                  </div>
                </div>
              </div>
            </div>

            <!-- Allergen Substitutions (collapsible) -->
            <div class="collapsible-section" id="section-substitutions">
              ${collapsibleHeader('Allergen Substitutions', existingSubs.length ? `${existingSubs.length} swap${existingSubs.length > 1 ? 's' : ''}` : '')}
              <div class="collapsible-section__body">
                <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Add ingredient swaps for allergen-free versions (e.g., wheat flour &rarr; rice flour for gluten-free)</p>
                <div id="substitutions-list">
                  ${existingSubs.map((sub, i) => substitutionRow(sub, i)).join('')}
                </div>
                <button type="button" id="add-substitution" class="btn btn-secondary">+ Add Substitution</button>
              </div>
            </div>

            <!-- Service Components (collapsible) -->
            <div class="collapsible-section" id="section-components">
              ${collapsibleHeader('Service Components', existingComponents.length ? `${existingComponents.length} item${existingComponents.length > 1 ? 's' : ''}` : '')}
              <div class="collapsible-section__body">
                <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Pre-prepped items on the plate at service (e.g. duck liver parfait, brioche croutons, truffle gel). These appear on the service sheet instead of raw ingredients.</p>
                <div id="components-list">
                  ${existingComponents.map((comp, i) => componentRow(comp, i)).join('')}
                </div>
                <button type="button" id="add-component" class="btn btn-secondary">+ Add Component</button>
              </div>
            </div>
          </div>

          <!-- Cost Breakdown (collapsible) -->
          <div class="collapsible-section" id="section-costing">
            ${collapsibleHeader('Cost Breakdown', costSubtitle)}
            <div class="collapsible-section__body">
              <div id="cost-breakdown">
                ${dish && dish.cost ? renderCostBreakdown(dish) : '<span class="text-muted">Add ingredients with costs to see breakdown</span>'}
              </div>
              <div class="collapsible-section" id="section-manual-costs" style="margin-top:14px;">
                ${collapsibleHeader('Additional Cost Items', (dish && dish.manual_costs && dish.manual_costs.length) ? `${dish.manual_costs.length} item${dish.manual_costs.length > 1 ? 's' : ''}` : '')}
                <div class="collapsible-section__body">
                  <p class="text-muted" style="font-size:0.83rem;margin-bottom:8px;">Add labor, packaging, or overhead costs not tied to ingredients.</p>
                  <div id="manual-costs-list">
                    ${(dish && dish.manual_costs || []).map((item, i) => manualCostRow(item, i)).join('')}
                  </div>
                  <button type="button" id="add-manual-cost" class="btn btn-secondary">+ Add Cost Item</button>
                </div>
              </div>
            </div>
          </div>

          <!-- Prep Directions (collapsible) -->
          <div class="collapsible-section" id="section-prep-directions">
            ${collapsibleHeader('Prep Directions', prepSubtitle)}
            <div class="collapsible-section__body">
              <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Step-by-step prep method — drag to reorder, add section headers to group steps.</p>
              ${dish && dish.chefs_notes && !existingDirections.length ? `
                <div class="dir-legacy-notes">
                  <span class="dir-legacy-label">Legacy Chef's Notes</span>
                  <p class="dir-legacy-text">${escapeHtml(dish.chefs_notes).replace(/\n/g, '<br>')}</p>
                  <p class="text-muted" style="font-size:0.8rem;margin-top:6px;">Add direction steps below to replace this text. The text above will stay until you save with steps.</p>
                </div>
              ` : ''}
              <div id="directions-list">
                ${existingDirections.map((d, i) =>
                  d.type === 'section'
                    ? directionSectionRow(d, i)
                    : directionStepRow(d, i)
                ).join('')}
              </div>
              <div class="ing-add-buttons">
                <button type="button" id="add-direction-step" class="btn btn-secondary">+ Add Step</button>
                <button type="button" id="add-direction-section" class="btn btn-secondary">+ Add Section</button>
                ${dish ? `<button type="button" id="ai-cleanup-btn" class="btn btn-ghost btn-sm ai-cleanup-btn" title="Clean up directions with AI">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></svg>
                  Clean up with AI
                </button>` : ''}
              </div>
              <div id="ai-cleanup-preview" class="ai-cleanup-preview" style="display:none;"></div>
            </div>
          </div>

          <!-- Service Directions (collapsible) -->
          <div class="collapsible-section" id="section-svc-directions">
            ${collapsibleHeader('Service Directions', svcSubtitle)}
            <div class="collapsible-section__body">
              <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Step-by-step plating & assembly at service — drag to reorder, add section headers to group steps.</p>
              <div id="service-directions-list">
                ${existingServiceDirections.map((d, i) =>
                  d.type === 'section'
                    ? serviceDirectionSectionRow(d, i)
                    : serviceDirectionStepRow(d, i)
                ).join('')}
              </div>
              <div class="ing-add-buttons">
                <button type="button" id="add-svc-direction-step" class="btn btn-secondary">+ Add Step</button>
                <button type="button" id="add-svc-direction-section" class="btn btn-secondary">+ Add Section</button>
              </div>
            </div>
          </div>

          <!-- Service Notes (collapsible) -->
          <div class="collapsible-section" id="section-service-notes">
            ${collapsibleHeader('Service Notes', dish && dish.service_notes ? 'Has notes' : '')}
            <div class="collapsible-section__body">
              <p class="text-muted" style="font-size:0.85rem;margin-bottom:8px;">Front-of-house guidance, plating reminders, allergy alerts — shown on the service sheet.</p>
              <textarea id="dish-service-notes" class="input" rows="3" placeholder="e.g., Serve immediately. Warn staff re: nut allergy. Garnish plate-side.">${dish ? escapeHtml(dish.service_notes || '') : ''}</textarea>
            </div>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-lg">${isEdit ? 'Save Changes' : 'Create Dish'}</button>
        <a href="#/dishes" class="btn btn-lg">Cancel</a>
      </div>
    </form>
  `;

  // Wire up interactions — build context object and delegate to extracted helpers
  const form = container.querySelector('#dish-form');
  const ingredientsList = container.querySelector('#ingredients-list');
  const photoArea = container.querySelector('#photo-upload-area');
  const photoInput = container.querySelector('#photo-input');
  const allergenPreview = container.querySelector('#allergen-preview');
  const subsList = container.querySelector('#substitutions-list');
  const manualAllergens = new Set();

  const ctx = {
    container, form, isEdit, dishId, dish, allergenKeywords,
    ingredientsList, photoArea, photoInput, allergenPreview,
    subsList, manualAllergens,
    counters: {
      ingredient: ingredients.length,
      section: 0,
      sub: existingSubs.length,
      manualCost: (dish && dish.manual_costs ? dish.manual_costs.length : 0),
      component: existingComponents.length,
      dirStep: existingDirections.length,
      svcDirStep: existingServiceDirections.length,
    }
  };

  setupCollapsibles(ctx);
  setupOverflowMenu(ctx);

  // Header save button (edit mode only)
  const headerSaveBtn = container.querySelector('#header-save-btn');
  if (headerSaveBtn) {
    headerSaveBtn.addEventListener('click', () => form.requestSubmit());
  }

  // If imported data has ingredients, trigger allergen preview
  if (importedData && ingredients.length) {
    setTimeout(() => updateAllergenPreview(ingredientsList, allergenPreview, allergenKeywords), 0);
  }

  setupPhotoHandlers(ctx);
  setupIngredientHandlers(ctx);
  setupIngredientDragDrop(ingredientsList);
  setupSubstitutionAndAllergenHandlers(ctx);
  setupComponentHandlers(ctx);
  setupDirectionHandlers(ctx);
  setupFormSubmit(ctx);
  setupSyncListener(isEdit, dishId);
}


// ── Row templates ────────────────────────────────────────────────────────────

function sectionHeaderRow(header, index) {
  const label = header ? escapeHtml(header.label || '') : '';
  return `
    <div class="section-header-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="section-header-input-wrap">
        <input type="text" class="input section-header-label" placeholder="Section name (e.g. For the marinade)" value="${label}">
      </div>
      <button type="button" class="btn btn-icon remove-section-header" title="Remove section">&times;</button>
    </div>
  `;
}

function ingredientRow(ing, index) {
  const currentUnit = ing?.unit || 'g';
  const compat = compatibleUnits(currentUnit);
  const canConvert = compat.length > 0;
  return `
    <div class="ingredient-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
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
      <div class="ing-cost-row">
        <span class="ing-cost-label">Unit cost: $</span>
        <input type="number" class="input ing-unit-cost" placeholder="0.00" step="0.001" min="0"
               value="${ing && ing.unit_cost ? ing.unit_cost : ''}">
        <span class="ing-cost-label">per</span>
        <select class="input ing-base-unit">
          ${UNITS.map(u => `<option value="${u.value}" ${(ing && ing.base_unit ? ing.base_unit : currentUnit) === u.value ? 'selected' : ''}>${u.label}</option>`).join('')}
        </select>
        <span class="ing-cost-hint">${ing && ing.unit_cost ? `$${ing.unit_cost}/${ing.base_unit}` : 'No cost set'}</span>
      </div>
      <div class="ing-converter" style="display:none;"></div>
    </div>
  `;
}

function componentRow(comp, index) {
  const name = comp ? escapeHtml(comp.name || '') : '';
  return `
    <div class="component-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">&#11835;</span>
      <input type="text" class="input comp-name" placeholder="e.g. brioche croutons" value="${name}">
      <button type="button" class="btn btn-icon remove-component" title="Remove">&times;</button>
    </div>
  `;
}

function manualCostRow(item, index) {
  return `
    <div class="manual-cost-row" data-index="${index}">
      <input type="text" class="input manual-cost-label" placeholder="Label (e.g., Labor)" value="${escapeHtml(item ? item.label : '')}">
      <span class="manual-cost-currency">$</span>
      <input type="number" class="input manual-cost-amount" placeholder="0.00" step="0.01" min="0" value="${item ? item.amount : ''}">
      <button type="button" class="btn btn-icon remove-manual-cost" title="Remove">&times;</button>
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

  const ingredientTotal = dish.cost.totalCost;
  const combinedTotal = dish.cost.combinedTotal !== undefined ? dish.cost.combinedTotal : ingredientTotal;
  const hasManualCosts = combinedTotal > ingredientTotal;
  const batchYield = dish.cost.batchYield || 1;
  const costPerPortion = dish.cost.costPerPortion !== undefined ? dish.cost.costPerPortion : combinedTotal;

  html += `<div class="cost-row cost-total">
    <span>${hasManualCosts ? 'Ingredient Cost' : (batchYield > 1 ? 'Total Batch Cost' : 'Total Dish Cost')}</span>
    <span></span>
    <span>$${ingredientTotal.toFixed(2)}</span>
  </div>`;

  if (hasManualCosts) {
    html += `<div class="cost-row cost-total">
      <span>${batchYield > 1 ? 'Batch Total (incl. additional costs)' : 'Total (incl. additional costs)'}</span>
      <span></span>
      <span>$${combinedTotal.toFixed(2)}</span>
    </div>`;
  }

  if (batchYield > 1) {
    html += `<div class="cost-row">
      <span>Batch Yield</span>
      <span></span>
      <span>${batchYield} portions</span>
    </div>`;
    html += `<div class="cost-row cost-total">
      <span>Cost per Portion</span>
      <span></span>
      <span>$${costPerPortion.toFixed(2)}</span>
    </div>`;
  }

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

// ── Drag-and-drop for ingredient + section rows ───────────────────────────────

function setupIngredientDragDrop(list) {
  let dragSrc = null;

  // ── HTML5 Drag API ──
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.ingredient-row, .section-header-row');
    if (!row) return;
    dragSrc = row;
    // Delay adding class so the drag ghost captures the un-dimmed look
    setTimeout(() => row.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', ''); // required for Firefox
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.ingredient-row, .section-header-row');
    if (!target || target === dragSrc) return;

    list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });

    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      target.classList.add('drop-above');
    } else {
      target.classList.add('drop-below');
    }
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('dragleave', (e) => {
    // Only clear when leaving the list entirely
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
        el.classList.remove('drop-above', 'drop-below');
      });
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.ingredient-row, .section-header-row');

    list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });

    if (!target || !dragSrc || target === dragSrc) return;

    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragSrc, target);
    } else {
      target.after(dragSrc);
    }
  });

  list.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });
    dragSrc = null;
  });

  // ── Touch drag (handle only) ──
  let touchRow = null;

  list.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    const row = handle.closest('.ingredient-row, .section-header-row');
    if (!row) return;
    touchRow = row;
    row.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });

  list.addEventListener('touchmove', (e) => {
    if (!touchRow) return;
    e.preventDefault();

    const touchY = e.touches[0].clientY;
    const siblings = [...list.querySelectorAll('.ingredient-row, .section-header-row')]
      .filter(r => r !== touchRow);

    list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });

    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        if (touchY < rect.top + rect.height / 2) {
          row.classList.add('drop-above');
        } else {
          row.classList.add('drop-below');
        }
        break;
      }
    }
  }, { passive: false });

  list.addEventListener('touchend', (e) => {
    if (!touchRow) return;

    const touchY = e.changedTouches[0].clientY;
    const siblings = [...list.querySelectorAll('.ingredient-row, .section-header-row')]
      .filter(r => r !== touchRow);

    list.querySelectorAll('.drop-above, .drop-below').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });

    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        if (touchY < rect.top + rect.height / 2) {
          list.insertBefore(touchRow, row);
        } else {
          row.after(touchRow);
        }
        break;
      }
    }

    touchRow.classList.remove('dragging');
    touchRow = null;
  });
}

// ── Drag-and-drop for service component rows ──────────────────────────────────

function setupComponentDragDrop(list) {
  let dragSrc = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.component-row');
    if (!row) return;
    dragSrc = row;
    setTimeout(() => row.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.component-row');
    if (!target || target === dragSrc) return;
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    const rect = target.getBoundingClientRect();
    target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('.component-row');
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    if (!target || !dragSrc || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragSrc, target);
    } else {
      target.after(dragSrc);
    }
  });

  list.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    dragSrc = null;
  });

  // Touch support
  let touchRow = null;
  list.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    touchRow = handle.closest('.component-row');
    if (!touchRow) return;
    touchRow.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });

  list.addEventListener('touchmove', (e) => {
    if (!touchRow) return;
    e.preventDefault();
    const touchY = e.touches[0].clientY;
    const siblings = [...list.querySelectorAll('.component-row')].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        row.classList.add(touchY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
        break;
      }
    }
  }, { passive: false });

  list.addEventListener('touchend', (e) => {
    if (!touchRow) return;
    const touchY = e.changedTouches[0].clientY;
    const siblings = [...list.querySelectorAll('.component-row')].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        if (touchY < rect.top + rect.height / 2) list.insertBefore(touchRow, row);
        else row.after(touchRow);
        break;
      }
    }
    touchRow.classList.remove('dragging');
    touchRow = null;
  });
}

// ── Direction step / section row templates ──────────────────────────────────

function directionStepRow(d, index) {
  const text = d ? escapeHtml(d.text || '') : '';
  return `
    <div class="dir-step-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">&#11835;</span>
      <span class="dir-step-num"></span>
      <textarea class="input dir-text" rows="2" placeholder="Describe this step…">${text}</textarea>
      <button type="button" class="btn btn-icon remove-dir-step" title="Remove">&times;</button>
    </div>
  `;
}

function directionSectionRow(d, index) {
  const text = d ? escapeHtml(d.text || '') : '';
  return `
    <div class="dir-section-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">&#11835;</span>
      <div class="section-header-input-wrap">
        <input type="text" class="input dir-section-label" placeholder="Section name (e.g. For the sauce)" value="${text}">
      </div>
      <button type="button" class="btn btn-icon remove-dir-section" title="Remove section">&times;</button>
    </div>
  `;
}

// ── Drag-and-drop for direction rows ────────────────────────────────────────

function setupDirectionDragDrop(list) {
  const ROW_SEL = '.dir-step-row, .dir-section-row';
  let dragSrc = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest(ROW_SEL);
    if (!row) return;
    dragSrc = row;
    setTimeout(() => row.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest(ROW_SEL);
    if (!target || target === dragSrc) return;
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    const rect = target.getBoundingClientRect();
    target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest(ROW_SEL);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    if (!target || !dragSrc || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragSrc, target);
    } else {
      target.after(dragSrc);
    }
  });

  list.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    dragSrc = null;
  });

  // Touch support
  let touchRow = null;
  list.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    touchRow = handle.closest(ROW_SEL);
    if (!touchRow) return;
    touchRow.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });

  list.addEventListener('touchmove', (e) => {
    if (!touchRow) return;
    e.preventDefault();
    const touchY = e.touches[0].clientY;
    const siblings = [...list.querySelectorAll(ROW_SEL)].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        row.classList.add(touchY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
        break;
      }
    }
  }, { passive: false });

  list.addEventListener('touchend', (e) => {
    if (!touchRow) return;
    const touchY = e.changedTouches[0].clientY;
    const siblings = [...list.querySelectorAll(ROW_SEL)].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        if (touchY < rect.top + rect.height / 2) list.insertBefore(touchRow, row);
        else row.after(touchRow);
        break;
      }
    }
    touchRow.classList.remove('dragging');
    touchRow = null;
  });
}

// ── Service Direction step / section row templates ───────────────────────────

function serviceDirectionStepRow(d, index) {
  const text = d ? escapeHtml(d.text || '') : '';
  return `
    <div class="svc-dir-step-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">&#11835;</span>
      <span class="dir-step-num"></span>
      <textarea class="input svc-dir-text" rows="2" placeholder="Describe this service step…">${text}</textarea>
      <button type="button" class="btn btn-icon remove-svc-dir-step" title="Remove">&times;</button>
    </div>
  `;
}

function serviceDirectionSectionRow(d, index) {
  const text = d ? escapeHtml(d.text || '') : '';
  return `
    <div class="svc-dir-section-row" data-index="${index}" draggable="true">
      <span class="drag-handle" title="Drag to reorder">&#11835;</span>
      <div class="section-header-input-wrap">
        <input type="text" class="input svc-dir-section-label" placeholder="Section name (e.g. Plating)" value="${text}">
      </div>
      <button type="button" class="btn btn-icon remove-svc-dir-section" title="Remove section">&times;</button>
    </div>
  `;
}

// ── Drag-and-drop for service direction rows ─────────────────────────────────

function setupServiceDirectionDragDrop(list) {
  const ROW_SEL = '.svc-dir-step-row, .svc-dir-section-row';
  let dragSrc = null;

  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest(ROW_SEL);
    if (!row) return;
    dragSrc = row;
    setTimeout(() => row.classList.add('dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest(ROW_SEL);
    if (!target || target === dragSrc) return;
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    const rect = target.getBoundingClientRect();
    target.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    e.dataTransfer.dropEffect = 'move';
  });

  list.addEventListener('dragleave', (e) => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    }
  });

  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest(ROW_SEL);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    if (!target || !dragSrc || target === dragSrc) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      list.insertBefore(dragSrc, target);
    } else {
      target.after(dragSrc);
    }
  });

  list.addEventListener('dragend', () => {
    if (dragSrc) dragSrc.classList.remove('dragging');
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    dragSrc = null;
  });

  // Touch support
  let touchRow = null;
  list.addEventListener('touchstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    touchRow = handle.closest(ROW_SEL);
    if (!touchRow) return;
    touchRow.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });

  list.addEventListener('touchmove', (e) => {
    if (!touchRow) return;
    e.preventDefault();
    const touchY = e.touches[0].clientY;
    const siblings = [...list.querySelectorAll(ROW_SEL)].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        row.classList.add(touchY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
        break;
      }
    }
  }, { passive: false });

  list.addEventListener('touchend', (e) => {
    if (!touchRow) return;
    const touchY = e.changedTouches[0].clientY;
    const siblings = [...list.querySelectorAll(ROW_SEL)].filter(r => r !== touchRow);
    list.querySelectorAll('.drop-above, .drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
    for (const row of siblings) {
      const rect = row.getBoundingClientRect();
      if (touchY >= rect.top && touchY <= rect.bottom) {
        if (touchY < rect.top + rect.height / 2) list.insertBefore(touchRow, row);
        else row.after(touchRow);
        break;
      }
    }
    touchRow.classList.remove('dragging');
    touchRow = null;
  });
}
