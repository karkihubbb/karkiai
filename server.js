require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'KarkiAI' });
});

app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'KarkiAI is not connected yet. Add your Gemini API key in the hosting service environment variables.' });
  }

  const incoming = req.body && req.body.messages;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: 'Please send a message to start the conversation.' });
  }

  const messages = incoming.slice(-20).map((message) => ({
    role: message && message.role === 'model' ? 'model' : 'user',
    parts: [{ text: String(message && message.text ? message.text : '').slice(0, 12000) }]
  })).filter((message) => message.parts[0].text.trim());

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'The latest message must be from you.' });
  }

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const googleResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: 'You are KarkiAI, a helpful, capable, friendly general-purpose AI assistant. Answer clearly and professionally. Be accurate, explain uncertainty honestly, and adapt the detail to the question. Use readable Markdown when it helps. Do not claim to browse the web, see files, or perform actions unless the app actually provides that capability.' }]
        },
        contents: messages,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096
        }
      })
    });

    const data = await googleResponse.json().catch(() => ({}));
    if (!googleResponse.ok) {
      const message = data && data.error && data.error.message
        ? data.error.message
        : `Gemini API returned status ${googleResponse.status}.`;
      const status = googleResponse.status === 429 ? 429 : (googleResponse.status >= 500 ? 503 : 502);
      return res.status(status).json({ error: message });
    }

    const answer = (data.candidates || [])
      .flatMap((candidate) => (candidate.content && candidate.content.parts) || [])
      .map((part) => part.text || '')
      .join('\n')
      .trim();

    if (!answer) {
      return res.status(502).json({ error: 'Gemini returned an empty answer. Please try again.' });
    }

    return res.json({ answer, model: MODEL });
  } catch (error) {
    console.error('KarkiAI request failed:', error.message);
    return res.status(503).json({ error: 'Could not reach the AI service. Please try again in a moment.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KarkiAI is running on port ${PORT}`);
});
