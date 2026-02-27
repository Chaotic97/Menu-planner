const cheerio = require('cheerio');
const dns = require('dns');
const { promisify } = require('util');

const dnsResolve = promisify(dns.resolve4);

// Maximum response body size (5 MB)
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
// Request timeout (10 seconds)
const FETCH_TIMEOUT_MS = 10000;

/**
 * Validate a URL is safe to fetch (SSRF protection).
 * - Must be http: or https:
 * - Hostname must not resolve to a private/internal IP range
 */
async function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported.');
  }

  // Block localhost aliases
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '0.0.0.0') {
    throw new Error('Cannot fetch from localhost or loopback addresses.');
  }

  // Resolve hostname and check for private IP ranges
  try {
    const addresses = await dnsResolve(hostname);
    for (const ip of addresses) {
      if (isPrivateIP(ip)) {
        throw new Error('Cannot fetch from private or internal network addresses.');
      }
    }
  } catch (err) {
    if (err.message.includes('Cannot fetch')) throw err;
    throw new Error(`Could not resolve hostname: ${hostname}`);
  }

  return parsed;
}

/**
 * Check if an IPv4 address is in a private/reserved range.
 */
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true; // not a valid IPv4, block it

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0/8
  if (parts[0] === 0) return true;

  return false;
}

// Unicode fraction map
const FRACTION_MAP = {
  '\u00BD': 0.5,    // ½
  '\u2153': 0.333,  // ⅓
  '\u2154': 0.667,  // ⅔
  '\u00BC': 0.25,   // ¼
  '\u00BE': 0.75,   // ¾
  '\u2155': 0.2,    // ⅕
  '\u2156': 0.4,    // ⅖
  '\u2157': 0.6,    // ⅗
  '\u2158': 0.8,    // ⅘
  '\u2159': 0.167,  // ⅙
  '\u215A': 0.833,  // ⅚
  '\u215B': 0.125,  // ⅛
  '\u215C': 0.375,  // ⅜
  '\u215D': 0.625,  // ⅝
  '\u215E': 0.875,  // ⅞
};

const UNIT_WORDS = new Set([
  'cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'teaspoon', 'teaspoons', 'tsp',
  'ounce', 'ounces', 'oz', 'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g', 'kilogram', 'kilograms', 'kg',
  'milliliter', 'milliliters', 'ml', 'liter', 'liters', 'l', 'litre', 'litres',
  'pinch', 'bunch', 'sprig', 'sprigs', 'clove', 'cloves', 'can', 'cans',
  'piece', 'pieces', 'slice', 'slices', 'head', 'heads', 'stalk', 'stalks',
  'each',
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
  'liter': 'L', 'liters': 'L', 'litre': 'L', 'litres': 'L', 'l': 'L',
  'pinch': 'pinch', 'bunch': 'bunch',
  'sprig': 'each', 'sprigs': 'each',
  'clove': 'each', 'cloves': 'each',
  'can': 'each', 'cans': 'each',
  'piece': 'each', 'pieces': 'each',
  'slice': 'each', 'slices': 'each',
  'head': 'each', 'heads': 'each',
  'stalk': 'each', 'stalks': 'each',
  'each': 'each',
};

function parseFraction(str) {
  str = str.trim();

  // Replace unicode fractions
  for (const [char, val] of Object.entries(FRACTION_MAP)) {
    if (str.includes(char)) {
      const before = str.substring(0, str.indexOf(char)).trim();
      const whole = before ? parseFloat(before) : 0;
      return isNaN(whole) ? val : whole + val;
    }
  }

  // Handle "1 1/2" mixed number
  const mixedMatch = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
  }

  // Handle "1/2" fraction
  const fracMatch = str.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    return parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
  }

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

function parseIngredientString(text) {
  // Strip zero-width / invisible Unicode chars that sneak in from web scraping
  text = text
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip all parenthetical content, looping to handle double/nested parens
  // e.g. ((30 ml)) → first pass strips (30 ml) → () → second pass strips ()
  let prev;
  do { prev = text; text = text.replace(/\([^()]*\)/g, ''); } while (text !== prev);
  text = text.replace(/[()]/g, ''); // remove any unmatched stray parens

  // Same treatment for square brackets
  do { prev = text; text = text.replace(/\[[^\[\]]*\]/g, ''); } while (text !== prev);
  text = text.replace(/[\[\]]/g, '');

  text = text
    // Strip leading bullet / dash / arrow markers
    .replace(/^[\s•·▪▸►\-–—]+/, '')
    // Strip asterisks used as footnote or "optional" markers
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Try to extract leading quantity
  const qtyPattern = /^([\d\u00BC-\u00BE\u2150-\u215E\/\s.]+)/;
  const qtyMatch = text.match(qtyPattern);

  let quantity = 0;
  let remaining = text;

  if (qtyMatch) {
    const parsed = parseFraction(qtyMatch[1]);
    if (parsed !== null && parsed > 0) {
      quantity = Math.round(parsed * 100) / 100;
      remaining = text.substring(qtyMatch[0].length).trim();
    }
  }

  // Try to extract unit word
  let unit = 'each';
  const words = remaining.split(/\s+/);
  if (words.length > 0) {
    const unitWord = words[0].toLowerCase().replace(/,/, '');
    if (UNIT_WORDS.has(unitWord)) {
      unit = UNIT_NORMALIZE[unitWord] || 'each';
      remaining = words.slice(1).join(' ').trim();
    }
  }

  // Strip leading "of "
  remaining = remaining.replace(/^of\s+/i, '');

  // Clean up ingredient name — strip trailing punctuation/special chars
  const name = remaining
    .replace(/[,;:.!\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    name: name || text,
    quantity,
    unit,
    prep_note: '',
  };
}

function extractJsonLdRecipe(html) {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i++) {
    try {
      let data = JSON.parse($(scripts[i]).html());

      // Handle @graph arrays
      if (data['@graph']) {
        data = data['@graph'];
      }

      // Handle arrays
      if (Array.isArray(data)) {
        const recipe = data.find(item =>
          item['@type'] === 'Recipe' ||
          (Array.isArray(item['@type']) && item['@type'].includes('Recipe'))
        );
        if (recipe) return recipe;
      }

      // Single object
      if (data['@type'] === 'Recipe' ||
          (Array.isArray(data['@type']) && data['@type'].includes('Recipe'))) {
        return data;
      }
    } catch (e) {
      continue;
    }
  }
  return null;
}

function extractFromHtml(html) {
  const $ = cheerio.load(html);

  const ingredientSelectors = [
    '.recipe-ingredients li',
    '.ingredients li',
    '[class*="ingredient"] li',
    '.wprm-recipe-ingredient',
    '.tasty-recipe-ingredients li',
    '.recipe__list--ingredients li',
  ];

  let ingredientTexts = [];
  for (const sel of ingredientSelectors) {
    const found = $(sel);
    if (found.length > 0) {
      found.each((_, el) => {
        const text = $(el).text().trim();
        if (text) ingredientTexts.push(text);
      });
      break;
    }
  }

  // Try to get the recipe title
  const titleSelectors = [
    '.recipe-title', '.wprm-recipe-name', '.tasty-recipe-title',
    'h1.entry-title', 'h1', 'h2.recipe-title',
  ];
  let title = '';
  for (const sel of titleSelectors) {
    const el = $(sel).first();
    if (el.length) {
      title = el.text().trim();
      break;
    }
  }

  // Try to get description
  const descSelectors = [
    '.recipe-summary', '.wprm-recipe-summary', '.recipe-description',
    'meta[name="description"]',
  ];
  let description = '';
  for (const sel of descSelectors) {
    const el = $(sel).first();
    if (el.length) {
      description = el.attr('content') || el.text().trim();
      if (description) break;
    }
  }

  if (!ingredientTexts.length && !title) return null;

  return { name: title, description, ingredients: ingredientTexts, instructions: '' };
}

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
  return 'main';
}

async function importRecipe(url) {
  // SSRF protection: validate URL scheme and block private IPs
  await validateUrl(url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MenuPlanner/1.0)',
      'Accept': 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  // Enforce response size limit to prevent memory exhaustion
  const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_RESPONSE_SIZE) {
    throw new Error('Response too large. Maximum supported size is 5 MB.');
  }

  // Read body with size limit (content-length can be missing or lie)
  const reader = response.body.getReader();
  const chunks = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.length;
    if (totalSize > MAX_RESPONSE_SIZE) {
      reader.cancel();
      throw new Error('Response too large. Maximum supported size is 5 MB.');
    }
    chunks.push(value);
  }

  const html = Buffer.concat(chunks).toString('utf-8');

  // Strategy 1: JSON-LD structured data
  const jsonLd = extractJsonLdRecipe(html);
  if (jsonLd) {
    const name = jsonLd.name || '';
    const description = typeof jsonLd.description === 'string'
      ? jsonLd.description.replace(/<[^>]*>/g, '').substring(0, 500)
      : '';

    const rawIngredients = jsonLd.recipeIngredient || jsonLd.ingredients || [];
    const ingredients = rawIngredients.map(text => parseIngredientString(String(text)));

    let instructions = '';
    const directions = [];
    if (typeof jsonLd.recipeInstructions === 'string') {
      instructions = jsonLd.recipeInstructions;
      jsonLd.recipeInstructions.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0)
        .forEach(s => directions.push({ type: 'step', text: s }));
    } else if (Array.isArray(jsonLd.recipeInstructions)) {
      for (const step of jsonLd.recipeInstructions) {
        if (typeof step === 'string') {
          if (step.trim()) directions.push({ type: 'step', text: step.trim() });
        } else if (step && step['@type'] === 'HowToSection') {
          if (step.name) directions.push({ type: 'section', text: step.name });
          if (Array.isArray(step.itemListElement)) {
            for (const sub of step.itemListElement) {
              const text = typeof sub === 'string' ? sub : (sub.text || '');
              if (text.trim()) directions.push({ type: 'step', text: text.trim() });
            }
          }
        } else if (step && step.text) {
          directions.push({ type: 'step', text: step.text.trim() });
        }
      }
      instructions = directions
        .filter(d => d.type === 'step')
        .map(d => d.text)
        .join('\n');
    }

    return {
      name,
      description,
      category: guessCategory(name, description),
      ingredients,
      instructions,
      directions,
      source_url: url,
    };
  }

  // Strategy 2: HTML scraping fallback
  const htmlData = extractFromHtml(html);
  if (htmlData) {
    return {
      name: htmlData.name,
      description: (htmlData.description || '').substring(0, 500),
      category: guessCategory(htmlData.name, htmlData.description),
      ingredients: htmlData.ingredients.map(text => parseIngredientString(text)),
      instructions: htmlData.instructions,
      source_url: url,
    };
  }

  throw new Error('Could not find recipe data on this page. Try a different recipe URL.');
}

module.exports = { importRecipe, parseIngredientString };
