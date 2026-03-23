/**
 * Vertex AI client factory for Claude models.
 * Uses @anthropic-ai/vertex-sdk — same messages API, GCP auth via ADC.
 * Replaces direct @anthropic-ai/sdk usage throughout the codebase.
 */

const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');

let _client = null;

/**
 * Get a cached Claude client authenticated via Application Default Credentials.
 * On GCE, the VM's service account provides credentials automatically.
 */
function getClaudeClient(options = {}) {
  if (_client && !options.timeout) return _client;

  const client = new AnthropicVertex({
    projectId: process.env.VERTEX_PROJECT_ID,
    region: process.env.VERTEX_REGION || 'us-east1',
    ...(options.timeout ? { timeout: options.timeout } : {}),
  });

  if (!options.timeout) _client = client;
  return client;
}

/**
 * Check if Vertex AI is configured (VERTEX_PROJECT_ID is set).
 */
function isConfigured() {
  return !!process.env.VERTEX_PROJECT_ID;
}

module.exports = { getClaudeClient, isConfigured };
