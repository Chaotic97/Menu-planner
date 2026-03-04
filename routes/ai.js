/**
 * AI routes — command processing, confirmation, undo, settings, usage.
 */

const express = require('express');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');
const { createRateLimit } = require('../middleware/rateLimit');
const { processCommand, executeConfirmedAction, getAiSettings, getUsageStats, getApiKey, checkUsageLimits } = require('../services/ai/aiService');
const { restoreSnapshot, cleanupOldSnapshots } = require('../services/ai/aiHistory');

const router = express.Router();

// Rate limit AI commands: 30 per minute
const aiRateLimit = createRateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many AI requests. Please slow down.' });

// In-memory store for pending confirmations (auto-expire after 5 min)
const pendingActions = new Map();
const PENDING_TTL = 5 * 60 * 1000;

function generateConfirmationId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Periodically clean expired pending actions
setInterval(() => {
  const now = Date.now();
  for (const [id, action] of pendingActions) {
    if (now - action.createdAt > PENDING_TTL) {
      pendingActions.delete(id);
    }
  }
}, 60 * 1000);

/**
 * POST /api/ai/command — Main entry point
 * Body: { message, context: { page, entityType?, entityId? }, conversationHistory? }
 */
router.post('/command', aiRateLimit, asyncHandler(async (req, res) => {
  const { message, context, conversationHistory } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const result = await processCommand(message.trim(), context, conversationHistory);

    // If there's a tool call that needs confirmation, store it
    if (result.confirmationData) {
      const confirmationId = generateConfirmationId();
      pendingActions.set(confirmationId, {
        data: result.confirmationData,
        createdAt: Date.now(),
      });

      return res.json({
        response: result.response,
        preview: result.preview,
        confirmationId,
        toolName: result.toolCall.name,
      });
    }

    // If needs setup or rate limited
    if (result.needsSetup || result.rateLimited) {
      return res.json({
        response: result.response,
        needsSetup: result.needsSetup || false,
        rateLimited: result.rateLimited || false,
      });
    }

    // Text-only response
    return res.json({ response: result.response });
  } catch (err) {
    console.error('AI command error:', err);

    // Handle specific Anthropic API errors
    if (err.status === 401) {
      return res.status(400).json({ error: 'Invalid API key. Please check your Anthropic API key in Settings.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'Anthropic API rate limit reached. Please try again in a moment.' });
    }
    if (err.status === 400) {
      return res.status(400).json({ error: 'AI request failed: ' + (err.message || 'Bad request') });
    }
    if (err.name === 'APIConnectionTimeoutError' || err.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'AI request timed out. The API may be slow — please try again.' });
    }

    return res.status(500).json({ error: 'AI request failed. Please try again.' });
  }
}));

/**
 * POST /api/ai/confirm/:id — Execute a confirmed action
 */
router.post('/confirm/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const pending = pendingActions.get(id);

  if (!pending) {
    return res.status(404).json({ error: 'Confirmation expired or not found. Please try again.' });
  }

  pendingActions.delete(id);

  try {
    const result = await executeConfirmedAction(pending.data, req.broadcast);

    if (result.success === false) {
      return res.json({ response: result.message, success: false });
    }

    return res.json({
      response: result.message,
      success: true,
      undoId: result.undoId || null,
      entityType: result.entityType,
      entityId: result.entityId,
      navigateTo: result.navigateTo || null,
    });
  } catch (err) {
    console.error('AI confirm error:', err);
    return res.status(500).json({ error: 'Failed to execute action. Please try again.' });
  }
}));

/**
 * POST /api/ai/undo/:id — Undo an AI action
 */
router.post('/undo/:id', asyncHandler(async (req, res) => {
  const historyId = parseInt(req.params.id);
  if (isNaN(historyId)) {
    return res.status(400).json({ error: 'Invalid undo ID' });
  }

  const result = restoreSnapshot(historyId, req.broadcast);

  if (!result.success) {
    return res.status(404).json({ error: result.message });
  }

  return res.json({ success: true, message: result.message });
}));

/**
 * POST /api/ai/cleanup-recipe/:dishId — Two-step recipe cleanup
 * Step 1: Returns before/after preview
 * Step 2 (confirm): Applies the cleaned directions
 */
router.post('/cleanup-recipe/:dishId', aiRateLimit, asyncHandler(async (req, res) => {
  const dishId = parseInt(req.params.dishId);
  if (isNaN(dishId)) {
    return res.status(400).json({ error: 'Invalid dish ID' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(400).json({ error: 'Please set up your Anthropic API key in Settings.' });
  }

  const limitCheck = checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const db = getDb();
  const dish = db.prepare('SELECT id, name, chefs_notes FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
  if (!dish) {
    return res.status(404).json({ error: 'Dish not found' });
  }

  const directions = db.prepare(
    'SELECT id, type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
  ).all(dishId);

  const ingredients = db.prepare(
    `SELECT di.quantity, di.unit, i.name, di.prep_note
     FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id
     WHERE di.dish_id = ? ORDER BY di.sort_order`
  ).all(dishId);

  if (!directions.length && !dish.chefs_notes) {
    return res.status(400).json({ error: 'This dish has no directions to clean up.' });
  }

  // Build the text to clean up
  let currentText;
  if (directions.length) {
    currentText = directions.map(d => d.type === 'section' ? `[SECTION: ${d.text}]` : d.text).join('\n');
  } else {
    currentText = dish.chefs_notes;
  }

  const ingredientList = ingredients.map(i => {
    const qty = i.quantity ? `${i.quantity}${i.unit ? ' ' + i.unit : ''}` : '';
    return `${qty} ${i.name}${i.prep_note ? ' (' + i.prep_note + ')' : ''}`.trim();
  }).join(', ');

  // Send to Haiku for cleanup
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 45 * 1000 });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You are a professional chef helping clean up recipe directions. Your job is to:
- Standardize culinary terminology (e.g., "chop real fine" → "brunoise", "put in pan" → "sauté in")
- Ensure steps are clear, concise, and well-structured
- Keep the same cooking process — do NOT change what is being done, only how it's described
- Use professional kitchen language
- Include timing where implied (e.g., "cook until golden" → "cook 3-4 minutes until golden")
- Group related steps under section headers if the recipe is complex (6+ steps)
- Preserve all important details — temperatures, quantities, visual cues

Return a JSON array of direction objects. Each object has:
- "type": either "step" or "section"
- "text": the direction text

Example output:
[
  {"type": "section", "text": "Mise en Place"},
  {"type": "step", "text": "Brunoise the shallots and mince the garlic."},
  {"type": "step", "text": "Season the salmon fillets with salt, pepper, and a squeeze of lemon."},
  {"type": "section", "text": "Cooking"},
  {"type": "step", "text": "Heat olive oil in a heavy-based pan over medium-high heat until shimmering."}
]

ONLY output the JSON array, nothing else.`,
      messages: [{
        role: 'user',
        content: `Clean up these directions for "${dish.name}".\n\nIngredients: ${ingredientList || 'Not specified'}\n\nCurrent directions:\n${currentText}`,
      }],
    });

    // Track usage
    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    db.prepare(
      'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
    ).run(tokensIn, tokensOut, 'claude-haiku-4-5-20251001', 'cleanup_recipe');

    // Parse the response
    const text = response.content[0]?.text || '';
    let cleanedDirections;
    try {
      // Try to extract JSON from the response (might have markdown code fences)
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        cleanedDirections = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON array found');
      }
    } catch {
      return res.status(500).json({ error: 'Failed to parse AI response. Please try again.' });
    }

    // Validate the response
    if (!Array.isArray(cleanedDirections) || !cleanedDirections.length) {
      return res.status(500).json({ error: 'AI returned empty directions. Please try again.' });
    }

    for (const dir of cleanedDirections) {
      if (!dir.type || !dir.text) {
        return res.status(500).json({ error: 'AI returned malformed directions. Please try again.' });
      }
      if (dir.type !== 'step' && dir.type !== 'section') {
        dir.type = 'step';
      }
    }

    // Build before text for diff
    const before = directions.length
      ? directions.map(d => d.type === 'section' ? `[${d.text}]` : d.text)
      : (dish.chefs_notes || '').split('\n').filter(l => l.trim());

    const after = cleanedDirections.map(d => d.type === 'section' ? `[${d.text}]` : d.text);

    // Store for confirmation
    const confirmationId = generateConfirmationId();
    pendingActions.set(confirmationId, {
      data: {
        toolName: 'cleanup_recipe',
        toolInput: { dish_id: dishId, cleaned_directions: cleanedDirections },
        pageContext: { page: `#/dishes/${dishId}/edit`, entityType: 'dish', entityId: dishId },
      },
      createdAt: Date.now(),
    });

    return res.json({
      before,
      after,
      dishName: dish.name,
      confirmationId,
    });
  } catch (err) {
    console.error('Cleanup recipe error:', err);
    if (err.status === 401) {
      return res.status(400).json({ error: 'Invalid API key.' });
    }
    return res.status(500).json({ error: 'AI request failed. Please try again.' });
  }
}));

/**
 * POST /api/ai/match-ingredients — Smart ingredient matching for imports
 * Body: { ingredients: [{ name, quantity?, unit? }] }
 * Returns: { matches: [{ input_name, matched_id?, matched_name?, confidence }] }
 */
router.post('/match-ingredients', aiRateLimit, asyncHandler(async (req, res) => {
  const { ingredients } = req.body;
  if (!Array.isArray(ingredients) || !ingredients.length) {
    return res.status(400).json({ error: 'Ingredients array is required' });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(400).json({ error: 'AI features require an API key.' });
  }

  const limitCheck = checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const db = getDb();

  // Get existing ingredients for matching
  const existing = db.prepare('SELECT id, name, base_unit, category FROM ingredients').all();
  const existingNames = existing.map(i => `"${i.name}" (ID:${i.id})`).join(', ');

  const inputNames = ingredients.map(i => i.name).join('\n');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, timeout: 45 * 1000 });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: `You match imported recipe ingredient names to existing ingredients in a database. For each input name, find the best match from the existing list, or indicate no match.

Return a JSON array where each element has:
- "input_name": the original input name
- "matched_id": the ID of the best matching existing ingredient (null if no good match)
- "matched_name": name of the matched ingredient (null if no match)
- "confidence": "high", "medium", or "low"

Rules:
- "Extra-virgin olive oil" matches "Olive Oil" = high confidence
- "Garlic cloves" matches "Garlic" = high confidence
- "Panko breadcrumbs" matches "Breadcrumbs" = medium confidence
- If no reasonable match exists, set matched_id to null
- Only match if the core ingredient is the same
- ONLY output the JSON array, nothing else.`,
      messages: [{
        role: 'user',
        content: `Existing ingredients:\n${existingNames}\n\nMatch these imported ingredients:\n${inputNames}`,
      }],
    });

    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    db.prepare(
      'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
    ).run(tokensIn, tokensOut, 'claude-haiku-4-5-20251001', 'match_ingredients');

    const text = response.content[0]?.text || '';
    let matches;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      matches = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      matches = [];
    }

    return res.json({ matches });
  } catch (err) {
    console.error('Ingredient matching error:', err);
    return res.status(500).json({ error: 'AI matching failed. You can still add ingredients manually.' });
  }
}));

/**
 * GET /api/ai/usage — Usage stats
 */
router.get('/usage', (req, res) => {
  const stats = getUsageStats();
  res.json(stats);
});

/**
 * GET /api/ai/settings — Get AI config (key masked)
 */
router.get('/settings', (req, res) => {
  const db = getDb();
  const settings = getAiSettings();

  // Mask the API key for display
  const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_api_key');
  let maskedKey = '';
  if (keyRow && keyRow.value) {
    const key = keyRow.value;
    maskedKey = key.slice(0, 10) + '...' + key.slice(-4);
  }

  res.json({
    apiKey: maskedKey,
    hasApiKey: settings.hasApiKey,
    features: settings.features,
    dailyLimit: settings.dailyLimit,
    monthlyLimit: settings.monthlyLimit,
  });
});

/**
 * POST /api/ai/settings — Save AI config
 * Body: { apiKey?, features?, dailyLimit?, monthlyLimit? }
 */
router.post('/settings', asyncHandler(async (req, res) => {
  const db = getDb();
  const { apiKey, features, dailyLimit, monthlyLimit } = req.body;

  if (apiKey !== undefined) {
    if (apiKey === '') {
      // Clear the key
      db.prepare("DELETE FROM settings WHERE key = 'ai_api_key'").run();
    } else {
      // Validate key format
      if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
        return res.status(400).json({ error: 'Invalid API key format. Key should start with "sk-".' });
      }
      const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('ai_api_key');
      if (existing) {
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(apiKey, 'ai_api_key');
      } else {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai_api_key', apiKey);
      }
    }
  }

  if (features !== undefined) {
    const featJson = JSON.stringify(features);
    const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('ai_features');
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(featJson, 'ai_features');
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai_features', featJson);
    }
  }

  if (dailyLimit !== undefined) {
    const val = String(Math.max(0, parseInt(dailyLimit) || 0));
    const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('ai_daily_limit');
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(val, 'ai_daily_limit');
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai_daily_limit', val);
    }
  }

  if (monthlyLimit !== undefined) {
    const val = String(Math.max(0, parseInt(monthlyLimit) || 0));
    const existing = db.prepare('SELECT 1 FROM settings WHERE key = ?').get('ai_monthly_limit');
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(val, 'ai_monthly_limit');
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ai_monthly_limit', val);
    }
  }

  res.json({ success: true });
}));

// Clean up old snapshots on startup
try { cleanupOldSnapshots(); } catch {}

module.exports = router;
