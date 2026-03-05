/**
 * AI Service — thin wrapper around the Anthropic SDK.
 * Single entry point: processCommand(message, context, conversationHistory?)
 * Handles API calls, retries, and usage tracking.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../../db/database');
const { getToolDefinitions, executeToolHandler, isAutoApproved } = require('./aiTools');
const { buildContext } = require('./aiContext');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 3;
const MAX_TOOL_ROUNDS = 5;

/**
 * Get the API key from settings table
 */
function getApiKey() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_api_key');
  return row ? row.value : null;
}

/**
 * Get AI feature settings
 */
function getAiSettings() {
  const db = getDb();
  const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_api_key');
  const featRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_features');
  const dailyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_daily_limit');
  const monthlyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_monthly_limit');

  return {
    hasApiKey: !!(keyRow && keyRow.value),
    features: featRow ? JSON.parse(featRow.value) : { cleanup: true, matching: true, allergens: true, scaling: true },
    dailyLimit: dailyRow ? parseInt(dailyRow.value) : 0,
    monthlyLimit: monthlyRow ? parseInt(monthlyRow.value) : 0,
  };
}

/**
 * Check usage limits. Returns { allowed: bool, reason?: string }
 */
function checkUsageLimits() {
  const db = getDb();
  const settings = getAiSettings();

  if (settings.dailyLimit > 0) {
    const todayRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM ai_usage WHERE created_at >= date('now')"
    ).get();
    if (todayRow.cnt >= settings.dailyLimit) {
      return { allowed: false, reason: 'Daily AI usage limit reached. Adjust in Settings.' };
    }
  }

  if (settings.monthlyLimit > 0) {
    const monthRow = db.prepare(
      "SELECT COUNT(*) as cnt FROM ai_usage WHERE created_at >= date('now', 'start of month')"
    ).get();
    if (monthRow.cnt >= settings.monthlyLimit) {
      return { allowed: false, reason: 'Monthly AI usage limit reached. Adjust in Settings.' };
    }
  }

  return { allowed: true };
}

/**
 * Track usage in the ai_usage table
 */
function trackUsage(tokensIn, tokensOut, toolUsed) {
  const db = getDb();
  db.prepare(
    'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
  ).run(tokensIn, tokensOut, MODEL, toolUsed || null);
}

/**
 * Get usage stats
 */
function getUsageStats() {
  const db = getDb();

  const today = db.prepare(
    "SELECT COUNT(*) as requests, COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out FROM ai_usage WHERE created_at >= date('now')"
  ).get();

  const month = db.prepare(
    "SELECT COUNT(*) as requests, COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out FROM ai_usage WHERE created_at >= date('now', 'start of month')"
  ).get();

  const settings = getAiSettings();

  return {
    today: { requests: today.requests, tokens_in: today.tokens_in, tokens_out: today.tokens_out },
    month: { requests: month.requests, tokens_in: month.tokens_in, tokens_out: month.tokens_out },
    limits: { daily: settings.dailyLimit, monthly: settings.monthlyLimit },
  };
}

/**
 * Build the system prompt for Haiku
 */
function buildSystemPrompt(context) {
  let prompt = `You are a helpful kitchen assistant built into PlateStack, a chef-focused menu planning app. You help with recipe cleanup, menu management, task creation, and general kitchen workflow.

IMPORTANT RULES:
- You are embedded in a cooking/menu planning application
- When a tool matches the user's request, ALWAYS use it. Never respond with just text when a tool could answer the question better.
- You can call multiple tools in sequence. For example, to answer "what allergens are on the Friday menu?", first use lookup_menu to get the dishes, then use lookup_dish for each one to check allergens.
- For questions about specific dishes, menus, ingredients, or tasks — ALWAYS use the lookup/search tools to get real data. Never guess or make up information.
- Be concise and practical — chefs are busy. Keep responses short and actionable.
- Use professional culinary terminology
- When presenting data from tools, format it clearly with key information highlighted
- When cleaning up recipes, standardize to professional kitchen language
- For unit conversions, use metric where practical but respect the user's preferences
- If the user uploads a document (menu, invoice, recipe), analyze it thoroughly and suggest next actions (e.g. "I found 5 dishes — want me to create them?")

AVAILABLE ACTIONS:
- Search, list, and look up: dishes, menus, ingredients, tasks, service notes, shopping lists, specials, tags
- Create: dishes, menus, tasks, service notes, ingredients, weekly specials (tasks/notes/ingredients auto-execute; dishes/menus/specials need confirmation)
- Update: dishes (name, category, price, batch yield), menus (name, price, covers, allergies, date), tasks, ingredients (cost, unit), service notes, servings on menus
- Delete: dishes (soft), menus (soft), tasks, service notes, remove dishes from menus
- Quick actions: toggle favorites, toggle ingredient stock, complete/uncomplete tasks, batch-complete tasks, duplicate dishes
- Allergens: add/remove allergen flags, check allergens with AI analysis, view menu-wide allergen breakdown
- Analysis: food cost analysis per menu, pricing suggestions, dietary suitability analysis
- Advisory: dish pairing suggestions, ingredient substitutions, recipe scaling advice, unit conversions
- Recipe building: add/remove ingredients on dishes, add direction steps/sections, add/remove tags
- Workflow: generate prep tasks for a menu, clean up recipe directions with AI`;

  if (context) {
    prompt += '\n\nCURRENT CONTEXT:\n' + context;
  }

  return prompt;
}

/**
 * Call the Anthropic API with retry logic
 */
async function callApi(client, systemPrompt, tools, messages) {
  let response;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      });
      break;
    } catch (err) {
      const isRetryable = err.status >= 500 || err.status === 429;
      if (attempt === MAX_RETRIES - 1 || !isRetryable) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  return response;
}

/**
 * Main entry point: process a user command through Haiku.
 * Supports multi-step tool chaining (up to MAX_TOOL_ROUNDS auto-approved tool calls).
 * Returns: { response, autoExecuted?, toolCall?, preview?, confirmationData?, toolResults? }
 */
async function processCommand(message, pageContext, conversationHistory, broadcast) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { response: 'Please set up your Anthropic API key in Settings to use AI features.', needsSetup: true };
  }

  const limitCheck = checkUsageLimits();
  if (!limitCheck.allowed) {
    return { response: limitCheck.reason, rateLimited: true };
  }

  const client = new Anthropic({ apiKey, timeout: 45 * 1000 });
  const context = await buildContext(pageContext);
  const systemPrompt = buildSystemPrompt(context);
  const tools = getToolDefinitions();

  const messages = [];
  if (conversationHistory && conversationHistory.length) {
    messages.push(...conversationHistory);
  }
  messages.push({ role: 'user', content: message });

  // Agentic loop: Haiku can call auto-approved tools up to MAX_TOOL_ROUNDS times
  const executedTools = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    const response = await callApi(client, systemPrompt, tools, messages);

    const tokensIn = response.usage?.input_tokens || 0;
    const tokensOut = response.usage?.output_tokens || 0;
    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;

    // Extract text and tool_use blocks
    let textResponse = '';
    let toolCall = null;

    for (const block of response.content) {
      if (block.type === 'text') {
        textResponse += block.text;
      } else if (block.type === 'tool_use') {
        toolCall = { id: block.id, name: block.name, input: block.input };
      }
    }

    // No tool call — return text response (final answer)
    if (!toolCall) {
      const toolNames = executedTools.map(t => t.name).join(',') || null;
      trackUsage(totalTokensIn, totalTokensOut, toolNames);

      if (executedTools.length > 0) {
        // Had auto-executed tools in earlier rounds, now Haiku gave final answer
        const lastMutating = executedTools.filter(t => t.result.undoId);
        const lastResult = lastMutating.length ? lastMutating[lastMutating.length - 1].result : null;
        return {
          response: textResponse,
          autoExecuted: true,
          toolName: executedTools.map(t => t.name).join(', '),
          toolResult: lastResult || executedTools[executedTools.length - 1].result,
          toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
        };
      }

      return { response: textResponse };
    }

    // Tool call: check if auto-approved
    if (isAutoApproved(toolCall.name) && round < MAX_TOOL_ROUNDS) {
      // Execute immediately and feed result back to Haiku
      const result = executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });

      // Append assistant message (with tool_use) + tool_result for next round
      messages.push({ role: 'assistant', content: response.content });
      messages.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: result.message,
        }],
      });
      // Continue loop — Haiku will see the result and decide what to do next
      continue;
    }

    // Auto-approved tool on final allowed round — execute but don't loop
    if (isAutoApproved(toolCall.name)) {
      const result = executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      const toolNames = executedTools.map(t => t.name).join(',');
      trackUsage(totalTokensIn, totalTokensOut, toolNames);

      const lastMutating = executedTools.filter(t => t.result.undoId);
      const lastResult = lastMutating.length ? lastMutating[lastMutating.length - 1].result : null;
      return {
        response: textResponse || result.message,
        autoExecuted: true,
        toolName: executedTools.map(t => t.name).join(', '),
        toolResult: lastResult || result,
        toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
      };
    }

    // Non-auto-approved tool — needs confirmation (stops the loop)
    const toolNames = executedTools.map(t => t.name).join(',') || null;
    trackUsage(totalTokensIn, totalTokensOut, toolNames ? toolNames + ',' + toolCall.name : toolCall.name);

    const preview = executeToolHandler(toolCall.name, toolCall.input, { preview: true, pageContext });

    return {
      response: textResponse || preview.message,
      toolCall,
      preview: preview.description,
      confirmationData: {
        toolName: toolCall.name,
        toolInput: toolCall.input,
        pageContext,
      },
      // Include any auto-executed results from earlier rounds
      toolResults: executedTools.length ? executedTools.map(t => ({ name: t.name, result: t.result })) : undefined,
      autoExecuted: executedTools.length > 0 ? true : undefined,
    };
  }

  // Safety fallback (shouldn't reach here)
  trackUsage(totalTokensIn, totalTokensOut, null);
  return { response: 'I ran into an issue processing that request. Please try again.' };
}

/**
 * Execute a confirmed tool action
 * Returns: { result, undoId? }
 */
async function executeConfirmedAction(confirmationData, broadcast) {
  const { toolName, toolInput, pageContext } = confirmationData;
  const result = await executeToolHandler(toolName, toolInput, { preview: false, pageContext, broadcast });
  return result;
}

/**
 * Streaming entry point for chat drawer.
 * Calls Haiku with streaming enabled and emits SSE events via the callback.
 * Supports the same agentic tool loop as processCommand.
 * @param {string} message
 * @param {object} pageContext
 * @param {Array} conversationHistory
 * @param {Function} broadcast
 * @param {Function} emit - callback(eventType, data) for SSE events
 */
async function processCommandStream(message, pageContext, conversationHistory, broadcast, emit) {
  const apiKey = getApiKey();
  if (!apiKey) {
    emit('error', { message: 'Please set up your Anthropic API key in Settings to use AI features.' });
    emit('done', {});
    return;
  }

  const limitCheck = checkUsageLimits();
  if (!limitCheck.allowed) {
    emit('error', { message: limitCheck.reason });
    emit('done', {});
    return;
  }

  const client = new Anthropic({ apiKey, timeout: 60 * 1000 });
  const context = await buildContext(pageContext);
  const systemPrompt = buildSystemPrompt(context);
  const tools = getToolDefinitions();

  const messages = [];
  if (conversationHistory && conversationHistory.length) {
    messages.push(...conversationHistory);
  }
  messages.push({ role: 'user', content: message });

  const executedTools = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    let textResponse = '';
    let toolCall = null;
    let tokensIn = 0;
    let tokensOut = 0;

    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            toolCall = { id: event.content_block.id, name: event.content_block.name, input: '' };
            emit('tool_start', { name: event.content_block.name });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            textResponse += event.delta.text;
            emit('text_delta', { text: event.delta.text });
          } else if (event.delta.type === 'input_json_delta' && toolCall) {
            toolCall.input += event.delta.partial_json;
          }
        } else if (event.type === 'message_delta') {
          tokensOut = event.usage?.output_tokens || 0;
        } else if (event.type === 'message_start') {
          tokensIn = event.message?.usage?.input_tokens || 0;
        }
      }

      // Parse tool input JSON if we got one
      if (toolCall && typeof toolCall.input === 'string') {
        try {
          toolCall.input = JSON.parse(toolCall.input);
        } catch {
          toolCall.input = {};
        }
      }
    } catch (err) {
      const isRetryable = err.status >= 500 || err.status === 429;
      if (isRetryable && round === 0) {
        // One retry for the streaming call
        await new Promise(r => setTimeout(r, 2000));
        try {
          const response = await callApi(client, systemPrompt, tools, messages);
          tokensIn = response.usage?.input_tokens || 0;
          tokensOut = response.usage?.output_tokens || 0;
          for (const block of response.content) {
            if (block.type === 'text') {
              textResponse += block.text;
              emit('text_delta', { text: block.text });
            } else if (block.type === 'tool_use') {
              toolCall = { id: block.id, name: block.name, input: block.input };
              emit('tool_start', { name: block.name });
            }
          }
        } catch (retryErr) {
          emit('error', { message: retryErr.message || 'AI request failed' });
          emit('done', {});
          return;
        }
      } else {
        emit('error', { message: err.message || 'AI request failed' });
        emit('done', {});
        return;
      }
    }

    totalTokensIn += tokensIn;
    totalTokensOut += tokensOut;

    // No tool call — final text response
    if (!toolCall) {
      const toolNames = executedTools.map(t => t.name).join(',') || null;
      trackUsage(totalTokensIn, totalTokensOut, toolNames);

      emit('done', {
        fullText: textResponse,
        autoExecuted: executedTools.length > 0,
        toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
      });
      return;
    }

    // Tool call: auto-approved?
    if (isAutoApproved(toolCall.name) && round < MAX_TOOL_ROUNDS) {
      const result = executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      emit('tool_result', { name: toolCall.name, message: result.message });

      // Build messages for next round
      const assistantContent = [];
      if (textResponse) assistantContent.push({ type: 'text', text: textResponse });
      assistantContent.push({ type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input });
      messages.push({ role: 'assistant', content: assistantContent });
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: result.message }],
      });

      // Reset text for next round
      textResponse = '';
      emit('text_clear', {});
      continue;
    }

    // Auto-approved on final round
    if (isAutoApproved(toolCall.name)) {
      const result = executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      emit('tool_result', { name: toolCall.name, message: result.message });

      const toolNamesStr = executedTools.map(t => t.name).join(',');
      trackUsage(totalTokensIn, totalTokensOut, toolNamesStr);

      emit('done', {
        fullText: textResponse || result.message,
        autoExecuted: true,
        toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
      });
      return;
    }

    // Non-auto-approved — needs confirmation
    const toolNamesStr = executedTools.map(t => t.name).join(',') || null;
    trackUsage(totalTokensIn, totalTokensOut, toolNamesStr ? toolNamesStr + ',' + toolCall.name : toolCall.name);

    const preview = executeToolHandler(toolCall.name, toolCall.input, { preview: true, pageContext });

    emit('confirmation', {
      toolName: toolCall.name,
      preview: preview.description,
      message: textResponse || preview.message,
      confirmationData: {
        toolName: toolCall.name,
        toolInput: toolCall.input,
        pageContext,
      },
    });
    emit('done', {});
    return;
  }

  trackUsage(totalTokensIn, totalTokensOut, null);
  emit('error', { message: 'Processing limit reached. Please try again.' });
  emit('done', {});
}

module.exports = {
  processCommand,
  processCommandStream,
  executeConfirmedAction,
  getAiSettings,
  getUsageStats,
  getApiKey,
  checkUsageLimits,
  buildSystemPrompt,
  buildContext: require('./aiContext').buildContext,
};
