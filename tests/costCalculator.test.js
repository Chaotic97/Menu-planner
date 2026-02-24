'use strict';

const {
  normalizeUnit,
  convertUnits,
  round2,
  calculateDishCost,
  calculateFoodCostPercent,
  suggestPrice,
} = require('../services/costCalculator');

// ─── normalizeUnit ────────────────────────────────────────────────────────────

describe('normalizeUnit', () => {
  test('returns canonical form for weight units', () => {
    expect(normalizeUnit('grams')).toBe('g');
    expect(normalizeUnit('gram')).toBe('g');
    expect(normalizeUnit('G')).toBe('g');
    expect(normalizeUnit('kilograms')).toBe('kg');
    expect(normalizeUnit('kilogram')).toBe('kg');
    expect(normalizeUnit('KG')).toBe('kg');
    expect(normalizeUnit('ounce')).toBe('oz');
    expect(normalizeUnit('ounces')).toBe('oz');
    expect(normalizeUnit('pound')).toBe('lb');
    expect(normalizeUnit('pounds')).toBe('lb');
    expect(normalizeUnit('lbs')).toBe('lb');
  });

  test('returns canonical form for volume units', () => {
    expect(normalizeUnit('milliliter')).toBe('ml');
    expect(normalizeUnit('milliliters')).toBe('ml');
    expect(normalizeUnit('liter')).toBe('l');
    expect(normalizeUnit('liters')).toBe('l');
    expect(normalizeUnit('litre')).toBe('l');
    expect(normalizeUnit('litres')).toBe('l');
    expect(normalizeUnit('L')).toBe('l');
  });

  test('returns canonical form for count / informal units', () => {
    expect(normalizeUnit('each')).toBe('each');
    expect(normalizeUnit('ea')).toBe('each');
    expect(normalizeUnit('piece')).toBe('each');
    expect(normalizeUnit('pieces')).toBe('each');
    expect(normalizeUnit('bunch')).toBe('bunch');
    expect(normalizeUnit('tbsp')).toBe('tbsp');
    expect(normalizeUnit('tablespoon')).toBe('tbsp');
    expect(normalizeUnit('tsp')).toBe('tsp');
    expect(normalizeUnit('teaspoon')).toBe('tsp');
    expect(normalizeUnit('cup')).toBe('cup');
    expect(normalizeUnit('cups')).toBe('cup');
  });

  test('trims whitespace before normalising', () => {
    expect(normalizeUnit('  kg  ')).toBe('kg');
    expect(normalizeUnit(' grams ')).toBe('g');
  });

  test('passes through unknown units unchanged', () => {
    expect(normalizeUnit('floz')).toBe('floz');
    expect(normalizeUnit('gallon')).toBe('gallon');
  });
});

// ─── round2 ───────────────────────────────────────────────────────────────────

describe('round2', () => {
  test('rounds to two decimal places', () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.235)).toBe(1.24);
    expect(round2(1.999)).toBe(2);
    expect(round2(0.1 + 0.2)).toBeCloseTo(0.3); // IEEE 754 — use toBeCloseTo
  });

  test('handles whole numbers', () => {
    expect(round2(5)).toBe(5);
    expect(round2(0)).toBe(0);
  });

  test('handles negative numbers', () => {
    expect(round2(-1.234)).toBe(-1.23);
    expect(round2(-2.999)).toBe(-3);
  });
});

// ─── convertUnits ─────────────────────────────────────────────────────────────

describe('convertUnits', () => {
  // Same unit — no conversion needed
  test('returns the original quantity when units are identical', () => {
    expect(convertUnits(500, 'g', 'g')).toBe(500);
    expect(convertUnits(1, 'kg', 'kg')).toBe(1);
    expect(convertUnits(200, 'ml', 'ml')).toBe(200);
  });

  // Same unit after normalisation
  test('returns original quantity when units normalise to the same canonical form', () => {
    expect(convertUnits(500, 'grams', 'g')).toBe(500);
    expect(convertUnits(1, 'kilogram', 'kg')).toBe(1);
  });

  // Weight conversions
  test('converts g ↔ kg', () => {
    expect(convertUnits(1000, 'g', 'kg')).toBeCloseTo(1);
    expect(convertUnits(0.5, 'kg', 'g')).toBeCloseTo(500);
  });

  test('converts oz ↔ g', () => {
    expect(convertUnits(1, 'oz', 'g')).toBeCloseTo(28.3495);
    expect(convertUnits(28.3495, 'g', 'oz')).toBeCloseTo(1);
  });

  test('converts lb ↔ kg', () => {
    expect(convertUnits(1, 'lb', 'kg')).toBeCloseTo(0.453592);
    expect(convertUnits(1, 'kg', 'lb')).toBeCloseTo(2.20462, 3);
  });

  // Volume conversions
  test('converts ml ↔ l', () => {
    expect(convertUnits(1000, 'ml', 'l')).toBeCloseTo(1);
    expect(convertUnits(1, 'l', 'ml')).toBeCloseTo(1000);
  });

  // Cross-type approximations (water-like)
  test('approximates ml ↔ g for water-like liquids', () => {
    expect(convertUnits(250, 'ml', 'g')).toBe(250);
    expect(convertUnits(250, 'g', 'ml')).toBe(250);
  });

  test('approximates l ↔ kg for water-like liquids', () => {
    expect(convertUnits(1, 'l', 'kg')).toBe(1);
    expect(convertUnits(1, 'kg', 'l')).toBe(1);
  });

  // Incompatible units — note: g↔ml and l↔kg are intentional water-like approximations
  test('returns null for truly incompatible units', () => {
    expect(convertUnits(1, 'g', 'l')).toBeNull();    // no g_to_l path in CONVERSIONS
    expect(convertUnits(1, 'each', 'g')).toBeNull();
    expect(convertUnits(1, 'cup', 'kg')).toBeNull();
    expect(convertUnits(1, 'oz', 'ml')).toBeNull();  // no oz_to_ml path
  });
});

// ─── calculateDishCost ────────────────────────────────────────────────────────

describe('calculateDishCost', () => {
  test('calculates line costs and total for compatible units', () => {
    const ingredients = [
      { ingredient_name: 'Chicken breast', quantity: 200, unit: 'g', base_unit: 'g', unit_cost: 0.015 },
      // 200g × £0.015/g = £3.00
      { ingredient_name: 'Olive oil',      quantity: 50,  unit: 'ml', base_unit: 'ml', unit_cost: 0.005 },
      // 50ml × £0.005/ml = £0.25
    ];

    const { lineItems, totalCost } = calculateDishCost(ingredients);

    expect(totalCost).toBeCloseTo(3.25);
    expect(lineItems).toHaveLength(2);
    expect(lineItems[0].cost).toBeCloseTo(3.00);
    expect(lineItems[1].cost).toBeCloseTo(0.25);
  });

  test('handles unit conversion between ingredient unit and base unit', () => {
    const ingredients = [
      // quantity given in kg, but cost is per g
      { ingredient_name: 'Flour', quantity: 0.5, unit: 'kg', base_unit: 'g', unit_cost: 0.002 },
      // 0.5 kg → 500 g × £0.002/g = £1.00
    ];

    const { lineItems, totalCost } = calculateDishCost(ingredients);
    expect(totalCost).toBeCloseTo(1.00);
    expect(lineItems[0].cost).toBeCloseTo(1.00);
  });

  test('emits a warning and null cost when unit_cost is 0 or missing', () => {
    const ingredients = [
      { ingredient_name: 'Mystery herb', quantity: 5, unit: 'g', base_unit: 'g', unit_cost: 0 },
    ];

    const { lineItems, totalCost } = calculateDishCost(ingredients);
    expect(totalCost).toBe(0);
    expect(lineItems[0].cost).toBeNull();
    expect(lineItems[0].warning).toBe('No cost data');
  });

  test('emits a warning and null cost when units are incompatible', () => {
    const ingredients = [
      { ingredient_name: 'Lemon', quantity: 2, unit: 'each', base_unit: 'g', unit_cost: 0.02 },
    ];

    const { lineItems, totalCost } = calculateDishCost(ingredients);
    expect(totalCost).toBe(0);
    expect(lineItems[0].cost).toBeNull();
    expect(lineItems[0].warning).toMatch(/cannot convert/i);
  });

  test('returns zero total for an empty ingredient list', () => {
    const { lineItems, totalCost } = calculateDishCost([]);
    expect(totalCost).toBe(0);
    expect(lineItems).toHaveLength(0);
  });

  test('adds up multiple ingredients correctly', () => {
    const ingredients = [
      { ingredient_name: 'A', quantity: 100, unit: 'g', base_unit: 'g', unit_cost: 0.01 }, // £1.00
      { ingredient_name: 'B', quantity: 200, unit: 'g', base_unit: 'g', unit_cost: 0.02 }, // £4.00
      { ingredient_name: 'C', quantity: 300, unit: 'g', base_unit: 'g', unit_cost: 0.03 }, // £9.00
    ];
    const { totalCost } = calculateDishCost(ingredients);
    expect(totalCost).toBeCloseTo(14.00);
  });
});

// ─── calculateFoodCostPercent ─────────────────────────────────────────────────

describe('calculateFoodCostPercent', () => {
  test('calculates food cost percentage correctly', () => {
    expect(calculateFoodCostPercent(3, 10)).toBe(30);   // 3/10 = 30%
    expect(calculateFoodCostPercent(5, 20)).toBe(25);   // 5/20 = 25%
    expect(calculateFoodCostPercent(1, 3)).toBeCloseTo(33.33);
  });

  test('returns null when selling price is 0', () => {
    expect(calculateFoodCostPercent(5, 0)).toBeNull();
  });

  test('returns null when selling price is negative', () => {
    expect(calculateFoodCostPercent(5, -10)).toBeNull();
  });

  test('returns null when selling price is null or undefined', () => {
    expect(calculateFoodCostPercent(5, null)).toBeNull();
    expect(calculateFoodCostPercent(5, undefined)).toBeNull();
  });
});

// ─── suggestPrice ─────────────────────────────────────────────────────────────

describe('suggestPrice', () => {
  test('calculates suggested price at default 30% target', () => {
    // cost £3 at 30% → £10.00
    expect(suggestPrice(3)).toBeCloseTo(10.00);
    // cost £5 at 30% → £16.67
    expect(suggestPrice(5)).toBeCloseTo(16.67);
  });

  test('calculates suggested price at a custom target percentage', () => {
    // cost £4 at 25% → £16.00
    expect(suggestPrice(4, 25)).toBeCloseTo(16.00);
    // cost £6 at 40% → £15.00
    expect(suggestPrice(6, 40)).toBeCloseTo(15.00);
  });

  test('returns null when dish cost is 0', () => {
    expect(suggestPrice(0)).toBeNull();
  });

  test('returns null when dish cost is null or undefined', () => {
    expect(suggestPrice(null)).toBeNull();
    expect(suggestPrice(undefined)).toBeNull();
  });

  test('returns null when dish cost is negative', () => {
    expect(suggestPrice(-1)).toBeNull();
  });
});
