/**
 * ChefSheet Service — processes handwritten kitchen sheets via Claude Vision.
 * Photo → sharp processing → Claude Sonnet structured parse → action execution.
 */

const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');

const MODEL = 'claude-sonnet-4-20250514';
const UPLOADS_DIR = process.env.UPLOADS_PATH || path.join(__dirname, '..', 'uploads');

/**
 * Get the API key from settings table (shared with aiService)
 */
function getApiKey() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_api_key');
  return row ? row.value : null;
}

/**
 * Track usage in the ai_usage table
 */
function trackUsage(tokensIn, tokensOut) {
  const db = getDb();
  db.prepare(
    'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
  ).run(tokensIn, tokensOut, MODEL, 'chefsheet_parse');
}

/**
 * Process uploaded photo: EXIF-rotate, resize, save as JPEG.
 * Returns the filename (not full path).
 */
async function processPhoto(buffer) {
  const filename = `chefsheet-${Date.now()}.jpg`;
  const dest = path.join(UPLOADS_DIR, filename);
  await sharp(buffer)
    .rotate() // Auto-rotate based on EXIF
    .resize({ width: 2400, withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toFile(dest);
  return filename;
}

/**
 * Build the system prompt with current DB context for fuzzy matching.
 */
function buildSystemPrompt() {
  const db = getDb();

  const dishes = db.prepare('SELECT name FROM dishes WHERE deleted_at IS NULL AND is_temporary = 0 ORDER BY name').all();
  const ingredients = db.prepare('SELECT name FROM ingredients ORDER BY name').all();
  const menus = db.prepare('SELECT id, name FROM menus WHERE deleted_at IS NULL ORDER BY name').all();

  const dishNames = dishes.map(d => d.name).join(', ');
  const ingredientNames = ingredients.map(i => i.name).join(', ');
  const menuList = menus.map(m => `${m.name} (id:${m.id})`).join(', ');

  const today = new Date().toISOString().slice(0, 10);

  return `You are a kitchen document parser for PlateStack, a chef-focused menu planning app.

You are analyzing a photo of a handwritten ChefSheet — a freeform notepad that chefs scribble on during shifts. There are no labeled sections. Read every line and classify each item by what the chef meant based on the language they used.

TODAY'S DATE: ${today}
When dates are written as relative terms (e.g. "tomorrow", "Monday", "next week"), resolve them relative to today.

KNOWN DISHES: ${dishNames || '(none)'}
KNOWN INGREDIENTS: ${ingredientNames || '(none)'}
KNOWN MENUS: ${menuList || '(none)'}

CLASSIFICATION GUIDE — figure out the type from how chefs naturally write:
- type "task" — prep work, to-dos, things to do. Signals: action verbs ("prep", "make", "clean", "cut", "set up", "check", "label", "rotate", "defrost"), time references ("by 3pm", "before service", "morning").
- type "service_note" — shift communications, heads-up for the team. Signals: guest info ("VIP", "allergy", "party of"), service alerts ("86", "low on", "sold out"), reminders ("don't forget", "tell FOH", "remind").
- type "menu_change" — adding or removing dishes from a menu. Signals: "add X to Y", "86 the X", "swap X for Y", "new special", "pull", "remove". Usually references a known dish or menu name.
- type "order" — supply/ingredient orders to place. Signals: quantities + supplier language ("order", "need", "call for", "5kg", "2 cases", "restock").
- type "recipe_note" — notes about a specific dish's technique or recipe. Signals: references a dish name + cooking details ("try adding", "reduce by", "too salty", "needs more", "change to").

RULES:
- Match dish/ingredient/menu names to the known lists above. Use the closest fuzzy match.
- If handwriting is unclear, set confidence to "low" and include your best guess in raw_text.
- Each action must have a type, raw_text (the original handwritten text), and parsed fields.
- For dates, output ISO format (YYYY-MM-DD). If no date is mentioned, use today's date.
- Be concise in parsed content — chefs write in shorthand.
- Kitchen abbreviations: "86" = out of stock/remove, "VIP" = important guest, "SOS" = sauce on side, "GF" = gluten free, "FOH" = front of house, "BOH" = back of house.
- If a line doesn't clearly fit a category, default to "task" — it's the safest catch-all.
- Group related consecutive lines into a single action when they clearly belong together.`;
}

/**
 * Parse a chefsheet photo using Claude Vision with structured output.
 * Returns the parsed actions array.
 */
async function parseSheet(imagePath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key configured. Set up your Anthropic API key in Settings.');
  }

  const fullPath = path.join(UPLOADS_DIR, imagePath);
  const imageBuffer = fs.readFileSync(fullPath);
  const base64Image = imageBuffer.toString('base64');
  const mediaType = 'image/jpeg';

  const client = new Anthropic({ apiKey, timeout: 120 * 1000 });
  const systemPrompt = buildSystemPrompt();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Image },
        },
        {
          type: 'text',
          text: 'Parse this ChefSheet photo. Extract all handwritten items into structured actions. Return a JSON object with an "actions" array.',
        },
      ],
    }],
    output_format: {
      type: 'json_schema',
      json_schema: {
        name: 'chefsheet_parse',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            actions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['task', 'service_note', 'menu_change', 'order', 'recipe_note'],
                  },
                  raw_text: { type: 'string' },
                  confidence: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                  },
                  parsed: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      content: { type: 'string' },
                      date: { type: 'string' },
                      shift: { type: 'string' },
                      dish_name: { type: 'string' },
                      menu_name: { type: 'string' },
                      action: { type: 'string' },
                      priority: { type: 'string' },
                      timing_bucket: { type: 'string' },
                    },
                    required: ['title'],
                    additionalProperties: false,
                  },
                },
                required: ['type', 'raw_text', 'confidence', 'parsed'],
                additionalProperties: false,
              },
            },
          },
          required: ['actions'],
          additionalProperties: false,
        },
      },
    },
  });

  const tokensIn = response.usage?.input_tokens || 0;
  const tokensOut = response.usage?.output_tokens || 0;
  trackUsage(tokensIn, tokensOut);

  // Extract JSON from response
  let parsed;
  for (const block of response.content) {
    if (block.type === 'text') {
      parsed = JSON.parse(block.text);
      break;
    }
  }

  if (!parsed || !Array.isArray(parsed.actions)) {
    throw new Error('Failed to parse ChefSheet — unexpected response format');
  }

  return {
    actions: parsed.actions,
    model: MODEL,
    tokensIn,
    tokensOut,
  };
}

/**
 * Execute confirmed actions — creates entities in the database.
 * Returns execution results and summary.
 */
function executeActions(chefsheetId, actions, broadcastFn) {
  const db = getDb();
  const results = [];
  const summary = { tasks: 0, service_notes: 0, menu_changes: 0, orders: 0, recipe_notes: 0 };

  for (const action of actions) {
    if (action.excluded) continue;

    try {
      switch (action.type) {
      case 'task': {
        const title = action.parsed.title || action.raw_text;
        const date = action.parsed.date || new Date().toISOString().slice(0, 10);
        const priority = action.parsed.priority || 'medium';
        const timingBucket = action.parsed.timing_bucket || 'during_service';
        const result = db.prepare(
          'INSERT INTO tasks (title, type, source, priority, due_date, timing_bucket) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(title, 'custom', 'manual', priority, date, timingBucket);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
        results.push({ type: 'task', id: result.lastInsertRowid, title });
        summary.tasks++;
        if (broadcastFn) broadcastFn('task_created', task);
        break;
      }
      case 'service_note': {
        const title = action.parsed.title || '';
        const content = action.parsed.content || action.raw_text;
        const date = action.parsed.date || new Date().toISOString().slice(0, 10);
        const shift = action.parsed.shift || 'all';
        const validShifts = ['all', 'am', 'lunch', 'pm', 'prep'];
        const safeShift = validShifts.includes(shift) ? shift : 'all';
        const result = db.prepare(
          'INSERT INTO service_notes (title, content, date, shift) VALUES (?, ?, ?, ?)'
        ).run(title, content, date, safeShift);
        const note = db.prepare('SELECT * FROM service_notes WHERE id = ?').get(result.lastInsertRowid);
        results.push({ type: 'service_note', id: result.lastInsertRowid, title: title || content.slice(0, 40) });
        summary.service_notes++;
        if (broadcastFn) broadcastFn('service_note_created', note);
        break;
      }
      case 'menu_change': {
        const menuName = action.parsed.menu_name;
        const dishName = action.parsed.dish_name;
        const changeAction = (action.parsed.action || 'add').toLowerCase();

        if (!menuName || !dishName) {
          results.push({ type: 'menu_change', error: 'Missing menu or dish name', raw: action.raw_text });
          break;
        }

        const menu = db.prepare('SELECT id FROM menus WHERE name LIKE ? AND deleted_at IS NULL').get(`%${menuName}%`);
        const dish = db.prepare('SELECT id FROM dishes WHERE name LIKE ? AND deleted_at IS NULL').get(`%${dishName}%`);

        if (!menu || !dish) {
          results.push({ type: 'menu_change', error: `Could not find ${!menu ? 'menu' : 'dish'}`, raw: action.raw_text });
          break;
        }

        if (changeAction === 'remove' || changeAction === '86') {
          db.prepare('DELETE FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').run(menu.id, dish.id);
          results.push({ type: 'menu_change', action: 'removed', menuId: menu.id, dishId: dish.id });
          if (broadcastFn) broadcastFn('menu_updated', { id: menu.id });
        } else {
          const existing = db.prepare('SELECT 1 FROM menu_dishes WHERE menu_id = ? AND dish_id = ?').get(menu.id, dish.id);
          if (!existing) {
            const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as max FROM menu_dishes WHERE menu_id = ?').get(menu.id);
            db.prepare('INSERT INTO menu_dishes (menu_id, dish_id, sort_order, servings) VALUES (?, ?, ?, 1)').run(menu.id, dish.id, maxSort.max + 1);
          }
          results.push({ type: 'menu_change', action: 'added', menuId: menu.id, dishId: dish.id });
          if (broadcastFn) broadcastFn('menu_updated', { id: menu.id });
        }
        summary.menu_changes++;
        break;
      }
      case 'order': {
        const title = `[ORDER] ${action.parsed.title || action.raw_text}`;
        const date = action.parsed.date || new Date().toISOString().slice(0, 10);
        const result = db.prepare(
          'INSERT INTO tasks (title, type, source, priority, due_date) VALUES (?, ?, ?, ?, ?)'
        ).run(title, 'custom', 'manual', 'high', date);
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
        results.push({ type: 'order', id: result.lastInsertRowid, title });
        summary.orders++;
        if (broadcastFn) broadcastFn('task_created', task);
        break;
      }
      case 'recipe_note': {
        const dishName = action.parsed.dish_name;
        const note = action.parsed.content || action.raw_text;

        if (!dishName) {
          results.push({ type: 'recipe_note', error: 'No dish specified', raw: action.raw_text });
          break;
        }

        const dish = db.prepare('SELECT id, chefs_notes FROM dishes WHERE name LIKE ? AND deleted_at IS NULL').get(`%${dishName}%`);
        if (!dish) {
          results.push({ type: 'recipe_note', error: `Dish not found: ${dishName}`, raw: action.raw_text });
          break;
        }

        const existingNotes = dish.chefs_notes || '';
        const separator = existingNotes ? '\n\n' : '';
        const dateStamp = new Date().toISOString().slice(0, 10);
        const updatedNotes = `${existingNotes}${separator}[${dateStamp}] ${note}`;
        db.prepare('UPDATE dishes SET chefs_notes = ? WHERE id = ?').run(updatedNotes, dish.id);
        results.push({ type: 'recipe_note', dishId: dish.id, note });
        summary.recipe_notes++;
        if (broadcastFn) broadcastFn('dish_updated', { id: dish.id });
        break;
      }
      }
    } catch (err) {
      results.push({ type: action.type, error: err.message, raw: action.raw_text });
    }
  }

  return { results, summary };
}

module.exports = {
  processPhoto,
  parseSheet,
  executeActions,
};
