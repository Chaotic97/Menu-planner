import { ALLERGEN_INFO } from '../data/allergenKeywords.js';

export function renderAllergenBadges(allergens, compact = false) {
  if (!allergens || !allergens.length) return '';

  const items = allergens.map(a => {
    const name = typeof a === 'string' ? a : a.allergen;
    const info = ALLERGEN_INFO[name] || { label: name, color: '#999' };
    const isManual = typeof a === 'object' && a.source === 'manual';
    const cls = compact ? 'allergen-badge compact' : 'allergen-badge';
    return `<span class="${cls}" style="background:${info.color}" title="${info.label}${isManual ? ' (manual)' : ''}">${info.label}</span>`;
  });

  return `<div class="allergen-badges">${items.join('')}</div>`;
}
