const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { z } = require('zod');

let _model = null;

const RESPONSE_SCHEMA = z.object({
  validate:  z.string().describe('Names the feeling or need the person expressed, about their own topic; no question mark'),
  reassure:  z.string().describe('One true thing from the notes, routines or time of day, or a presence statement; nothing invented'),
  redirect:  z.string().describe('One small calming action that fits the situation'),
});

function getModel() {
  if (!_model) {
    _model = new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
      apiKey: process.env.GEMINI_API_KEY,
      temperature: 0.7, // variety; the validator enforces the rules
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
