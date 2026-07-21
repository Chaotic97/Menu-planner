/**
 * Central AI model IDs — the single source of truth.
 *
 * Change a model here and it takes effect everywhere (aiService, routes/ai,
 * chefsheetService, geminiClient). Previously these strings were duplicated in
 * ~10 places, so a swap meant hunting them all down.
 *
 * CLAUDE_MODEL — Haiku 4.5 is the current, cheapest Claude tier ($1/$5 per
 *   MTok) and the right fit for the high-frequency command bar / chat that runs
 *   tool-calls over kitchen data. To move to a more capable model (e.g. Sonnet 5
 *   for harder agentic reasoning) change this one line. On Vertex AI use the
 *   bare first-party ID (no provider prefix).
 * GEMINI_MODEL — Gemini 2.5 Flash, used for vision (chef-sheet OCR, image
 *   extraction) and voice transcription.
 */
module.exports = {
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  GEMINI_MODEL: 'gemini-2.5-flash',
};
