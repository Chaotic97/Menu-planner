// Client-side allergen detection for live preview
// This is loaded once from the API and cached

let keywordsCache = null;

export async function loadAllergenKeywords() {
  if (keywordsCache) return keywordsCache;
  try {
    const res = await fetch('/api/dishes/allergen-keywords/all');
    keywordsCache = await res.json();
  } catch {
    keywordsCache = [];
  }
  return keywordsCache;
}

export function clearCache() {
  keywordsCache = null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function detectAllergensClient(ingredientNames, keywords) {
  const detected = new Set();
  for (const name of ingredientNames) {
    const normalized = name.toLowerCase().trim();
    for (const { keyword, allergen } of keywords) {
      const regex = new RegExp(`\\b${escapeRegex(keyword.toLowerCase())}\\b`, 'i');
      if (regex.test(normalized)) {
        detected.add(allergen);
      }
    }
  }
  return Array.from(detected).sort();
}

export const ALLERGEN_INFO = {
  celery: { label: 'Celery', color: '#4caf50' },
  gluten: { label: 'Gluten', color: '#ff9800' },
  crustaceans: { label: 'Crustaceans', color: '#f44336' },
  eggs: { label: 'Eggs', color: '#ffeb3b' },
  fish: { label: 'Fish', color: '#2196f3' },
  lupin: { label: 'Lupin', color: '#9c27b0' },
  milk: { label: 'Milk', color: '#e0e0e0' },
  molluscs: { label: 'Molluscs', color: '#00bcd4' },
  mustard: { label: 'Mustard', color: '#ffc107' },
  nuts: { label: 'Nuts', color: '#795548' },
  peanuts: { label: 'Peanuts', color: '#d4a574' },
  sesame: { label: 'Sesame', color: '#c8b89a' },
  soy: { label: 'Soy', color: '#8bc34a' },
  sulphites: { label: 'Sulphites', color: '#607d8b' },
};
