const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { z } = require('zod');

let _model = null;

const RESPONSE_SCHEMA = z.object({
  validate:  z.string().describe('Emotional validation — warm, simple, no question mark'),
  reassure:  z.string().describe('Connecting fact to caregiver context — 1 sentence'),
  redirect:  z.string().describe('Gentle activity/comfort redirection — 1 sentence'),
});

function getModel() {
  if (!_model) {
    _model = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash-lite',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.4,
      maxOutputTokens: 256,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    });
  }
  return _model;
}

/**
 * Returns the model piped through withStructuredOutput for guaranteed JSON shape.
 * Falls back to plain model if structured output is unavailable.
 */
function getStructuredModel() {
  try {
    const model = getModel();
    return model.withStructuredOutput(RESPONSE_SCHEMA);
  } catch {
    return getModel();
  }
}

module.exports = { getModel, getStructuredModel, RESPONSE_SCHEMA };
