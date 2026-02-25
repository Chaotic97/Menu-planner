import { getDish, deleteDish, duplicateDish } from '../api.js';
import { renderAllergenBadges } from '../components/allergenBadges.js';
import { showToast } from '../components/toast.js';
import { openLightbox } from '../components/lightbox.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { CATEGORIES } from '../data/categories.js';

export async function renderDishView(container, dishId) {
  container.innerHTML = '<div class="loading">Loading...</div>';

  let dish;
  try {
    dish = await getDish(dishId);
  } catch (err) {
    container.innerHTML = `<div class="error">Failed to load: ${err.message}</div>`;
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
    const pct = dish.food_cost_percent;
    const pctColor = pct === null ? '' : pct > 35 ? 'var(--danger)' : pct > 30 ? 'var(--warning)' : 'var(--success)';
    return `
      <div class="dv-cost-row">
        <span>Food cost</span>
        <span>$${combined.toFixed(2)}${pct !== null ? ` <span style="color:${pctColor};font-weight:700;">(${pct}%)</span>` : ''}</span>
      </div>
      ${dish.suggested_price ? `<div class="dv-cost-row"><span>Selling price</span><span>$${Number(dish.suggested_price).toFixed(2)}</span></div>` : ''}
    `;
  }

  container.innerHTML = `
    <div class="page-header">
      <a href="#/dishes" class="btn btn-back">&larr; Back</a>
      <h1 class="dv-title">${escapeHtml(dish.name)}</h1>
      <div class="header-actions">
        <a href="#/dishes/${dish.id}/edit" class="btn btn-primary">Edit</a>
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

        ${dish.chefs_notes ? `
          <div class="dv-card">
            <h3 class="dv-card-title">Chef's Notes</h3>
            <p class="dv-notes">${escapeHtml(dish.chefs_notes).replace(/\n/g, '<br>')}</p>
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
