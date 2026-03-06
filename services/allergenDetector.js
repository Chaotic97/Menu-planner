const { getDb } = require('../db/database');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect allergens from a list of ingredient names using keyword matching.
 * Returns sorted array of allergen strings.
 */
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

/**
 * Detect allergens for a single ingredient name.
 * Returns array of matched allergen strings.
 */
function detectAllergensForName(ingredientName) {
  const db = getDb();
  const keywords = db.prepare('SELECT keyword, allergen FROM allergen_keywords').all();
  const detected = new Set();
  const normalized = ingredientName.toLowerCase().trim();

  for (const { keyword, allergen } of keywords) {
    const regex = new RegExp(`\\b${escapeRegex(keyword.toLowerCase())}\\b`, 'i');
    if (regex.test(normalized)) {
      detected.add(allergen);
    }
  }

  return Array.from(detected).sort();
}

/**
 * Update auto-detected allergens for a single ingredient.
 * Clears previous auto entries and re-detects from ingredient name.
 * Preserves manual overrides.
 */
function updateIngredientAllergens(ingredientId) {
  const db = getDb();

  const ingredient = db.prepare('SELECT name FROM ingredients WHERE id = ?').get(ingredientId);
  if (!ingredient) return [];

  const detected = detectAllergensForName(ingredient.name);

  // Remove old auto-detected allergens (keep manual overrides)
  db.prepare("DELETE FROM ingredient_allergens WHERE ingredient_id = ? AND source = 'auto'").run(ingredientId);

  // Insert new auto-detected allergens
  const insert = db.prepare('INSERT OR IGNORE INTO ingredient_allergens (ingredient_id, allergen, source) VALUES (?, ?, ?)');
  for (const allergen of detected) {
    insert.run(ingredientId, allergen, 'auto');
  }

  return detected;
}

/**
 * Update ingredient-level allergens for all ingredients in a dish.
 * Called when a dish is created/updated with new ingredients.
 * Also maintains backward-compat dish_allergens (auto) entries.
 */
function updateDishAllergens(dishId) {
  const db = getDb();

  // Get all ingredients for this dish
  const ingredients = db.prepare(`
    SELECT i.id, i.name FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
  `).all(dishId);

  // Update ingredient_allergens for each ingredient
  for (const ing of ingredients) {
    updateIngredientAllergens(ing.id);
  }

  // Also update dish_allergens auto entries for backward compat
  const allDetected = new Set();
  for (const ing of ingredients) {
    const allergens = db.prepare('SELECT allergen FROM ingredient_allergens WHERE ingredient_id = ?').all(ing.id);
    for (const a of allergens) {
      allDetected.add(a.allergen);
    }
  }

  // Remove old auto-detected dish allergens (keep manual overrides)
  db.prepare("DELETE FROM dish_allergens WHERE dish_id = ? AND source = 'auto'").run(dishId);

  // Insert new auto-detected dish allergens
  const insert = db.prepare('INSERT OR IGNORE INTO dish_allergens (dish_id, allergen, source) VALUES (?, ?, ?)');
  for (const allergen of allDetected) {
    insert.run(dishId, allergen, 'auto');
  }

  return Array.from(allDetected).sort();
}

/**
 * Get aggregated allergens for a dish: combines ingredient_allergens (via dish_ingredients)
 * with dish-level manual overrides from dish_allergens.
 * Returns array of { allergen, source, ingredient_name? } objects.
 */
function getDishAllergens(dishId) {
  const db = getDb();

  // Get allergens from ingredients in this dish
  const ingredientAllergens = db.prepare(`
    SELECT DISTINCT ia.allergen, ia.source, i.name AS ingredient_name
    FROM dish_ingredients di
    JOIN ingredient_allergens ia ON ia.ingredient_id = di.ingredient_id
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
    ORDER BY ia.allergen
  `).all(dishId);

  // Get dish-level manual overrides
  const dishManual = db.prepare(
    "SELECT allergen, source FROM dish_allergens WHERE dish_id = ? AND source = 'manual'"
  ).all(dishId);

  // Merge: ingredient allergens + dish manual, deduplicating by allergen name
  const seen = new Set();
  const result = [];

  for (const row of ingredientAllergens) {
    if (!seen.has(row.allergen)) {
      seen.add(row.allergen);
      result.push({ allergen: row.allergen, source: row.source, ingredient_name: row.ingredient_name });
    }
  }

  for (const row of dishManual) {
    if (!seen.has(row.allergen)) {
      seen.add(row.allergen);
      result.push({ allergen: row.allergen, source: 'manual' });
    }
  }

  return result.sort((a, b) => a.allergen.localeCompare(b.allergen));
}

/**
 * Batch get allergens for multiple dishes. Returns map of dishId -> allergen array.
 */
function getDishAllergensBatch(dishIds) {
  if (!dishIds.length) return {};

  const db = getDb();
  const ph = dishIds.map(() => '?').join(',');

  // Get allergens from ingredients
  const ingredientAllergens = db.prepare(`
    SELECT di.dish_id, ia.allergen, ia.source, i.name AS ingredient_name
    FROM dish_ingredients di
    JOIN ingredient_allergens ia ON ia.ingredient_id = di.ingredient_id
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id IN (${ph})
    ORDER BY ia.allergen
  `).all(...dishIds);

  // Get dish-level manual overrides
  const dishManual = db.prepare(
    `SELECT dish_id, allergen, source FROM dish_allergens WHERE dish_id IN (${ph}) AND source = 'manual'`
  ).all(...dishIds);

  // Build map
  const result = {};
  for (const id of dishIds) {
    result[id] = [];
  }

  // Track seen per dish to deduplicate
  const seen = {};

  for (const row of ingredientAllergens) {
    if (!seen[row.dish_id]) seen[row.dish_id] = new Set();
    if (!seen[row.dish_id].has(row.allergen)) {
      seen[row.dish_id].add(row.allergen);
      if (!result[row.dish_id]) result[row.dish_id] = [];
      result[row.dish_id].push({ allergen: row.allergen, source: row.source, ingredient_name: row.ingredient_name });
    }
  }

  for (const row of dishManual) {
    if (!seen[row.dish_id]) seen[row.dish_id] = new Set();
    if (!seen[row.dish_id].has(row.allergen)) {
      seen[row.dish_id].add(row.allergen);
      if (!result[row.dish_id]) result[row.dish_id] = [];
      result[row.dish_id].push({ allergen: row.allergen, source: 'manual' });
    }
  }

  // Sort each dish's allergens
  for (const id of dishIds) {
    if (result[id]) {
      result[id].sort((a, b) => a.allergen.localeCompare(b.allergen));
    }
  }

  return result;
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

module.exports = {
  detectAllergens,
  detectAllergensForName,
  updateIngredientAllergens,
  updateDishAllergens,
  getDishAllergens,
  getDishAllergensBatch,
  getAllergenKeywords,
  addAllergenKeyword,
  deleteAllergenKeyword
};
