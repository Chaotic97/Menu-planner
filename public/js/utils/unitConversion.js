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
