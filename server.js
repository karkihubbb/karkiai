require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const hasCloudKey = () => Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'KarkiAI',
    apiKeyConfigured: hasCloudKey(),
    provider: process.env.GROQ_API_KEY ? 'Groq' : (process.env.GEMINI_API_KEY ? 'Gemini' : null)
  });
});

const SYSTEM_PROMPT = 'You are KarkiAI, a helpful, capable, friendly general-purpose AI assistant. Answer clearly and professionally. Be accurate, explain uncertainty honestly, and use readable Markdown when helpful. Never claim to browse the web or perform actions unless the app provides that capability.';

async function askGroq(messages) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 2048,
      temperature: 0.7
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `Groq API error: ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error('Groq returned an empty answer. Please try again.');
  return { answer, model: data.model || GROQ_MODEL, provider: 'Groq' };
}

async function askGemini(messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    signal: AbortSignal.timeout(60000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 2048 }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `Gemini API error: ${response.status}`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }

  const answer = (data.candidates || [])
    .flatMap(candidate => candidate.content?.parts || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
  if (!answer) throw new Error('Gemini returned an empty answer. Please try again.');
  return { answer, model: GEMINI_MODEL, provider: 'Gemini' };
}

app.post('/api/chat', async (req, res) => {
  if (!hasCloudKey()) {
    return res.status(503).json({
      error: 'Cloud AI key is missing. Add GROQ_API_KEY in Render Environment.'
    });
  }

  const incoming = req.body?.messages;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return res.status(400).json({ error: 'Please send a message.' });
  }

  const messages = incoming.slice(-20).map(message => ({
    role: message?.role === 'model' || message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.text || message?.content || '').slice(0, 12000)
  })).filter(message => message.content.trim());

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'The latest message must be from you.' });
  }

  try {
    // Prefer Groq when configured; retain Gemini as a compatibility fallback.
    if (process.env.GROQ_API_KEY) {
      const result = await askGroq(messages);
      return res.json(result);
    }

    const result = await askGemini(messages);
    return res.json(result);
  } catch (error) {
    console.error('KarkiAI cloud AI error:', error.message);
    const status = error.status === 429 ? 429 : (error.status === 401 || error.status === 403 ? error.status : 502);
    let message = error.message || 'The cloud AI service is temporarily unavailable.';
    if (status === 429) message = 'The AI provider rate or usage limit has been reached. Please wait and try again. Details: ' + message;
    if (status === 401 || status === 403) message = 'The cloud AI key was rejected. Check the provider key in Render Environment.';
    return res.status(status).json({ error: message });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KarkiAI running on port ${PORT}`);
});
