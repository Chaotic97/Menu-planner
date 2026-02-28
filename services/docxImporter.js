const mammoth = require('mammoth');

/**
 * Import a dish recipe from a Meez-exported .docx file.
 *
 * Expected format (text extracted from the .docx):
 *   Line 1: Recipe title
 *   Section headers ending with ":"  (e.g. "Filling:", "Sauce mixture:")
 *   Ingredient lines: qty unit ingredient_name (prep_note)
 *   "Prep Method" line: divides ingredients from instructions
 *   Method sections: same section headers with paragraph instructions
 *
 * Returns a recipe object matching the shape used by importRecipe (URL importer),
 * so the dish form can consume it identically via sessionStorage.
 */

// Units recognised in Meez ingredient lines
const UNIT_WORDS = new Set([
  'cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp',
  'ounce', 'ounces', 'oz', 'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g', 'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml', 'liter', 'liters', 'l', 'litre', 'litres',
  'pinch', 'bunch', 'sprig', 'sprigs', 'clove', 'cloves', 'can', 'cans',
  'piece', 'pieces', 'slice', 'slices', 'head', 'heads', 'stalk', 'stalks',
  'each', 'qt', 'quart', 'quarts', 'pint', 'pints', 'pt', 'gallon', 'gallons', 'gal',
  'fl',
]);

const UNIT_NORMALIZE = {
  'cup': 'cup', 'cups': 'cup',
  'tablespoon': 'tbsp', 'tablespoons': 'tbsp', 'tbsp': 'tbsp',
  'teaspoon': 'tsp', 'teaspoons': 'tsp', 'tsp': 'tsp',
  'ounce': 'oz', 'ounces': 'oz', 'oz': 'oz',
  'pound': 'lb', 'pounds': 'lb', 'lb': 'lb', 'lbs': 'lb',
  'gram': 'g', 'grams': 'g', 'g': 'g',
  'kilogram': 'kg', 'kilograms': 'kg', 'kg': 'kg',
  'milliliter': 'ml', 'milliliters': 'ml', 'ml': 'ml',
  'liter': 'l', 'liters': 'l', 'litre': 'l', 'litres': 'l', 'l': 'l',
  'pinch': 'pinch', 'bunch': 'bunch',
  'sprig': 'each', 'sprigs': 'each',
  'clove': 'each', 'cloves': 'each',
  'can': 'each', 'cans': 'each',
  'piece': 'each', 'pieces': 'each',
  'slice': 'each', 'slices': 'each',
  'head': 'each', 'heads': 'each',
  'stalk': 'each', 'stalks': 'each',
  'each': 'each',
  'qt': 'qt', 'quart': 'qt', 'quarts': 'qt',
  'pint': 'pint', 'pints': 'pint', 'pt': 'pint',
  'gallon': 'gal', 'gallons': 'gal', 'gal': 'gal',
  'fl': 'fl oz',
};

/**
 * Test whether a line looks like a section header (e.g. "Filling:", "Sauce mixture:").
 * Must end with ":" and not start with a digit (to avoid "12 lb Foo:" false positives).
 */
function isSectionHeader(line) {
  const trimmed = line.trim();
  return trimmed.endsWith(':') && !/^\d/.test(trimmed);
}

/**
 * Test whether a line is the "Prep Method" divider.
 */
function isPrepMethodDivider(line) {
  return /^prep\s+method$/i.test(line.trim());
}

/**
 * Parse a single Meez ingredient line like:
 *   "12 lb Shrimp 31/40 (25% Robocouped 75% hand minced)"
 *   "200 g Ginger, minced (Robocouped)"
 *   "720 g Shiitake Mushrooms (Robocouped)"
 *
 * Returns { name, quantity, unit, prep_note }
 */
function parseMeezIngredient(line) {
  let text = line.trim();

  // Extract parenthetical prep notes before stripping
  const prepParts = [];
  const parenRegex = /\(([^)]*)\)/g;
  let match;
  while ((match = parenRegex.exec(text)) !== null) {
    const note = match[1].trim();
    if (note) prepParts.push(note);
  }
  const prep_note = prepParts.join('; ');

  // Strip parenthetical content for parsing qty/unit/name (loop for nested parens)
  let prev;
  do { prev = text; text = text.replace(/\([^()]*\)/g, ''); } while (text !== prev);
  text = text.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

  // Try to extract leading quantity (integer, decimal, or fraction)
  const qtyPattern = /^([\d]+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)\s*/;
  const qtyMatch = text.match(qtyPattern);

  let quantity = 0;
  let remaining = text;

  if (qtyMatch) {
    const raw = qtyMatch[1].replace(',', '.');
    // Handle fraction like "1/2"
    if (raw.includes('/')) {
      const parts = raw.split('/');
      quantity = parseFloat(parts[0]) / parseFloat(parts[1]);
    } else {
      quantity = parseFloat(raw);
    }
    if (isNaN(quantity) || quantity <= 0) quantity = 0;
    remaining = text.substring(qtyMatch[0].length).trim();
  }

  // Try to extract unit word
  let unit = 'each';
  const words = remaining.split(/\s+/);
  if (words.length > 0) {
    // Handle compound units like "fl oz"
    const twoWordUnit = words.length >= 2 ? (words[0] + ' ' + words[1]).toLowerCase() : '';
    const oneWordUnit = words[0].toLowerCase().replace(/[,;.]$/, '');

    if (twoWordUnit === 'fl oz') {
      unit = 'fl oz';
      remaining = words.slice(2).join(' ').trim();
    } else if (UNIT_WORDS.has(oneWordUnit)) {
      unit = UNIT_NORMALIZE[oneWordUnit] || oneWordUnit;
      remaining = words.slice(1).join(' ').trim();
    }
  }

  // Clean up ingredient name
  const name = remaining
    .replace(/^of\s+/i, '')
    .replace(/,\s*$/, '')
    .replace(/[,;:.!\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    name: name || line.trim(),
    quantity: Math.round(quantity * 1000) / 1000,
    unit,
    prep_note,
  };
}

/**
 * Guess a dish category from the recipe name and description.
 */
function guessCategory(name, description) {
  const text = ((name || '') + ' ' + (description || '')).toLowerCase();
  if (/soup|broth|chowder|bisque|stew/i.test(text)) return 'soup';
  if (/salad/i.test(text)) return 'salad';
  if (/cake|cookie|pie|tart|mousse|ice cream|custard|pudding|brownie|pastry|dessert|chocolate/i.test(text)) return 'dessert';
  if (/bread|roll|bun|focaccia|baguette|loaf/i.test(text)) return 'bread';
  if (/sauce|dressing|vinaigrette|gravy|aioli|pesto|salsa|condiment/i.test(text)) return 'sauce';
  if (/cocktail|drink|smoothie|juice|lemonade|tea|coffee/i.test(text)) return 'beverage';
  if (/appetizer|starter|bruschetta|crostini|dip|hummus/i.test(text)) return 'starter';
  if (/side dish|roasted vegetables|fries|coleslaw|mashed potato/i.test(text)) return 'side';
  if (/dumpling|siu mai|gyoza|wonton|dim sum|bao/i.test(text)) return 'starter';
  return 'main';
}

/**
 * Parse the raw text content of a Meez .docx export.
 *
 * @param {string} text  Plain text extracted from the .docx
 * @returns {object}     Recipe object: { name, description, category, ingredients, instructions }
 */
function parseMeezText(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length === 0) {
    throw new Error('The document appears to be empty.');
  }

  // Line 1 is the recipe title
  const name = lines[0];

  // Find the "Prep Method" divider
  let prepMethodIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (isPrepMethodDivider(lines[i])) {
      prepMethodIdx = i;
      break;
    }
  }

  // --- Parse ingredient section (lines between title and "Prep Method") ---
  const ingredientLines = prepMethodIdx > 0
    ? lines.slice(1, prepMethodIdx)
    : lines.slice(1); // no Prep Method found — treat everything as ingredients

  const ingredients = [];
  let currentSection = null;

  for (const line of ingredientLines) {
    if (isSectionHeader(line)) {
      currentSection = line.replace(/:$/, '').trim();
      // Add as a section header for the dish form
      ingredients.push({ section_header: currentSection });
    } else {
      // Must start with a digit to be an ingredient line
      if (/^\d/.test(line)) {
        ingredients.push(parseMeezIngredient(line));
      }
      // Non-digit, non-header lines in the ingredient zone are skipped
    }
  }

  // --- Parse method/instructions section (lines after "Prep Method") ---
  let instructions = '';
  const directions = [];
  if (prepMethodIdx > 0) {
    const methodLines = lines.slice(prepMethodIdx + 1);
    const parts = [];

    for (const line of methodLines) {
      if (isSectionHeader(line)) {
        const sectionName = line.replace(/:$/, '').trim();
        parts.push(`\n${sectionName}:`);
        directions.push({ type: 'section', text: sectionName });
      } else {
        parts.push(line);
        directions.push({ type: 'step', text: line });
      }
    }

    instructions = parts.join('\n').trim();
  }

  return {
    name,
    description: '',
    category: guessCategory(name, ''),
    ingredients,
    instructions,
    directions,
  };
}

/**
 * Import a recipe from a Meez .docx file buffer.
 *
 * @param {Buffer} buffer  The raw .docx file bytes
 * @returns {Promise<object>}  Recipe object ready for the dish form
 */
async function importDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  if (!text || !text.trim()) {
    throw new Error('Could not extract any text from the .docx file.');
  }

  return parseMeezText(text);
}

module.exports = { importDocx, parseMeezText, parseMeezIngredient, isSectionHeader };
