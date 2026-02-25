const { getDb } = require('../db/database');
const { convertUnits, normalizeUnit, round2 } = require('./costCalculator');

function generateShoppingList(menuId) {
  const db = getDb();

  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
  if (!menu) return null;

  // Get all dish-ingredients for this menu, multiplied by servings
  const rows = db.prepare(`
    SELECT
      md.servings,
      di.quantity,
      di.unit,
      i.id AS ingredient_id,
      i.name AS ingredient_name,
      i.unit_cost,
      i.base_unit,
      i.category,
      d.name AS dish_name
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    JOIN dish_ingredients di ON di.dish_id = d.id
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE md.menu_id = ?
  `).all(menuId);

  // Aggregate by ingredient
  const aggregated = {};

  for (const row of rows) {
    const adjustedQty = row.quantity * row.servings;
    const key = row.ingredient_id;

    if (!aggregated[key]) {
      aggregated[key] = {
        ingredient_id: row.ingredient_id,
        ingredient: row.ingredient_name,
        category: row.category || 'other',
        unit: row.unit,
        total_quantity: 0,
        unit_cost: row.unit_cost,
        base_unit: row.base_unit,
        used_in: [],
      };
    }

    const entry = aggregated[key];

    // Try to convert to the same unit
    const targetUnit = entry.unit;
    const converted = convertUnits(adjustedQty, row.unit, targetUnit);

    if (converted !== null) {
      entry.total_quantity += converted;
    } else {
      // Units incompatible — just add raw (best effort)
      entry.total_quantity += adjustedQty;
    }

    entry.used_in.push(`${row.dish_name} (${adjustedQty}${row.unit})`);
  }

  // Auto-upscale units (g -> kg when >1000, ml -> L when >1000)
  for (const item of Object.values(aggregated)) {
    const norm = normalizeUnit(item.unit);
    if (norm === 'g' && item.total_quantity >= 1000) {
      item.total_quantity = round2(item.total_quantity / 1000);
      item.unit = 'kg';
    } else if (norm === 'ml' && item.total_quantity >= 1000) {
      item.total_quantity = round2(item.total_quantity / 1000);
      item.unit = 'L';
    } else {
      item.total_quantity = round2(item.total_quantity);
    }
  }

  // Calculate estimated costs
  let totalCost = 0;
  for (const item of Object.values(aggregated)) {
    if (item.unit_cost && item.unit_cost > 0) {
      const qtyInBaseUnit = convertUnits(item.total_quantity, item.unit, item.base_unit);
      if (qtyInBaseUnit !== null) {
        item.estimated_cost = round2(qtyInBaseUnit * item.unit_cost);
        totalCost += item.estimated_cost;
      } else {
        item.estimated_cost = null;
      }
    } else {
      item.estimated_cost = null;
    }
  }

  // Group by category
  const groups = {};
  for (const item of Object.values(aggregated)) {
    const cat = item.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({
      ingredient: item.ingredient,
      total_quantity: item.total_quantity,
      unit: item.unit,
      estimated_cost: item.estimated_cost,
      used_in: item.used_in,
    });
  }

  // Sort groups and items
  const sortedGroups = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.ingredient.localeCompare(b.ingredient)),
    }));

  return {
    menu_id: menuId,
    menu_name: menu.name,
    expected_covers: menu.expected_covers || 0,
    generated_at: new Date().toISOString(),
    groups: sortedGroups,
    total_estimated_cost: round2(totalCost),
  };
}

module.exports = { generateShoppingList };
