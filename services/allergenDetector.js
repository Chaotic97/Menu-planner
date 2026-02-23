const { getDb } = require('../db/database');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectAllergens(ingredientNames) {
  const db = getDb();
  const keywords = db.prepare('SELECT keyword, allergen FROM allergen_keywords').all();
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

function updateDishAllergens(dishId) {
  const db = getDb();

  // Get all ingredient names for this dish
  const ingredients = db.prepare(`
    SELECT i.name FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
  `).all(dishId);

  const ingredientNames = ingredients.map(i => i.name);
  const detected = detectAllergens(ingredientNames);

  // Remove old auto-detected allergens (keep manual overrides)
  db.prepare("DELETE FROM dish_allergens WHERE dish_id = ? AND source = 'auto'").run(dishId);

  // Insert new auto-detected allergens
  const insert = db.prepare('INSERT OR IGNORE INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, ?)');
  for (const allergen of detected) {
    insert.run(dishId, allergen, 'auto');
  }

  return detected;
}

function getAllergenKeywords() {
  const db = getDb();
  return db.prepare('SELECT * FROM allergen_keywords ORDER BY allergen, keyword').all();
}

function addAllergenKeyword(keyword, allergen) {
  const db = getDb();
  return db.prepare('INSERT OR IGNORE INTO allergen_keywords (keyword, allergen) VALUES (?, ?)').run(keyword, allergen);
}

function deleteAllergenKeyword(id) {
  const db = getDb();
  return db.prepare('DELETE FROM allergen_keywords WHERE id = ?').run(id);
}

module.exports = { detectAllergens, updateDishAllergens, getAllergenKeywords, addAllergenKeyword, deleteAllergenKeyword };
