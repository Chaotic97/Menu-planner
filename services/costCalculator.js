const CONVERSIONS = {
  g_to_kg: v => v / 1000,
  kg_to_g: v => v * 1000,
  ml_to_l: v => v / 1000,
  l_to_ml: v => v * 1000,
  oz_to_g: v => v * 28.3495,
  g_to_oz: v => v / 28.3495,
  lb_to_kg: v => v * 0.453592,
  kg_to_lb: v => v / 0.453592,
  ml_to_g: v => v,   // approximate for water-like liquids
  g_to_ml: v => v,
  l_to_kg: v => v,
  kg_to_l: v => v,
};

function normalizeUnit(unit) {
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

    const converted = convertUnits(di.quantity, di.unit, di.base_unit);

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
  return round2(dishCost / (targetPercent / 100));
}

module.exports = { calculateDishCost, calculateFoodCostPercent, suggestPrice, convertUnits, normalizeUnit, round2 };
