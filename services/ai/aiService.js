/**
 * AI Service — thin wrapper around the Anthropic SDK.
 * Single entry point: processCommand(message, context, conversationHistory?)
 * Handles API calls, retries, and usage tracking.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getDb } = require('../../db/database');
const { getToolDefinitions, executeToolHandler } = require('./aiTools');
const { buildContext } = require('./aiContext');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 3;

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
- When a tool matches the user's request, USE IT. Always prefer using tools over just responding with text.
- Be concise and practical — chefs are busy
- Use professional culinary terminology
- When cleaning up recipes, standardize to professional kitchen language
- For unit conversions, use metric where practical but respect the user's preferences`;

  if (context) {
    prompt += '\n\nCURRENT CONTEXT:\n' + context;
  }

  return prompt;
}

/**
 * Main entry point: process a user command through Haiku
 * Returns: { response, toolCall?, preview?, confirmationData? }
 */
async function processCommand(message, pageContext, conversationHistory) {
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
      // Don't retry on timeout or client errors — only on 5xx / transient failures
      const isRetryable = err.status >= 500 || err.status === 429;
      if (attempt === MAX_RETRIES - 1 || !isRetryable) throw err;
      // Exponential backoff: 1s, 2s, 4s
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }

  // Track usage
  const tokensIn = response.usage?.input_tokens || 0;
  const tokensOut = response.usage?.output_tokens || 0;

  // Process response — check for tool use
  let textResponse = '';
  let toolCall = null;

  for (const block of response.content) {
    if (block.type === 'text') {
      textResponse += block.text;
    } else if (block.type === 'tool_use') {
      toolCall = {
        id: block.id,
        name: block.name,
        input: block.input,
      };
    }
  }

  if (toolCall) {
    // Generate preview without executing
    const preview = executeToolHandler(toolCall.name, toolCall.input, { preview: true, pageContext });
    trackUsage(tokensIn, tokensOut, toolCall.name);

    return {
      response: textResponse || preview.message,
      toolCall,
      preview: preview.description,
      confirmationData: {
        toolName: toolCall.name,
        toolInput: toolCall.input,
        pageContext,
      },
    };
  }

  // Text-only response (no tool called)
  trackUsage(tokensIn, tokensOut, null);
  return { response: textResponse };
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

module.exports = {
  processCommand,
  executeConfirmedAction,
  getAiSettings,
  getUsageStats,
  getApiKey,
  checkUsageLimits,
};
