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
    provider: process.env.GROQ_API_KEY ? 'Groq' : (process.env.GEMINI_API_KEY ? 'Gemini' : 'Pollinations (no key)')
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

async function askPollinations(messages) {
  // Anonymous public fallback: no API key or account required.
  // Anonymous access is throttled and is not a guaranteed production service.
  const transcript = messages.slice(-10).map(message =>
    `${message.role === 'assistant' ? 'KarkiAI' : 'User'}: ${message.content}`
  ).join('\n');
  const prompt = `${SYSTEM_PROMPT}\nContinue this conversation:\n${transcript}\nKarkiAI:`;
  const url = 'https://text.pollinations.ai/' + encodeURIComponent(prompt) + '?model=openai';
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'text/plain' },
    signal: AbortSignal.timeout(60000)
  });
  const answer = (await response.text()).trim();
  if (!response.ok || !answer) {
    const error = new Error(answer.slice(0, 300) || `Pollinations API error: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return { answer, model: 'Pollinations anonymous', provider: 'Pollinations' };
}

app.post('/api/chat', async (req, res) => {
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

  const providers = [];
  if (process.env.GROQ_API_KEY) providers.push(['Groq', () => askGroq(messages)]);
  if (process.env.GEMINI_API_KEY) providers.push(['Gemini', () => askGemini(messages)]);
  providers.push(['Pollinations', () => askPollinations(messages)]);

  const failures = [];
  for (const [name, run] of providers) {
    try {
      const result = await run();
      return res.json(result);
    } catch (error) {
      console.error(`KarkiAI ${name} provider failed:`, error.message);
      failures.push(`${name}: ${error.message}`);
    }
  }

  return res.status(503).json({
    error: 'All available AI services are temporarily unavailable or rate-limited. Please try again later.',
    details: failures.slice(-3)
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`KarkiAI running on port ${PORT}`);
});
