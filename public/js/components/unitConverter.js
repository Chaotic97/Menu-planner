// Unit Converter Modal

import { UNIT_GROUPS, convertUnit } from '../utils/unitConversion.js';

const KITCHEN_REFERENCE = [
  { label: '1 tsp',      metric: '5 ml' },
  { label: '1 tbsp',     metric: '15 ml / 3 tsp' },
  { label: '¼ cup',      metric: '60 ml / 4 tbsp' },
  { label: '⅓ cup',      metric: '80 ml' },
  { label: '½ cup',      metric: '120 ml / 8 tbsp' },
  { label: '1 cup',      metric: '240 ml / 16 tbsp' },
  { label: '1 pint',     metric: '475 ml / 2 cups' },
  { label: '1 quart',    metric: '950 ml / 4 cups' },
  { label: '1 gallon',   metric: '3.8 L / 16 cups' },
  { label: '1 oz',       metric: '28 g' },
  { label: '1 lb',       metric: '454 g / 16 oz' },
  { label: '100°C',      metric: '212°F (boiling)' },
  { label: '180°C',      metric: '356°F (moderate oven)' },
  { label: '200°C',      metric: '392°F (hot oven)' },
  { label: '220°C',      metric: '428°F (very hot)' },
];

function formatResult(value, fromUnit, toUnit, category) {
  if (isNaN(value)) return '';
  const result = convertUnit(value, fromUnit, toUnit, category);
  if (result === null || result === undefined) return '';
  if (category === 'temperature') return Number(result).toFixed(1);
  return Number(result).toFixed(4).replace(/\.?0+$/, '');
}

function getAllConversions(value, fromUnit, category) {
  if (isNaN(value) || value === '') return [];
  const units = UNIT_GROUPS[category].units.filter(u => u !== fromUnit);
  return units.map(u => ({ unit: u, result: formatResult(Number(value), fromUnit, u, category) }));
}

export function openUnitConverter() {
  // Remove any existing converter
  document.getElementById('unit-converter-modal')?.remove();

  let activeCategory = 'weight';
  let fromUnit = 'g';
  let inputValue = '';

  const overlay = document.createElement('div');
  overlay.id = 'unit-converter-modal';
  overlay.className = 'modal-overlay';

  function buildHTML() {
    const cat = UNIT_GROUPS[activeCategory];
    return `
      <div class="modal unit-converter-modal">
        <div class="modal-header">
          <h2>Unit Converter</h2>
          <button class="modal-close" id="uc-close">&times;</button>
        </div>

        <div class="uc-category-tabs">
          ${Object.entries(UNIT_GROUPS).map(([key, val]) => `
            <button class="uc-tab-btn ${activeCategory === key ? 'active' : ''}" data-cat="${key}">${val.label}</button>
          `).join('')}
        </div>

        <div class="uc-input-row">
          <input type="number" id="uc-value" class="input" placeholder="Enter value" value="${inputValue}" style="flex:1;">
          <select id="uc-from-unit" class="input" style="flex:0 0 100px;">
            ${cat.units.map(u => `<option value="${u}" ${u === fromUnit ? 'selected' : ''}>${u}</option>`).join('')}
          </select>
        </div>

        <div id="uc-results" class="uc-results"></div>

        <div class="uc-section">
          <h3 class="uc-ref-title">Kitchen Quick Reference</h3>
          <div class="uc-ref-table">
            ${KITCHEN_REFERENCE.map(r => `
              <div class="uc-ref-row">
                <span class="uc-ref-label">${r.label}</span>
                <span class="uc-ref-metric">${r.metric}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderResults() {
    const val = Number(document.getElementById('uc-value')?.value);
    const resultsEl = document.getElementById('uc-results');
    if (!resultsEl) return;

    if (!inputValue) {
      resultsEl.innerHTML = '<p class="uc-hint">Enter a value above to convert</p>';
      return;
    }

    const conversions = getAllConversions(val, fromUnit, activeCategory);
    if (!conversions.length) {
      resultsEl.innerHTML = '';
      return;
    }

    resultsEl.innerHTML = `
      <div class="uc-conversion-grid">
        ${conversions.map(c => `
          <div class="uc-conversion-item">
            <span class="uc-conversion-value">${c.result}</span>
            <span class="uc-conversion-unit">${c.unit}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function mount() {
    overlay.innerHTML = buildHTML();
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    overlay.querySelector('#uc-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    const valueInput = overlay.querySelector('#uc-value');
    const fromUnitSelect = overlay.querySelector('#uc-from-unit');

    valueInput.focus();
    renderResults();

    valueInput.addEventListener('input', (e) => {
      inputValue = e.target.value;
      renderResults();
    });

    fromUnitSelect.addEventListener('change', (e) => {
      fromUnit = e.target.value;
      renderResults();
    });

    overlay.querySelectorAll('.uc-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        fromUnit = UNIT_GROUPS[activeCategory].units[0];
        inputValue = '';
        mount();
      });
    });
  }

  mount();
}
