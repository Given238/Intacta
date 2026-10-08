const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

let _model = null;

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

module.exports = { getModel };
