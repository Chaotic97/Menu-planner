import { ALLERGEN_INFO } from '../data/allergenKeywords.js';
import { escapeHtml } from '../utils/escapeHtml.js';

export function renderAllergenBadges(allergens, compact = false) {
  if (!allergens || !allergens.length) return '';

  const items = allergens.map(a => {
    const name = typeof a === 'string' ? a : a.allergen;
    const info = ALLERGEN_INFO[name] || { label: name, color: '#999' };
    const isManual = typeof a === 'object' && a.source === 'manual';
    const cls = compact ? 'allergen-badge compact' : 'allergen-badge';
    const label = escapeHtml(info.label);
    return `<span class="${cls} allergen-${name}" title="${label}${isManual ? ' (manual)' : ''}">${label}</span>`;
  });

  return `<div class="allergen-badges">${items.join('')}</div>`;
}
