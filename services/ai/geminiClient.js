/**
 * Gemini client factory via Vertex AI.
 * Shares VERTEX_PROJECT_ID and VERTEX_REGION with the Claude client.
 * Used for vision (chef sheet OCR, image extraction) and voice transcription.
 */

const { VertexAI } = require('@google-cloud/vertexai');

let _vertexAI = null;

function getVertexAI() {
  if (_vertexAI) return _vertexAI;
  _vertexAI = new VertexAI({
    project: process.env.VERTEX_PROJECT_ID,
    location: process.env.VERTEX_REGION || 'us-east1',
  });
  return _vertexAI;
}

/**
 * Get a Gemini generative model instance.
 * @param {string} modelName - defaults to 'gemini-2.5-flash'
 * @param {object} options - generationConfig, safetySettings, etc.
 */
function getGeminiModel(modelName = 'gemini-2.5-flash', options = {}) {
  const vertexAI = getVertexAI();
  return vertexAI.getGenerativeModel({
    model: modelName,
    ...options,
  });
}

module.exports = { getGeminiModel };
