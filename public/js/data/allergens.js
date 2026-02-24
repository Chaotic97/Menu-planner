export const ALLERGEN_LIST = [
  'celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin',
  'milk', 'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soy', 'sulphites',
];

export const CATEGORY_ORDER = [
  'starter', 'soup', 'salad', 'main', 'side', 'dessert', 'bread', 'sauce', 'beverage', 'other',
];

export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
