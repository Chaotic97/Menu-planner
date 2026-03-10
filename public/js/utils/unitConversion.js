// Shared unit conversion data and functions (client-side)

export const UNIT_GROUPS = {
  weight: {
    label: 'Weight',
    units: ['g', 'kg', 'oz', 'lb'],
    toBase: { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 }, // base = grams
  },
  volume: {
    label: 'Volume',
    units: ['ml', 'L', 'tsp', 'tbsp', 'fl oz', 'cup', 'pint', 'quart', 'gallon'],
    toBase: { ml: 1, L: 1000, tsp: 4.92892, tbsp: 14.7868, 'fl oz': 29.5735, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41 }, // base = ml
  },
  temperature: {
    label: 'Temperature',
    units: ['°C', '°F'],
    toBase: null, // handled separately
  },
};

/**
 * Find which group a unit belongs to.
 * Returns { group: string, data: object } or null.
 */
export function getUnitGroup(unit) {
  for (const [group, data] of Object.entries(UNIT_GROUPS)) {
    if (data.units.includes(unit)) return { group, data };
  }
  return null;
}

/**
 * Convert a value between two units. Returns raw number (caller handles rounding)
 * or null if conversion is not possible.
 * For temperature, pass category='temperature'.
 */
export function convertUnit(value, fromUnit, toUnit, category) {
  if (isNaN(value) || fromUnit === toUnit) return value;

  if (category === 'temperature') {
    if (fromUnit === '°C' && toUnit === '°F') return (value * 9 / 5) + 32;
    if (fromUnit === '°F' && toUnit === '°C') return (value - 32) * 5 / 9;
    return value;
  }

  const g = category ? UNIT_GROUPS[category] : getUnitGroup(fromUnit)?.data;
  if (!g || !g.toBase) return null;

  const baseValue = value * g.toBase[fromUnit];
  return baseValue / g.toBase[toUnit];
}

/**
 * Return the list of units a given unit can convert to (same group, excluding itself).
 */
export function compatibleUnits(fromUnit) {
  const g = getUnitGroup(fromUnit);
  if (!g) return [];
  return g.data.units.filter(u => u !== fromUnit);
}

/**
 * Convert between any units, bridging weight↔volume via density (g/ml) when available.
 * Returns converted value or null if conversion is not possible.
 */
export function convertWithDensity(value, fromUnit, toUnit, gPerMl) {
  if (isNaN(value) || fromUnit === toUnit) return value;

  // 1. Try same-category first
  const direct = convertUnit(value, fromUnit, toUnit);
  if (direct !== null) return direct;

  // 2. Need density for cross-category
  if (!gPerMl || gPerMl <= 0) return null;

  const fromGroup = getUnitGroup(fromUnit);
  const toGroup = getUnitGroup(toUnit);
  if (!fromGroup || !toGroup) return null;

  // Volume → Weight
  if (fromGroup.group === 'volume' && toGroup.group === 'weight') {
    const inMl = value * fromGroup.data.toBase[fromUnit]; // convert to ml
    const inGrams = inMl * gPerMl;
    return inGrams / toGroup.data.toBase[toUnit]; // convert grams to target
  }

  // Weight → Volume
  if (fromGroup.group === 'weight' && toGroup.group === 'volume') {
    const inGrams = value * fromGroup.data.toBase[fromUnit]; // convert to grams
    const inMl = inGrams / gPerMl;
    return inMl / toGroup.data.toBase[toUnit]; // convert ml to target
  }

  return null;
}

/**
 * Return all units a given unit can convert to.
 * Same-category always included; opposite category (weight↔volume) included when gPerMl is truthy.
 */
export function allCompatibleUnits(fromUnit, gPerMl) {
  const sameCategory = compatibleUnits(fromUnit);
  if (!gPerMl) return sameCategory;

  const fromGroup = getUnitGroup(fromUnit);
  if (!fromGroup) return sameCategory;

  // Add units from the opposite category
  const oppositeKey = fromGroup.group === 'weight' ? 'volume' : fromGroup.group === 'volume' ? 'weight' : null;
  if (!oppositeKey) return sameCategory;

  const oppositeUnits = UNIT_GROUPS[oppositeKey].units;
  return [...sameCategory, ...oppositeUnits];
}
