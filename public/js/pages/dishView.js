import { getDish } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openLightbox } from '../components/lightbox.js';
import { createActionMenu } from '../components/actionMenu.js';
import { printSheet } from '../utils/printSheet.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { CATEGORIES } from '../data/categories.js';

export async function renderDishView(container, dishId) {
  container.innerHTML = '<div class="loading">Loading...</div>';

  let dish;
  try {
    dish = await getDish(dishId);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const categoryLabel = CATEGORIES.find(c => c.value === dish.category)?.label || dish.category;
  const allAllergens = dish.allergens || [];
  const tags = dish.tags || [];
  const subs = dish.substitutions || [];

  // Build ingredients HTML — handles both section headers and ingredient rows
  function renderIngredients() {
    if (!dish.ingredients || !dish.ingredients.length) {
      return '<p class="text-muted" style="margin:0;">No ingredients listed.</p>';
    }

    let html = '<div class="dv-ing-list">';
    for (const row of dish.ingredients) {
      if (row.row_type === 'section') {
        html += `<div class="dv-ing-section">${escapeHtml(row.label)}</div>`;
      } else {
        const qty = row.quantity ? `<span class="dv-ing-qty">${row.quantity} ${escapeHtml(row.unit)}</span>` : '';
        const prep = row.prep_note ? `<span class="dv-ing-prep">${escapeHtml(row.prep_note)}</span>` : '';
        html += `
          <div class="dv-ing-row">
            <span class="dv-ing-name">${escapeHtml(row.ingredient_name)}</span>
            <span class="dv-ing-right">${qty}${prep}</span>
          </div>`;
      }
    }
    html += '</div>';
    return html;
  }

  // Cost summary — just totals, not full table
  function renderCostSummary() {
    if (!dish.cost || !dish.cost.totalCost) return '';
    const combined = dish.cost.combinedTotal ?? dish.cost.totalCost;
    const costPerPortion = dish.cost.costPerPortion ?? combined;
    const batchYield = dish.cost.batchYield || 1;
    const pct = dish.food_cost_percent;
    const pctColor = pct === null ? '' : pct > 35 ? 'var(--danger)' : pct > 30 ? 'var(--warning)' : 'var(--success)';

    let html = '';
    if (batchYield > 1) {
      html += `<div class="dv-cost-row">
        <span>Batch cost (${batchYield} portions)</span>
        <span>$${combined.toFixed(2)}</span>
      </div>`;
    }
    html += `<div class="dv-cost-row">
      <span>${batchYield > 1 ? 'Cost per portion' : 'Food cost'}</span>
      <span>$${costPerPortion.toFixed(2)}${pct !== null ? ` <span style="color:${pctColor};font-weight:700;">(${pct}%)</span>` : ''}</span>
    </div>`;
    if (dish.suggested_price) {
      html += `<div class="dv-cost-row"><span>Selling price</span><span>$${Number(dish.suggested_price).toFixed(2)}</span></div>`;
    }
    return html;
  }

  container.innerHTML = `
    <div class="page-header">
      <a href="#/dishes" class="btn btn-back">&larr; Back</a>
      <h1 class="dv-title">${escapeHtml(dish.name)}</h1>
      <div class="header-actions">
        <a href="#/dishes/${dish.id}/edit" class="btn btn-primary">Edit</a>
        <span id="dv-overflow-slot"></span>
      </div>
    </div>

    <div class="dv-layout">

      <!-- Left / main column -->
      <div class="dv-main">

        ${dish.photo_path ? `
          <div class="dv-photo" id="dv-photo">
            <img src="${escapeHtml(dish.photo_path)}" alt="${escapeHtml(dish.name)}">
          </div>
        ` : ''}

        <!-- Meta chips -->
        <div class="dv-meta">
          <span class="dv-chip dv-chip-category">${escapeHtml(categoryLabel)}</span>
          ${dish.suggested_price ? `<span class="dv-chip dv-chip-price">$${Number(dish.suggested_price).toFixed(2)}</span>` : ''}
          ${dish.batch_yield && dish.batch_yield > 1 ? `<span class="dv-chip">Makes ${dish.batch_yield} portions</span>` : ''}
          ${tags.map(t => `<span class="dv-chip dv-chip-tag">${escapeHtml(t)}</span>`).join('')}
        </div>

        ${allAllergens.length ? `
          <div class="dv-section-block">
            ${renderAllergenBadges(allAllergens)}
          </div>
        ` : ''}

        ${dish.description ? `
          <div class="dv-section-block dv-description">
            <p>${escapeHtml(dish.description)}</p>
          </div>
        ` : ''}

        <!-- Ingredients -->
        <div class="dv-card">
          <h3 class="dv-card-title">Ingredients</h3>
          ${renderIngredients()}
        </div>

        ${dish.components && dish.components.length ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Service Components</h3>
            <ul class="dv-comp-list">
              ${dish.components.map(c => `<li class="dv-comp-item">${escapeHtml(c.name)}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${dish.directions && dish.directions.length ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Prep Directions</h3>
            <div class="dv-directions">
              ${(() => {
                let stepNum = 0;
                return dish.directions.map(d => {
                  if (d.type === 'section') {
                    return `<div class="dv-dir-section">${escapeHtml(d.text)}</div>`;
                  }
                  stepNum++;
                  return `<div class="dv-dir-step"><span class="dv-dir-num">${stepNum}</span><span class="dv-dir-text">${escapeHtml(d.text)}</span></div>`;
                }).join('');
              })()}
            </div>
          </div>
        ` : dish.chefs_notes ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Chef's Notes</h3>
            <p class="dv-notes">${escapeHtml(dish.chefs_notes).replace(/\n/g, '<br>')}</p>
          </div>
        ` : ''}

        ${dish.service_directions && dish.service_directions.length ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Service Directions</h3>
            <div class="dv-directions">
              ${(() => {
                let stepNum = 0;
                return dish.service_directions.map(d => {
                  if (d.type === 'section') {
                    return `<div class="dv-dir-section">${escapeHtml(d.text)}</div>`;
                  }
                  stepNum++;
                  return `<div class="dv-dir-step"><span class="dv-dir-num">${stepNum}</span><span class="dv-dir-text">${escapeHtml(d.text)}</span></div>`;
                }).join('');
              })()}
            </div>
          </div>
        ` : ''}

        ${dish.service_notes ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Service Notes</h3>
            <p class="dv-notes">${escapeHtml(dish.service_notes).replace(/\n/g, '<br>')}</p>
          </div>
        ` : ''}

      </div>

      <!-- Right / sidebar column -->
      <div class="dv-sidebar">

        ${(dish.cost && (dish.cost.totalCost || dish.suggested_price)) ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Costing</h3>
            ${renderCostSummary()}
          </div>
        ` : ''}

        ${subs.length ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Allergen Substitutions</h3>
            <div class="dv-subs-list">
              ${subs.map(s => `
                <div class="dv-sub-row">
                  <span class="dv-sub-allergen">${escapeHtml(s.allergen)}</span>
                  <span class="dv-sub-swap">${escapeHtml(s.original_ingredient)} &rarr; ${escapeHtml(s.substitute_ingredient)}</span>
                  ${s.notes ? `<span class="dv-sub-notes">${escapeHtml(s.notes)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

      </div>
    </div>
  `;

  // Photo lightbox
  const photoEl = container.querySelector('#dv-photo img');
  if (photoEl) {
    photoEl.style.cursor = 'zoom-in';
    photoEl.addEventListener('click', () => openLightbox(photoEl.src, dish.name));
  }

  // Overflow action menu
  const overflowSlot = container.querySelector('#dv-overflow-slot');
  if (overflowSlot) {
    const menuTrigger = createActionMenu([
      { label: 'Print Kitchen Sheet', onClick: () => printDishSheet(dish) },
      { label: 'Print Service Card', onClick: () => printServiceCard(dish) },
    ]);
    overflowSlot.appendChild(menuTrigger);
  }

  // Sync listener — nudge if updated elsewhere
  const onUpdate = (e) => {
    if (e.detail && e.detail.id == dishId) {
      showToast('Dish updated on another device', 'info', 5000, {
        label: 'Reload',
        onClick: () => window.location.reload(),
      });
    }
  };
  window.addEventListener('sync:dish_updated', onUpdate);
  window.addEventListener('hashchange', () => {
    window.removeEventListener('sync:dish_updated', onUpdate);
  }, { once: true });
}

function printDishSheet(dish) {
  const allergens = dish.allergens || [];
  const ingredients = (dish.ingredients || []).filter(r => r.row_type !== 'section');
  const sections = dish.ingredients || [];
  const subs = dish.substitutions || [];
  const components = dish.components || [];
  const directions = dish.directions || [];
  const categoryLabel = CATEGORIES.find(c => c.value === dish.category)?.label || dish.category || '';

  let html = `
    <html><head><title>Kitchen Sheet - ${escapeHtml(dish.name)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; color: #1a1a1a; }
      h1 { font-size: 1.5rem; margin: 0 0 4px; }
      .meta { font-size: 0.85rem; color: #555; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #1a1a1a; }
      .meta span { margin-right: 12px; }
      .allergens { margin-bottom: 12px; }
      .allergen-tag { display: inline-block; padding: 2px 8px; font-size: 0.72rem; font-weight: 700; background: #ffcdd2; color: #b71c1c; border-radius: 10px; margin-right: 3px; margin-bottom: 3px; }
      .section-title { font-size: 0.95rem; font-weight: 700; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #ddd; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 0.88rem; }
      th { text-align: left; padding: 4px 8px; background: #f0f0ec; border-bottom: 2px solid #ccc; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
      td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      .components { margin-bottom: 16px; }
      .components ul { padding-left: 0; list-style: none; margin: 0; }
      .components li { padding: 3px 0; font-size: 0.9rem; font-weight: 600; border-bottom: 1px solid #f0f0f0; }
      .dir-step { display: flex; gap: 8px; margin-bottom: 6px; font-size: 0.88rem; }
      .dir-num { font-weight: 700; color: #888; min-width: 20px; }
      .dir-section { font-weight: 700; font-size: 0.9rem; margin: 12px 0 4px; padding-bottom: 2px; border-bottom: 1px solid #ddd; }
      .notes { font-size: 0.85rem; color: #333; padding: 6px 10px; background: #f5f5f0; border-left: 3px solid #999; margin-bottom: 12px; white-space: pre-line; }
      .notes-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #888; margin-bottom: 2px; }
      .subs { font-size: 0.82rem; padding: 5px 10px; background: #fff3e0; border-left: 3px solid #e65100; margin-bottom: 12px; }
      .subs strong { color: #e65100; }
      .cost-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 2px 0; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>${escapeHtml(dish.name)}</h1>
    <div class="meta">
      <span>${escapeHtml(categoryLabel)}</span>
      ${dish.suggested_price ? `<span><strong>$${Number(dish.suggested_price).toFixed(2)}</strong></span>` : ''}
      ${dish.batch_yield && dish.batch_yield > 1 ? `<span>Makes ${dish.batch_yield} portions</span>` : ''}
      <span style="float:right;color:#888;">Printed: ${new Date().toLocaleDateString()}</span>
    </div>
  `;

  // Allergens
  if (allergens.length) {
    html += `<div class="allergens">${allergens.map(a => `<span class="allergen-tag">${escapeHtml(a)}</span>`).join('')}</div>`;
  }

  // Description
  if (dish.description) {
    html += `<p style="font-size:0.9rem;margin:0 0 12px;">${escapeHtml(dish.description)}</p>`;
  }

  // Ingredients table (with section headers inline)
  if (sections.length) {
    html += `<div class="section-title">Ingredients</div>`;
    html += `<table><thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Prep Note</th></tr></thead><tbody>`;
    for (const row of sections) {
      if (row.row_type === 'section') {
        html += `<tr><td colspan="4" style="font-weight:700;padding-top:10px;border-bottom:1px solid #ccc;">${escapeHtml(row.label)}</td></tr>`;
      } else {
        html += `<tr><td>${escapeHtml(row.ingredient_name)}</td><td>${row.quantity || ''}</td><td>${escapeHtml(row.unit || '')}</td><td>${escapeHtml(row.prep_note || '')}</td></tr>`;
      }
    }
    html += `</tbody></table>`;
  }

  // Service components
  if (components.length) {
    html += `<div class="section-title">Service Components</div>`;
    html += `<div class="components"><ul>${components.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul></div>`;
  }

  // Prep Directions
  if (directions.length) {
    html += `<div class="section-title">Prep Directions</div>`;
    let stepNum = 0;
    for (const d of directions) {
      if (d.type === 'section') {
        html += `<div class="dir-section">${escapeHtml(d.text)}</div>`;
      } else {
        stepNum++;
        html += `<div class="dir-step"><span class="dir-num">${stepNum}.</span><span>${escapeHtml(d.text)}</span></div>`;
      }
    }
  } else if (dish.chefs_notes) {
    html += `<div class="section-title">Chef's Notes</div>`;
    html += `<div class="notes">${escapeHtml(dish.chefs_notes)}</div>`;
  }

  // Service Directions
  const serviceDirections = dish.service_directions || [];
  if (serviceDirections.length) {
    html += `<div class="section-title">Service Directions</div>`;
    let stepNum = 0;
    for (const d of serviceDirections) {
      if (d.type === 'section') {
        html += `<div class="dir-section">${escapeHtml(d.text)}</div>`;
      } else {
        stepNum++;
        html += `<div class="dir-step"><span class="dir-num">${stepNum}.</span><span>${escapeHtml(d.text)}</span></div>`;
      }
    }
  }

  // Substitutions
  if (subs.length) {
    html += `<div class="section-title">Allergen Substitutions</div>`;
    html += `<div class="subs">`;
    html += subs.map(s =>
      `${escapeHtml(s.allergen)}: ${escapeHtml(s.original_ingredient)} &rarr; ${escapeHtml(s.substitute_ingredient)}${s.notes ? ' (' + escapeHtml(s.notes) + ')' : ''}`
    ).join('<br>');
    html += `</div>`;
  }

  // Service notes
  if (dish.service_notes) {
    html += `<div class="section-title">Service Notes</div>`;
    html += `<div class="notes">${escapeHtml(dish.service_notes)}</div>`;
  }

  html += `</body></html>`;
  printSheet(html);
}

function printServiceCard(dish) {
  const allergens = dish.allergens || [];
  const components = dish.components || [];
  const serviceDirections = dish.service_directions || [];

  let html = `
    <html><head><title>Service Card - ${escapeHtml(dish.name)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; color: #1a1a1a; }
      h1 { font-size: 1.5rem; margin: 0 0 4px; }
      .meta { font-size: 0.85rem; color: #555; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 3px solid #1a1a1a; }
      .meta span { margin-right: 12px; }
      .allergens { margin-bottom: 12px; }
      .allergen-tag { display: inline-block; padding: 2px 8px; font-size: 0.72rem; font-weight: 700; background: #ffcdd2; color: #b71c1c; border-radius: 10px; margin-right: 3px; margin-bottom: 3px; }
      .section-title { font-size: 0.95rem; font-weight: 700; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #ddd; }
      .components ul { padding-left: 0; list-style: none; margin: 0; }
      .components li { padding: 3px 0; font-size: 0.9rem; font-weight: 600; border-bottom: 1px solid #f0f0f0; }
      .dir-step { display: flex; gap: 8px; margin-bottom: 6px; font-size: 0.88rem; }
      .dir-num { font-weight: 700; color: #888; min-width: 20px; }
      .dir-section { font-weight: 700; font-size: 0.9rem; margin: 12px 0 4px; padding-bottom: 2px; border-bottom: 1px solid #ddd; }
      .empty-note { font-size: 0.85rem; color: #999; font-style: italic; margin: 8px 0; }
      @media print { body { padding: 0; } }
    </style></head><body>
    <h1>${escapeHtml(dish.name)}</h1>
    <div class="meta">
      <span>Service Card</span>
      <span style="float:right;color:#888;">Printed: ${new Date().toLocaleDateString()}</span>
    </div>
  `;

  // Allergens
  if (allergens.length) {
    html += `<div class="allergens">${allergens.map(a => `<span class="allergen-tag">${escapeHtml(typeof a === 'string' ? a : a.allergen)}</span>`).join('')}</div>`;
  }

  // Service Components
  html += `<div class="section-title">Components</div>`;
  if (components.length) {
    html += `<div class="components"><ul>${components.map(c => `<li>${escapeHtml(c.name)}</li>`).join('')}</ul></div>`;
  } else {
    html += `<p class="empty-note">No service components listed.</p>`;
  }

  // Service Directions
  html += `<div class="section-title">Service Process</div>`;
  if (serviceDirections.length) {
    let stepNum = 0;
    for (const d of serviceDirections) {
      if (d.type === 'section') {
        html += `<div class="dir-section">${escapeHtml(d.text)}</div>`;
      } else {
        stepNum++;
        html += `<div class="dir-step"><span class="dir-num">${stepNum}.</span><span>${escapeHtml(d.text)}</span></div>`;
      }
    }
  } else {
    html += `<p class="empty-note">No service directions listed.</p>`;
  }

  html += `</body></html>`;
  printSheet(html);
}
