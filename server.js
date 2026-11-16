
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const MODELS = [
  PRIMARY_MODEL,
  'gemini-3.7-flash',
  'gemini-3.5-flash-lite'
].filter((model, index, list) => model && list.indexOf(model) === index);

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'KarkiAI',
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function askGemini(model, apiKey, contents) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      systemInstruction: {
        parts: [{
          text: 'You are KarkiAI, a helpful, capable, friendly general-purpose AI assistant. Answer clearly and professionally. Be accurate, explain uncertainty honestly, and use readable Markdown when helpful. Never claim to browse the web or perform actions unless the app provides that capability.'
        }]
      },
      contents,
      generationConfig: {
        maxOutputTokens: 4096
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: 'Gemini API key is missing. Add GEMINI_API_KEY in Render Environment.'
    });
  }

  const incoming = req.body?.messages;

  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({
      error: 'Please send a message.'
    });
  }

  const contents = incoming.slice(-20).map(message => ({
    role: message?.role === 'model' ? 'model' : 'user',
    parts: [{
      text: String(message?.text || '').slice(0, 12000)
    }]
  })).filter(message => message.parts[0].text.trim());

  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    return res.status(400).json({
      error: 'The latest message must be from you.'
    });
  }

  try {
    for (let i = 0; i < MODELS.length; i++) {
      const model = MODELS[i];
      const { response, data } =
        await askGemini(model, apiKey, contents);

      if (response.ok) {
        const answer = (data.candidates || [])
          .flatMap(candidate => candidate.content?.parts || [])
          .map(part => part.text || '')
          .join('\n')
          .trim();

        if (answer) {
          return res.json({ answer, model });
        }

        if (i === MODELS.length - 1) {
          return res.status(502).json({
            error: 'Gemini returned an empty answer. Please try again.'
          });
        }

        continue;
      }

      const message = data?.error?.message ||
        `Gemini API error: ${response.status}`;

      if (response.status === 503 || response.status === 404) {
        if (i < MODELS.length - 1) {
          await sleep(500);
          continue;
        }

        return res.status(503).json({
          error: 'Google Gemini is temporarily overloaded on the available models. Please wait and try again.'
        });
      }

      if (response.status === 429) {
        return res.status(429).json({
          error: 'Gemini has reached an API rate or quota limit. Please wait for the limit to reset. Details: ' + message
        });
      }

      if (response.status === 401 || response.status === 403) {
        return res.status(response.status).json({
          error: 'Google rejected the API key or its permissions. Check GEMINI_API_KEY in Render. Details: ' + message
        });
      }

      return res.status(502).json({ error: message });
    }

    return res.status(503).json({
      error: 'Gemini is temporarily unavailable. Please try again.'
    });

  } catch (error) {
    console.error('KarkiAI error:', error.message);

    return res.status(503).json({
      error: 'Could not connect to Google Gemini. Please try again.'
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KarkiAI running on port ${PORT}`);
});
