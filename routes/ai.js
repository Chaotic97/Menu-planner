/**
 * AI routes — command processing, confirmation, undo, settings, usage.
 */

const express = require('express');
const multer = require('multer');
const { getDb } = require('../db/database');
const asyncHandler = require('../middleware/asyncHandler');
const { createRateLimit } = require('../middleware/rateLimit');
const { processCommand, processCommandStream, executeConfirmedAction, getAiSettings, getUsageStats, checkUsageLimits } = require('../services/ai/aiService');
const { getClaudeClient, isConfigured } = require('../services/ai/vertexClient');
const { restoreSnapshot, cleanupOldSnapshots } = require('../services/ai/aiHistory');
const { extractText } = require('../services/textExtractor');

// File upload for text extraction (10MB limit, memory storage)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
 * Call Anthropic to clean up directions for a dish.
 * Shared by the dedicated cleanup-recipe endpoint and the command bar confirm flow.
 * Returns the parsed cleaned directions array.
 */
async function fetchCleanedDirections(dishId) {
  if (!isConfigured()) throw new Error('Vertex AI not configured');

  const db = await getDb();
  const dish = await db.prepare('SELECT id, name, chefs_notes FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
  if (!dish) throw new Error('Dish not found');

  const directions = await db.prepare(
    'SELECT id, type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
  ).all(dishId);

  const ingredients = await db.prepare(
    `SELECT di.quantity, di.unit, i.name, di.prep_note
     FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id
     WHERE di.dish_id = ? ORDER BY di.sort_order`
  ).all(dishId);

  if (!directions.length && !dish.chefs_notes) {
    throw new Error('No directions to clean up');
  }

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

  const client = getClaudeClient({ timeout: 45 * 1000 });

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

ONLY output the JSON array, nothing else.`,
    messages: [{
      role: 'user',
      content: `Clean up these directions for "${dish.name}".\n\nIngredients: ${ingredientList || 'Not specified'}\n\nCurrent directions:\n${currentText}`,
    }],
  });

  // Track usage
  const tokensIn = response.usage?.input_tokens || 0;
  const tokensOut = response.usage?.output_tokens || 0;
  await db.prepare(
    'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
  ).run(tokensIn, tokensOut, 'claude-haiku-4-5-20251001', 'cleanup_recipe');

  const text = response.content[0]?.text || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('Failed to parse AI response');

  const cleanedDirections = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(cleanedDirections) || !cleanedDirections.length) {
    throw new Error('AI returned empty directions');
  }

  for (const dir of cleanedDirections) {
    if (!dir.type || !dir.text) throw new Error('AI returned malformed directions');
    if (dir.type !== 'step' && dir.type !== 'section') dir.type = 'step';
  }

  return cleanedDirections;
}

/**
 * POST /api/ai/command — Main entry point
 * Body: { message, context: { page, entityType?, entityId? }, conversationHistory? }
 */
router.post('/command', aiRateLimit, asyncHandler(async (req, res) => {
  const { message, context, conversationHistory, approvedTools } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const options = {};
    if (Array.isArray(approvedTools) && approvedTools.length) {
      options.approvedTools = approvedTools.filter(t => typeof t === 'string');
    }
    const result = await processCommand(message.trim(), context, conversationHistory, req.broadcast, options);

    // If needs setup or rate limited
    if (result.needsSetup || result.rateLimited) {
      return res.json({
        response: result.response,
        needsSetup: result.needsSetup || false,
        rateLimited: result.rateLimited || false,
      });
    }

    // Tool call that needs confirmation — store it (check before autoExecuted
    // because chained results can have both flags when auto-approved tools ran
    // before hitting a non-auto-approved tool that needs confirmation)
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

    // Auto-executed tool (no confirmation needed)
    if (result.autoExecuted) {
      const toolResult = result.toolResult || {};
      return res.json({
        response: result.response,
        autoExecuted: true,
        toolName: result.toolName,
        undoId: toolResult.undoId || null,
        entityType: toolResult.entityType,
        entityId: toolResult.entityId,
        navigateTo: toolResult.navigateTo || null,
      });
    }

    // Text-only response
    return res.json({ response: result.response });
  } catch (err) {
    console.error('AI command error:', err);

    // Handle specific Vertex AI / Anthropic API errors
    if (err.status === 401 || err.status === 403) {
      return res.status(400).json({ error: 'Vertex AI authentication failed. Check the VM service account permissions.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'API rate limit reached. Please try again in a moment.' });
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
 * POST /api/ai/stream — SSE streaming endpoint for chat drawer.
 * Body: { message, context, conversationHistory? }
 * Sends SSE events: text_delta, tool_start, tool_result, text_clear, confirmation, error, done
 */
router.post('/stream', aiRateLimit, asyncHandler(async (req, res) => {
  const { message, context, conversationHistory, approvedTools } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let confirmationId = null;

  function emit(event, data) {
    // Store confirmation if needed
    if (event === 'confirmation' && data.confirmationData) {
      confirmationId = generateConfirmationId();
      pendingActions.set(confirmationId, {
        data: data.confirmationData,
        createdAt: Date.now(),
      });
      data.confirmationId = confirmationId;
      delete data.confirmationData;
    }
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // Handle client disconnect
  let aborted = false;
  req.on('close', () => { aborted = true; });

  const options = {};
  if (Array.isArray(approvedTools) && approvedTools.length) {
    options.approvedTools = approvedTools.filter(t => typeof t === 'string');
  }

  try {
    await processCommandStream(
      message.trim(),
      context,
      conversationHistory,
      req.broadcast,
      (event, data) => {
        if (!aborted) emit(event, data);
      },
      options
    );
  } catch (err) {
    if (!aborted) {
      emit('error', { message: err.message || 'AI request failed' });
      emit('done', {});
    }
  }

  if (!aborted) res.end();
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
    // When cleanup_recipe comes from the command bar, it has no cleaned_directions yet.
    // We need to call Anthropic to get them before executing.
    if (pending.data.toolName === 'cleanup_recipe' && !pending.data.toolInput.cleaned_directions) {
      const cleanedDirections = await fetchCleanedDirections(pending.data.toolInput.dish_id);
      pending.data.toolInput.cleaned_directions = cleanedDirections;
    }

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

  const result = await restoreSnapshot(historyId, req.broadcast);

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

  if (!isConfigured()) {
    return res.status(400).json({ error: 'Vertex AI is not configured on the server.' });
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const db = await getDb();
  const dish = await db.prepare('SELECT id, name, chefs_notes FROM dishes WHERE id = ? AND deleted_at IS NULL').get(dishId);
  if (!dish) {
    return res.status(404).json({ error: 'Dish not found' });
  }

  const directions = await db.prepare(
    'SELECT id, type, text, sort_order FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
  ).all(dishId);

  if (!directions.length && !dish.chefs_notes) {
    return res.status(400).json({ error: 'This dish has no directions to clean up.' });
  }

  try {
    const cleanedDirections = await fetchCleanedDirections(dishId);

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

  if (!isConfigured()) {
    return res.status(400).json({ error: 'Vertex AI is not configured on the server.' });
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const db = await getDb();

  // Get existing ingredients for matching
  const existing = await db.prepare('SELECT id, name, base_unit, category FROM ingredients').all();
  const existingNames = existing.map(i => `"${i.name}" (ID:${i.id})`).join(', ');

  const inputNames = ingredients.map(i => i.name).join('\n');

  const client = getClaudeClient({ timeout: 45 * 1000 });

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
    await db.prepare(
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
router.get('/usage', asyncHandler(async (req, res) => {
  const stats = await getUsageStats();
  res.json(stats);
}));

/**
 * GET /api/ai/suggestions — Dynamic command bar hints based on current data
 */
router.get('/suggestions', asyncHandler(async (req, res) => {
  const { buildSuggestionHints } = require('../services/ai/aiContext');
  const page = req.query.page || '';
  const hints = await buildSuggestionHints(page);
  res.json({ suggestions: hints });
}));

/**
 * GET /api/ai/settings — Get AI config
 */
router.get('/settings', asyncHandler(async (req, res) => {
  const settings = await getAiSettings();

  res.json({
    configured: settings.configured,
    features: settings.features,
    dailyLimit: settings.dailyLimit,
    monthlyLimit: settings.monthlyLimit,
  });
}));

/**
 * POST /api/ai/settings — Save AI config
 * Body: { features?, dailyLimit?, monthlyLimit? }
 */
router.post('/settings', asyncHandler(async (req, res) => {
  const db = await getDb();
  const { features, dailyLimit, monthlyLimit } = req.body;

  if (features !== undefined) {
    const featJson = JSON.stringify(features);
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run('ai_features', featJson);
  }

  if (dailyLimit !== undefined) {
    const val = String(Math.max(0, parseInt(dailyLimit) || 0));
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run('ai_daily_limit', val);
  }

  if (monthlyLimit !== undefined) {
    const val = String(Math.max(0, parseInt(monthlyLimit) || 0));
    await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value').run('ai_monthly_limit', val);
  }

  res.json({ success: true });
}));

/**
 * POST /api/ai/extract-text — Extract text from an uploaded file
 * Accepts: PDF, DOCX, CSV, XLSX, images
 * Returns: { text, type } or { base64, mediaType, type } for images
 */
router.post('/extract-text', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const result = await extractText(req.file.buffer, req.file.originalname, req.file.mimetype);

    if (result.type === 'unknown') {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // For images, use Gemini Flash vision to extract text
    if (result.type === 'image') {
      if (!isConfigured()) {
        return res.status(400).json({ error: 'Vertex AI is not configured on the server.' });
      }

      const limitCheck = await checkUsageLimits();
      if (!limitCheck.allowed) {
        return res.status(429).json({ error: limitCheck.reason });
      }

      const { getGeminiModel } = require('../services/ai/geminiClient');
      const model = getGeminiModel();

      const geminiResult = await model.generateContent({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: result.mediaType, data: result.base64 } },
            { text: 'Extract ALL text content from this image. If it contains a menu, recipe, ingredient list, invoice, or pricing — format it as structured text. Include all numbers, prices, quantities, and names exactly as they appear.' },
          ],
        }],
      });

      const geminiResponse = geminiResult.response;
      const tokensIn = geminiResponse.usageMetadata?.promptTokenCount || 0;
      const tokensOut = geminiResponse.usageMetadata?.candidatesTokenCount || 0;

      const db = await getDb();
      await db.prepare(
        'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
      ).run(tokensIn, tokensOut, 'gemini-2.5-flash', 'extract_image_text');

      const extractedText = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.json({ text: extractedText, type: 'image' });
    }

    if (!result.text) {
      return res.status(400).json({ error: 'Could not extract text from this file.' });
    }

    return res.json({ text: result.text, type: result.type });
  } catch (err) {
    console.error('Text extraction error:', err);
    return res.status(500).json({ error: 'Failed to extract text from file.' });
  }
}));

// ─── Voice Transcription (Gemini Flash) ──────────────────────────

/**
 * POST /api/ai/voice — Transcribe audio via Gemini Flash
 * Accepts audio blob (multipart/form-data from MediaRecorder)
 * Returns: { text }
 */
router.post('/voice', upload.single('audio'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  if (!isConfigured()) {
    return res.status(400).json({ error: 'Vertex AI is not configured on the server.' });
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const { getGeminiModel } = require('../services/ai/geminiClient');
  const { buildContext } = require('../services/ai/aiContext');

  const context = req.body.context ? JSON.parse(req.body.context) : {};
  let contextStr = '';
  try {
    contextStr = await buildContext(context);
  } catch {}

  const model = getGeminiModel();
  const base64Audio = req.file.buffer.toString('base64');
  const mimeType = req.file.mimetype || 'audio/webm';

  const systemInstruction = `You are a kitchen voice assistant for PlateStack. Transcribe the chef's spoken command accurately. Return ONLY the transcribed text — no commentary, no formatting, no quotes.${contextStr ? '\n\nContext: ' + contextStr : ''}`;

  try {
    const result = await model.generateContent({
      systemInstruction,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64Audio } },
          { text: 'Transcribe this audio.' },
        ],
      }],
    });

    const response = result.response;
    const tokensIn = response.usageMetadata?.promptTokenCount || 0;
    const tokensOut = response.usageMetadata?.candidatesTokenCount || 0;

    const db = await getDb();
    await db.prepare(
      'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
    ).run(tokensIn, tokensOut, 'gemini-2.5-flash', 'voice_transcription');

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ text: text.trim() });
  } catch (err) {
    console.error('Voice transcription error:', err);
    return res.status(500).json({ error: 'Voice transcription failed. Please try again.' });
  }
}));

// ─── Chat Conversations ──────────────────────────────────────────

/**
 * GET /api/ai/conversations — list all conversations (newest first)
 */
router.get('/conversations', asyncHandler(async (req, res) => {
  const db = await getDb();
  const conversations = await db.prepare(
    'SELECT id, title, created_at, updated_at FROM ai_conversations ORDER BY updated_at DESC'
  ).all();
  res.json(conversations);
}));

/**
 * POST /api/ai/conversations — create a new conversation
 */
router.post('/conversations', asyncHandler(async (req, res) => {
  const db = await getDb();
  const { title } = req.body || {};
  const result = await db.prepare('INSERT INTO ai_conversations (title) VALUES (?)').run(title || '');
  res.status(201).json({ id: result.lastInsertRowid });
}));

/**
 * GET /api/ai/conversations/:id/messages — get messages for a conversation
 */
router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const db = await getDb();
  const conv = await db.prepare('SELECT id FROM ai_conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const messages = await db.prepare(
    'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);
  res.json(messages);
}));

/**
 * POST /api/ai/conversations/:id/messages — add a message to a conversation
 */
router.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
  const db = await getDb();
  const conv = await db.prepare('SELECT id FROM ai_conversations WHERE id = ?').get(req.params.id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { role, content } = req.body;
  if (!role || !content) {
    return res.status(400).json({ error: 'role and content are required' });
  }

  const result = await db.prepare(
    'INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)'
  ).run(req.params.id, role, content);

  // Update conversation timestamp and auto-title from first user message
  await db.prepare("UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?").run(req.params.id);
  if (role === 'user') {
    const existing = await db.prepare('SELECT title FROM ai_conversations WHERE id = ?').get(req.params.id);
    if (!existing.title) {
      const shortTitle = content.slice(0, 60) + (content.length > 60 ? '...' : '');
      await db.prepare('UPDATE ai_conversations SET title = ? WHERE id = ?').run(shortTitle, req.params.id);
    }
  }

  res.status(201).json({ id: result.lastInsertRowid });
}));

/**
 * DELETE /api/ai/conversations/:id — delete a conversation
 */
router.delete('/conversations/:id', asyncHandler(async (req, res) => {
  const db = await getDb();
  const result = await db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ success: true });
}));

// ─── AI Task Generation ─────────────────────────────────────────

/**
 * POST /api/ai/generate-tasks/:menuId — AI-powered task generation
 * Uses Haiku to analyze menu dishes and create practical, grouped task lists.
 * Replaces the existing basic auto-generate.
 */
router.post('/generate-tasks/:menuId', aiRateLimit, asyncHandler(async (req, res) => {
  const menuId = parseInt(req.params.menuId);
  if (isNaN(menuId)) {
    return res.status(400).json({ error: 'Invalid menu ID' });
  }

  if (!isConfigured()) {
    return res.status(400).json({ error: 'Vertex AI is not configured on the server.' });
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    return res.status(429).json({ error: limitCheck.reason });
  }

  const db = await getDb();
  const menu = await db.prepare('SELECT id, name FROM menus WHERE id = ? AND deleted_at IS NULL').get(menuId);
  if (!menu) {
    return res.status(404).json({ error: 'Menu not found' });
  }

  // Gather all dish data for the menu
  const dishes = await db.prepare(`
    SELECT d.id, d.name, d.category, d.chefs_notes, d.batch_yield, md.servings
    FROM menu_dishes md
    JOIN dishes d ON d.id = md.dish_id
    WHERE md.menu_id = ? AND d.deleted_at IS NULL
    ORDER BY md.sort_order
  `).all(menuId);

  if (!dishes.length) {
    return res.status(400).json({ error: 'Menu has no dishes.' });
  }

  // For each dish, get ingredients and directions
  const dishDetails = [];
  for (const dish of dishes) {
    const ingredients = await db.prepare(
      `SELECT di.quantity, di.unit, i.name, di.prep_note
       FROM dish_ingredients di JOIN ingredients i ON di.ingredient_id = i.id
       WHERE di.dish_id = ? ORDER BY di.sort_order`
    ).all(dish.id);

    const directions = await db.prepare(
      'SELECT type, text FROM dish_directions WHERE dish_id = ? ORDER BY sort_order'
    ).all(dish.id);

    dishDetails.push({
      name: dish.name,
      category: dish.category,
      servings: dish.servings,
      batch_yield: dish.batch_yield,
      ingredients: ingredients.map(i => {
        const qty = i.quantity ? `${i.quantity}${i.unit ? ' ' + i.unit : ''}` : '';
        return `${qty} ${i.name}${i.prep_note ? ' (' + i.prep_note + ')' : ''}`.trim();
      }),
      directions: directions.map(d => d.type === 'section' ? `[${d.text}]` : d.text),
      chefs_notes: dish.chefs_notes || '',
    });
  }

  const menuSummary = dishDetails.map(d => {
    let detail = `## ${d.name} (${d.category || 'other'}, ${d.servings} batch${d.servings !== 1 ? 'es' : ''})`;
    if (d.ingredients.length) detail += '\nIngredients: ' + d.ingredients.join(', ');
    if (d.directions.length) detail += '\nDirections:\n' + d.directions.join('\n');
    else if (d.chefs_notes) detail += '\nChef notes: ' + d.chefs_notes;
    return detail;
  }).join('\n\n');

  try {
    const client = getClaudeClient({ timeout: 45 * 1000 });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You are a head chef creating a practical prep task list for your kitchen team. You take a full menu with recipes and create realistic, actionable tasks that a cook would actually check off during their shift.

RULES:
- Group related prep into single tasks. "Make beurre blanc" NOT "Dice shallots", "Reduce wine", "Mount butter" separately.
- Use practical kitchen language: "Prep all salad components", "Butcher and portion fish", "Make and chill dessert base"
- Each task should be something a cook would check off as DONE — a complete unit of work
- Include quantities/batch info when useful: "Make beurre blanc (2L)" or "Portion salmon x20"
- Order tasks by when they need to start (long braises/marinades first, last-minute items last)
- Combine small related items: "Prep garnishes (microgreens, lemon zest, herb oil)" rather than 3 separate tasks
- For simple dishes with few steps, one task per dish is fine: "Make vinaigrette"
- For complex dishes, break into 2-3 logical stages: "Braise short ribs (start early)", "Make jus from braising liquid", "Prep garnish for short ribs"

Return a JSON array of task objects. Each has:
- "title": the task description (concise, practical)
- "priority": "high" (must start early/critical path), "medium" (standard), "low" (can wait)
- "dish": name of the primary dish this task is for (or null if it spans multiple dishes)

ONLY output the JSON array, nothing else.`,
      messages: [{
        role: 'user',
        content: `Create a prep task list for the "${menu.name}" menu:\n\n${menuSummary}`,
      }],
    });

    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    await db.prepare(
      'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
    ).run(tokensIn, tokensOut, 'claude-haiku-4-5-20251001', 'generate_tasks');

    const text = response.content[0]?.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI returned invalid response. Please try again.' });
    }

    let aiTasks;
    try {
      aiTasks = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON. Please try again.' });
    }

    if (!Array.isArray(aiTasks) || !aiTasks.length) {
      return res.status(500).json({ error: 'AI returned empty task list.' });
    }

    // Build a dish name → id map
    const dishIdMap = new Map();
    for (const d of dishes) {
      dishIdMap.set(d.name.toLowerCase(), d.id);
    }

    // Delete existing auto-generated tasks for this menu
    await db.prepare('DELETE FROM tasks WHERE menu_id = ? AND source = ?').run(menuId, 'auto');

    // Insert AI-generated tasks
    const VALID_PRIORITIES = ['high', 'medium', 'low'];

    let inserted = 0;
    for (let i = 0; i < aiTasks.length; i++) {
      const t = aiTasks[i];
      if (!t.title || typeof t.title !== 'string') continue;

      const priority = VALID_PRIORITIES.includes(t.priority) ? t.priority : 'medium';
      let dishId = null;
      if (t.dish) {
        dishId = dishIdMap.get(t.dish.toLowerCase()) || null;
      }

      await db.prepare(
        'INSERT INTO tasks (menu_id, source_dish_id, type, title, priority, source, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(menuId, dishId, 'prep', t.title.trim(), priority, 'auto', i);
      inserted++;
    }

    req.broadcast('tasks_generated', { menu_id: menuId, total: inserted }, req.headers['x-client-id']);
    res.status(201).json({ menu_id: menuId, prep_count: inserted, total: inserted, ai_generated: true });

  } catch (err) {
    console.error('AI task generation error:', err);
    return res.status(500).json({ error: 'AI task generation failed. Please try again.' });
  }
}));

// Clean up old snapshots on startup
cleanupOldSnapshots().catch(() => {});

module.exports = router;
