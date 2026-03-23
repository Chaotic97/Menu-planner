/**
 * AI Service — thin wrapper around the Anthropic SDK.
 * Single entry point: processCommand(message, context, conversationHistory?)
 * Handles API calls, retries, and usage tracking.
 */

const { getClaudeClient, isConfigured } = require('./vertexClient');
const { getDb } = require('../../db/database');
const { getToolDefinitions, executeToolHandler, isAutoApproved } = require('./aiTools');
const { buildContext } = require('./aiContext');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 3;
const MAX_TOOL_ROUNDS = 15;

// Context cache — avoids redundant DB queries for consecutive messages on same page
let _cachedContext = { key: null, value: null, time: 0 };
const CONTEXT_CACHE_TTL = 30000; // 30 seconds

function getCachedContext(pageContext) {
  const key = pageContext ? `${pageContext.page}:${pageContext.entityType}:${pageContext.entityId}` : '';
  if (_cachedContext.key === key && Date.now() - _cachedContext.time < CONTEXT_CACHE_TTL) {
    return _cachedContext.value;
  }
  return null;
}

function setCachedContext(pageContext, value) {
  const key = pageContext ? `${pageContext.page}:${pageContext.entityType}:${pageContext.entityId}` : '';
  _cachedContext = { key, value, time: Date.now() };
}

function invalidateContextCache() {
  _cachedContext = { key: null, value: null, time: 0 };
}

/**
 * Get AI feature settings
 */
async function getAiSettings() {
  const db = await getDb();
  const featRow = await db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_features');
  const dailyRow = await db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_daily_limit');
  const monthlyRow = await db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_monthly_limit');

  return {
    configured: isConfigured(),
    features: featRow ? JSON.parse(featRow.value) : { cleanup: true, matching: true, allergens: true, scaling: true },
    dailyLimit: dailyRow ? parseInt(dailyRow.value) : 0,
    monthlyLimit: monthlyRow ? parseInt(monthlyRow.value) : 0,
  };
}

/**
 * Check usage limits. Returns { allowed: bool, reason?: string }
 */
async function checkUsageLimits() {
  const db = await getDb();
  const settings = await getAiSettings();

  if (settings.dailyLimit > 0) {
    const todayRow = await db.prepare(
      "SELECT COUNT(*) as cnt FROM ai_usage WHERE created_at >= CURRENT_DATE"
    ).get();
    if (todayRow.cnt >= settings.dailyLimit) {
      return { allowed: false, reason: 'Daily AI usage limit reached. Adjust in Settings.' };
    }
  }

  if (settings.monthlyLimit > 0) {
    const monthRow = await db.prepare(
      "SELECT COUNT(*) as cnt FROM ai_usage WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)::date"
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
async function trackUsage(tokensIn, tokensOut, toolUsed) {
  const db = await getDb();
  await db.prepare(
    'INSERT INTO ai_usage (tokens_in, tokens_out, model, tool_used) VALUES (?, ?, ?, ?)'
  ).run(tokensIn, tokensOut, MODEL, toolUsed || null);
}

/**
 * Get usage stats
 */
async function getUsageStats() {
  const db = await getDb();

  const today = await db.prepare(
    "SELECT COUNT(*) as requests, COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out FROM ai_usage WHERE created_at >= CURRENT_DATE"
  ).get();

  const month = await db.prepare(
    "SELECT COUNT(*) as requests, COALESCE(SUM(tokens_in), 0) as tokens_in, COALESCE(SUM(tokens_out), 0) as tokens_out FROM ai_usage WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)::date"
  ).get();

  const settings = await getAiSettings();

  return {
    today: { requests: today.requests, tokens_in: today.tokens_in, tokens_out: today.tokens_out },
    month: { requests: month.requests, tokens_in: month.tokens_in, tokens_out: month.tokens_out },
    limits: { daily: settings.dailyLimit, monthly: settings.monthlyLimit },
  };
}

/**
 * Build the system prompt for Haiku
 */
// Static portion of system prompt — cached by Anthropic's prompt caching
const SYSTEM_PROMPT_BASE = `You are a kitchen assistant in PlateStack, a chef-focused menu planning app.

RULES:
- ALWAYS use tools when they match the request. Never guess data — look it up.
- Chain tools as needed (e.g. lookup_menu → lookup_dish for allergen checks).
- Be concise. Chefs are busy.
- Use professional culinary language.
- When the user skips or rejects an action, move on immediately.
- If a document is uploaded, analyze it and suggest next actions.`;

function buildSystemPrompt(context) {
  let prompt = SYSTEM_PROMPT_BASE;

  if (context) {
    prompt += '\n\nCONTEXT:\n' + context;
  }

  return prompt;
}

/**
 * Call the Anthropic API with retry logic
 */
async function callApi(client, systemPrompt, tools, messages) {
  let response;
  // Mark tools for prompt caching — last tool gets cache_control breakpoint
  const cachedTools = tools.length ? tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
  ) : tools;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: cachedTools,
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
 * @param {string} message
 * @param {object} pageContext
 * @param {Array} conversationHistory
 * @param {Function} broadcast
 * @param {object} options - { approvedTools?: string[] } — tools the user has pre-approved for this session
 * Returns: { response, autoExecuted?, toolCall?, preview?, confirmationData?, toolResults? }
 */
async function processCommand(message, pageContext, conversationHistory, broadcast, options = {}) {
  if (!isConfigured()) {
    return { response: 'Vertex AI is not configured. Set VERTEX_PROJECT_ID on the server.', needsSetup: true };
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    return { response: limitCheck.reason, rateLimited: true };
  }

  const client = getClaudeClient({ timeout: 45 * 1000 });
  let context = getCachedContext(pageContext);
  if (context === null) {
    context = await buildContext(pageContext);
    setCachedContext(pageContext, context);
  }
  const systemPrompt = buildSystemPrompt(context);
  const tools = getToolDefinitions(pageContext);

  const messages = [];
  if (conversationHistory && conversationHistory.length) {
    for (const entry of conversationHistory) {
      if (entry && typeof entry.role === 'string' && entry.content &&
          (entry.role === 'user' || entry.role === 'assistant')) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  // Agentic loop: Haiku can call auto-approved tools up to MAX_TOOL_ROUNDS times
  const executedTools = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const sessionApproved = new Set(options.approvedTools || []);

  function isEffectivelyAutoApproved(name) {
    return isAutoApproved(name) || sessionApproved.has(name);
  }

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
      await trackUsage(totalTokensIn, totalTokensOut, toolNames);

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

    // Tool call: check if auto-approved (built-in or session-approved)
    if (isEffectivelyAutoApproved(toolCall.name) && round < MAX_TOOL_ROUNDS) {
      // Execute immediately and feed result back to Haiku
      let result;
      try {
        result = await executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      } catch (toolErr) {
        console.error(`Tool ${toolCall.name} failed:`, toolErr);
        const errorMessage = `Tool error: ${toolErr.message || 'execution failed'}`;
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: errorMessage, is_error: true }],
        });
        continue;
      }
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      if (result.undoId) invalidateContextCache();

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
    if (isEffectivelyAutoApproved(toolCall.name)) {
      let result;
      try {
        result = await executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      } catch (toolErr) {
        console.error(`Tool ${toolCall.name} failed on final round:`, toolErr);
        await trackUsage(totalTokensIn, totalTokensOut, null);
        return { response: `Action failed: ${toolErr.message || 'unknown error'}` };
      }
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      if (result.undoId) invalidateContextCache();
      const toolNames = executedTools.map(t => t.name).join(',');
      await trackUsage(totalTokensIn, totalTokensOut, toolNames);

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
    await trackUsage(totalTokensIn, totalTokensOut, toolNames ? toolNames + ',' + toolCall.name : toolCall.name);

    const preview = await executeToolHandler(toolCall.name, toolCall.input, { preview: true, pageContext });

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
  await trackUsage(totalTokensIn, totalTokensOut, null);
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
async function processCommandStream(message, pageContext, conversationHistory, broadcast, emit, options = {}) {
  if (!isConfigured()) {
    emit('error', { message: 'Vertex AI is not configured. Set VERTEX_PROJECT_ID on the server.' });
    emit('done', {});
    return;
  }

  const limitCheck = await checkUsageLimits();
  if (!limitCheck.allowed) {
    emit('error', { message: limitCheck.reason });
    emit('done', {});
    return;
  }

  const client = getClaudeClient({ timeout: 60 * 1000 });
  let context = getCachedContext(pageContext);
  if (context === null) {
    context = await buildContext(pageContext);
    setCachedContext(pageContext, context);
  }
  const systemPrompt = buildSystemPrompt(context);
  const tools = getToolDefinitions(pageContext);

  const messages = [];
  if (conversationHistory && conversationHistory.length) {
    for (const entry of conversationHistory) {
      if (entry && typeof entry.role === 'string' && entry.content &&
          (entry.role === 'user' || entry.role === 'assistant')) {
        messages.push({ role: entry.role, content: entry.content });
      }
    }
  }
  messages.push({ role: 'user', content: message });

  const executedTools = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const sessionApproved = new Set(options.approvedTools || []);

  function isEffectivelyAutoApproved(name) {
    return isAutoApproved(name) || sessionApproved.has(name);
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    // Emit progress event so the client can show step numbers (1F)
    if (round > 0) {
      emit('progress', { round });
    }

    let textResponse = '';
    let toolCall = null;
    let tokensIn = 0;
    let tokensOut = 0;

    // Mark tools for prompt caching
    const cachedTools = tools.length ? tools.map((t, i) =>
      i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' } } : t
    ) : tools;
    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        tools: cachedTools,
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
        } catch (parseErr) {
          console.warn(`Failed to parse tool input JSON for ${toolCall.name}:`, parseErr.message);
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
      await trackUsage(totalTokensIn, totalTokensOut, toolNames);

      emit('done', {
        fullText: textResponse,
        autoExecuted: executedTools.length > 0,
        toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
      });
      return;
    }

    // Tool call: auto-approved (built-in or session-approved)?
    if (isEffectivelyAutoApproved(toolCall.name) && round < MAX_TOOL_ROUNDS) {
      let result;
      try {
        result = await executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      } catch (toolErr) {
        console.error(`Tool ${toolCall.name} failed:`, toolErr);
        // Feed the error back to the model so it can recover
        const errorMessage = `Tool error: ${toolErr.message || 'execution failed'}`;
        emit('tool_result', { name: toolCall.name, message: errorMessage });
        const assistantContent = [];
        if (textResponse) assistantContent.push({ type: 'text', text: textResponse });
        assistantContent.push({ type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input });
        messages.push({ role: 'assistant', content: assistantContent });
        messages.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: errorMessage, is_error: true }],
        });
        textResponse = '';
        emit('text_clear', {});
        continue;
      }
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      if (result.undoId) invalidateContextCache();
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
    if (isEffectivelyAutoApproved(toolCall.name)) {
      let result;
      try {
        result = await executeToolHandler(toolCall.name, toolCall.input, { preview: false, pageContext, broadcast });
      } catch (toolErr) {
        console.error(`Tool ${toolCall.name} failed on final round:`, toolErr);
        const toolNamesStr = executedTools.map(t => t.name).join(',') || null;
        await trackUsage(totalTokensIn, totalTokensOut, toolNamesStr);
        emit('error', { message: `Action failed: ${toolErr.message || 'unknown error'}` });
        emit('done', {});
        return;
      }
      executedTools.push({ name: toolCall.name, input: toolCall.input, result });
      if (result.undoId) invalidateContextCache();
      emit('tool_result', { name: toolCall.name, message: result.message });

      const toolNamesStr = executedTools.map(t => t.name).join(',');
      await trackUsage(totalTokensIn, totalTokensOut, toolNamesStr);

      emit('done', {
        fullText: textResponse || result.message,
        autoExecuted: true,
        toolResults: executedTools.map(t => ({ name: t.name, result: t.result })),
      });
      return;
    }

    // Non-auto-approved — needs confirmation
    const toolNamesStr = executedTools.map(t => t.name).join(',') || null;
    await trackUsage(totalTokensIn, totalTokensOut, toolNamesStr ? toolNamesStr + ',' + toolCall.name : toolCall.name);

    const preview = await executeToolHandler(toolCall.name, toolCall.input, { preview: true, pageContext });

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

  await trackUsage(totalTokensIn, totalTokensOut, null);
  emit('error', { message: 'Processing limit reached. Please try again.' });
  emit('done', {});
}

module.exports = {
  processCommand,
  processCommandStream,
  executeConfirmedAction,
  getAiSettings,
  getUsageStats,
  checkUsageLimits,
  buildSystemPrompt,
  buildContext: require('./aiContext').buildContext,
};
