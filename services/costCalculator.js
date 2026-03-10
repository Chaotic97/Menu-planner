const CONVERSIONS = {
  g_to_kg: v => v / 1000,
  kg_to_g: v => v * 1000,
  ml_to_l: v => v / 1000,
  l_to_ml: v => v * 1000,
  oz_to_g: v => v * 28.3495,
  g_to_oz: v => v / 28.3495,
  lb_to_kg: v => v * 0.453592,
  kg_to_lb: v => v / 0.453592,
  oz_to_kg: v => v * 0.0283495,
  kg_to_oz: v => v / 0.0283495,
  oz_to_lb: v => v / 16,
  lb_to_oz: v => v * 16,
  lb_to_g: v => v * 453.592,
  g_to_lb: v => v / 453.592,
  ml_to_g: v => v,   // approximate for water-like liquids
  g_to_ml: v => v,
  l_to_kg: v => v,
  kg_to_l: v => v,
  // Volume sub-unit conversions
  tsp_to_ml: v => v * 4.92892,
  ml_to_tsp: v => v / 4.92892,
  tbsp_to_ml: v => v * 14.7868,
  ml_to_tbsp: v => v / 14.7868,
  cup_to_ml: v => v * 236.588,
  ml_to_cup: v => v / 236.588,
  tsp_to_tbsp: v => v / 3,
  tbsp_to_tsp: v => v * 3,
  tsp_to_cup: v => v / 48,
  cup_to_tsp: v => v * 48,
  tbsp_to_cup: v => v / 16,
  cup_to_tbsp: v => v * 16,
  tsp_to_l: v => v * 4.92892 / 1000,
  l_to_tsp: v => v * 1000 / 4.92892,
  tbsp_to_l: v => v * 14.7868 / 1000,
  l_to_tbsp: v => v * 1000 / 14.7868,
  cup_to_l: v => v * 236.588 / 1000,
  l_to_cup: v => v * 1000 / 236.588,
};

// Units grouped by category for density bridging
const WEIGHT_UNITS = new Set(['g', 'kg', 'oz', 'lb']);
const VOLUME_UNITS = new Set(['ml', 'l', 'tsp', 'tbsp', 'cup']);

function normalizeUnit(unit) {
  if (!unit) return unit;
  const u = unit.toLowerCase().trim();
  const map = {
    'gram': 'g', 'grams': 'g', 'g': 'g',
    'kilogram': 'kg', 'kilograms': 'kg', 'kg': 'kg',
    'milliliter': 'ml', 'milliliters': 'ml', 'ml': 'ml',
    'liter': 'l', 'liters': 'l', 'litre': 'l', 'litres': 'l', 'l': 'l',
    'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
    'pound': 'lb', 'pounds': 'lb', 'lb': 'lb', 'lbs': 'lb',
    'each': 'each', 'ea': 'each', 'piece': 'each', 'pieces': 'each',
    'bunch': 'bunch', 'sprig': 'sprig', 'pinch': 'pinch',
    'tbsp': 'tbsp', 'tablespoon': 'tbsp',
    'tsp': 'tsp', 'teaspoon': 'tsp',
    'cup': 'cup', 'cups': 'cup',
  };
  return map[u] || u;
}

function convertUnits(quantity, fromUnit, toUnit) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === to) return quantity;

  const key = `${from}_to_${to}`;
  if (CONVERSIONS[key]) {
    return CONVERSIONS[key](quantity);
  }

  return null; // incompatible units
}

/**
 * Convert between any units, bridging weight↔volume via density when available.
 * Returns converted value or null if conversion is not possible.
 */
function convertWithDensity(quantity, fromUnit, toUnit, gPerMl) {
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);

  if (from === to) return quantity;

  // 1. Try same-category conversion first
  const direct = convertUnits(quantity, from, to);
  if (direct !== null) return direct;

  // 2. Need density for cross-category
  if (!gPerMl || gPerMl <= 0) return null;

  const fromIsWeight = WEIGHT_UNITS.has(from);
  const fromIsVolume = VOLUME_UNITS.has(from);
  const toIsWeight = WEIGHT_UNITS.has(to);
  const toIsVolume = VOLUME_UNITS.has(to);

  // 3. Volume → Weight: convert to ml (base volume), multiply by density → grams, convert to target weight
  if (fromIsVolume && toIsWeight) {
    const inMl = convertUnits(quantity, from, 'ml');
    if (inMl === null) return null;
    const inGrams = inMl * gPerMl;
    return convertUnits(inGrams, 'g', to);
  }

  // 4. Weight → Volume: convert to grams (base weight), divide by density → ml, convert to target volume
  if (fromIsWeight && toIsVolume) {
    const inGrams = convertUnits(quantity, from, 'g');
    if (inGrams === null) return null;
    const inMl = inGrams / gPerMl;
    return convertUnits(inMl, 'ml', to);
  }

  return null;
}

function round2(num) {
  return Math.round(num * 100) / 100;
}

function calculateDishCost(dishIngredients) {
  let totalCost = 0;
  const lineItems = [];

  for (const di of dishIngredients) {
    if (!di.unit_cost || di.unit_cost === 0) {
      lineItems.push({
        ingredient: di.ingredient_name,
        quantity: di.quantity,
        unit: di.unit,
        cost: null,
        warning: 'No cost data',
      });
      continue;
    }

    // Try density-aware conversion first, fall back to basic
    const converted = di.g_per_ml
      ? convertWithDensity(di.quantity, di.unit, di.base_unit, di.g_per_ml)
      : convertUnits(di.quantity, di.unit, di.base_unit);

    if (converted === null) {
      lineItems.push({
        ingredient: di.ingredient_name,
        quantity: di.quantity,
        unit: di.unit,
        cost: null,
        warning: `Cannot convert ${di.unit} to ${di.base_unit}`,
      });
      continue;
    }

    const lineCost = converted * di.unit_cost;
    totalCost += lineCost;

    lineItems.push({
      ingredient: di.ingredient_name,
      quantity: di.quantity,
      unit: di.unit,
      cost: round2(lineCost),
    });
  }

  return { lineItems, totalCost: round2(totalCost) };
}

function calculateFoodCostPercent(dishCost, sellingPrice) {
  if (!sellingPrice || sellingPrice <= 0) return null;
  return round2((dishCost / sellingPrice) * 100);
}

function suggestPrice(dishCost, targetPercent = 30) {
  if (!dishCost || dishCost <= 0) return null;
  if (!targetPercent || targetPercent <= 0) return null;
  return round2(dishCost / (targetPercent / 100));
}

module.exports = { calculateDishCost, calculateFoodCostPercent, suggestPrice, convertUnits, convertWithDensity, normalizeUnit, round2 };
