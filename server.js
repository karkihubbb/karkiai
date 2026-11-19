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
    provider: process.env.GROQ_API_KEY ? 'Groq' : (process.env.GEMINI_API_KEY ? 'Gemini' : 'Pollinations (no key)'),
    model: process.env.GROQ_API_KEY ? GROQ_MODEL : (process.env.GEMINI_API_KEY ? GEMINI_MODEL : 'openai')
  });
});

const SYSTEM_PROMPT = "You are Karki AI, a highly capable, friendly, general-purpose AI assistant. Your job is to help with almost any legitimate question or task: general knowledge, school and university subjects, mathematics, science, technology, programming, debugging, geography, history, current affairs, Nepal and local topics, languages, translation, writing, planning, analysis, explanations, brainstorming, and everyday problems. Do not behave like a narrow search bot. Use your broad knowledge and reasoning to answer the actual question, even when web search returns no results or is unavailable. A failed search is NOT a reason to refuse, say you cannot find reliable information, or stop helping. Give the best answer you can from established knowledge; clearly separate known facts, reasonable inferences, and uncertainty. Never invent sources, citations, names, statistics, or events. For obscure or local people and places, consider alternate spellings, regional context, and the possibility that the person is not globally famous. Do not claim someone does not exist just because search results are missing. If identity is genuinely ambiguous, give the most useful cautious answer and ask one short clarifying question only when necessary. For current or rapidly changing facts, use supplied live results when available, prioritize official and primary sources, check dates, and cite links. If live results are unavailable, say the current detail cannot be verified, but still explain the relevant background and what is known. Never present outdated knowledge as current. RESPONSE STYLE: answer the question directly first. Be concise by default; greetings and simple questions should be short. Explain clearly and naturally, like a helpful human tutor. Use steps, examples, equations, code, tables, or headings when they genuinely help. If the user asks for detail, provide detail. If they ask for a solution, solve it rather than only giving hints. For maths, show the calculation when useful and check the result. For code, provide working, complete examples and explain where they go. For writing requests, produce the requested draft. If a request is underspecified, make a sensible assumption and proceed; ask only one essential question if you truly cannot proceed. Do not repeat the question, overuse disclaimers, or give generic filler. Respect safety: do not help with serious wrongdoing or dangerous harm; briefly explain and redirect to safe alternatives. For all other ordinary topics, make a genuine effort to help. The current Gregorian year is 2026. Nepal is in Bikram Sambat year 2083, running approximately April 2026 to April 2027. Distinguish AD and BS dates.";;

// Search factual questions, not just questions containing the word "latest".
function needsLiveSearch(question) {
  const q = String(question || '').trim();
  if (!q || /^(hi|hello|hey|hiya|yo|namaste|नमस्ते)[!. ,]*$/i.test(q)) return false;
  if (/^[\d\s+\-*/().%^×÷=]+$/.test(q)) return false;
  // Skip creative / editing requests, but research almost every information-seeking question.
  if (/\b(write|draft|compose|translate|rewrite|proofread|polish|poem|story|joke|make me|create an image|generate an image|draw|brainstorm|roleplay)\b/i.test(q)) return false;
  if (/^(thanks|thank you|ok|okay|got it|good morning|good night|good job)[!. ]*$/i.test(q)) return false;
  return true;
}
function decodeHtml(value) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
async function searchWeb(query) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KarkiAI/1.0)', 'Accept': 'text/html' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Search service returned ' + response.status);
  const html = await response.text();
  const results = [];
  const pattern = /<a[^>]*class=["']result__a["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < 5) {
    const rawUrl = decodeHtml(match[1]);
    let link = rawUrl;
    try { const parsed = new URL(rawUrl, 'https://duckduckgo.com'); link = parsed.searchParams.get('uddg') || rawUrl; } catch {}
    const title = decodeHtml(match[2].replace(/<[^>]+>/g, '').trim());
    const rest = html.slice(pattern.lastIndex, pattern.lastIndex + 1800);
    const sm = rest.match(/class=["']result__snippet["'][^>]*>([\s\S]*?)<\/(?:a|td|div)>/i);
    const snippet = sm ? decodeHtml(sm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()) : '';
    if (title && /^https?:\/\//i.test(link)) results.push({ title, snippet, url: link });
  }
  return results;
}
async function searchNepalGovernment() {
  const url = 'https://opmcm.gov.np/minister-detail/';
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KarkiAI/1.0)', 'Accept': 'text/html' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Nepal PM Office returned ' + response.status);
  const html = await response.text();
  const plain = decodeHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  const match = plain.match(/(?:Balendra Shah|बालेन्द्र शाह)[\s\S]{0,1000}/i);
  if (!match) throw new Error('Current PM name not found on official PM Office page');
  return [{ title: 'Office of the Prime Minister and Council of Ministers, Nepal', snippet: match[0].slice(0, 900), url }];
}

async function searchUsPresident() {
  const url = 'https://www.usa.gov/presidents';
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KarkiAI/1.0)', 'Accept': 'text/html' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('USA.gov returned ' + response.status);
  const html = await response.text();
  const plain = decodeHtml(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
  if (!/47th and current president of the United States/i.test(plain) || !/Donald John Trump/i.test(plain)) {
    throw new Error('USA.gov did not confirm the current president');
  }
  return [{ title: 'USA.gov — Current President of the United States', snippet: 'USA.gov identifies Donald John Trump as the 47th and current president of the United States.', url }];
}

async function searchWikipedia(query) {
  const lang = /[\u0900-\u097f]/.test(query) ? 'ne' : 'en';
  const base = 'https://' + lang + '.wikipedia.org/w/api.php';
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: '2', format: 'json', origin: '*' });
  const response = await fetch(base + '?' + params, { headers: { 'User-Agent': 'KarkiAI/1.0 (knowledge assistant)' }, signal: AbortSignal.timeout(4500) });
  if (!response.ok) throw new Error('Wikipedia search returned ' + response.status);
  const data = await response.json();
  const hits = data?.query?.search || [];
  const results = [];
  for (const hit of hits.slice(0, 2)) {
    const p = new URLSearchParams({ action: 'query', prop: 'extracts|info', exintro: '1', explaintext: '1', exchars: '1200', inprop: 'url', pageids: String(hit.pageid), format: 'json', origin: '*' });
    const pageResponse = await fetch(base + '?' + p, { headers: { 'User-Agent': 'KarkiAI/1.0 (knowledge assistant)' }, signal: AbortSignal.timeout(3500) });
    if (!pageResponse.ok) continue;
    const pageData = await pageResponse.json();
    const page = pageData?.query?.pages?.[hit.pageid];
    if (page?.extract) results.push({ title: page.title, snippet: page.extract, url: page.fullurl || 'https://' + lang + '.wikipedia.org/?curid=' + hit.pageid });
  }
  return results;
}

async function askGroq(messages) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
    },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 4096,
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
      generationConfig: { maxOutputTokens: 3072 }
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

  const messages = incoming.slice(-12).map(message => ({
    role: message?.role === 'model' || message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.text || message?.content || '').slice(0, 8000)
  })).filter(message => message.content.trim());

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'The latest message must be from you.' });
  }

  const latestQuestion = messages[messages.length - 1].content;
  // KarkiAI instant greeting: avoid a slow model round-trip for simple greetings.
  if (/^(hi|hello|hey|hiya|yo|namaste|नमस्ते)[!. ,]*$/i.test(latestQuestion.trim())) {
    return res.json({
      answer: 'Hey! 👋 How can I help you today?',
      model: 'Karki AI instant reply',
      provider: 'Karki AI'
    });
  }
  const asksAboutCreator = /\b(who\s+(?:is|was)\s+(?:your\s+)?(?:creator|owner|maker|developer)|who\s+(?:made|created|built|developed)\s+you|who\s+owns\s+you|your\s+(?:creator|owner|maker|developer|founder))\b/i.test(latestQuestion);
  if (asksAboutCreator) {
    return res.json({
      answer: 'Im an Ai created by Sarwagya Karki',
      model: 'Karki AI',
      provider: 'Karki AI'
    });
  }
  const asksCurrentUsPresident = /\b(president|head of state)\b/i.test(latestQuestion)
    && /\b(usa|u\.?s\.?a?\.?|united states|america|american)\b/i.test(latestQuestion)
    && !/\b(former|past|previous|historical|in 19\d\d|in 20\d\d)\b/i.test(latestQuestion);
  if (asksCurrentUsPresident) {
    try {
      const official = await searchUsPresident();
      return res.json({
        answer: 'The current President of the United States is **Donald J. Trump**, the 47th president. He took office on January 20, 2025.\n\nSource: [USA.gov — Presidents, vice presidents, and first ladies](' + official[0].url + ')',
        model: 'Official live government source',
        provider: 'USA.gov'
      });
    } catch (error) {
      console.error('KarkiAI US president verification failed:', error.message);
      return res.status(503).json({ error: 'I could not verify the current US president from USA.gov just now. Please try again shortly.' });
    }
  }
  if (needsLiveSearch(latestQuestion)) {
    const isNepalOfficeQuestion = /\b(nepal|nepali)\b/i.test(latestQuestion) && /\b(prime minister|pm|head of government)\b/i.test(latestQuestion);
    const isUsPresidentQuestion = /\b(united states|usa|u\.s\.|america)\b/i.test(latestQuestion) && /\b(president|head of state)\b/i.test(latestQuestion);
    const searchQuery = latestQuestion + ' current 2026 Nepal 2083 BS when relevant';
    const tasks = [searchWeb(searchQuery), searchWikipedia(latestQuestion)];
    if (isNepalOfficeQuestion) tasks.push(searchNepalGovernment());
    if (isUsPresidentQuestion) tasks.push(searchUsPresident());
    const settled = await Promise.allSettled(tasks);
    const webResults = settled[0].status === 'fulfilled' ? settled[0].value : [];
    const wikiResults = settled[1].status === 'fulfilled' ? settled[1].value : [];
    const officialResults = settled.slice(2).filter(x => x.status === 'fulfilled').flatMap(x => x.value);
    const results = [...officialResults, ...webResults, ...wikiResults].slice(0, 8);
    if (results.length) {
      const research = results.map((item, index) => '[' + (index + 1) + '] ' + item.title + '\n' + item.snippet + '\nSource: ' + item.url).join('\n\n');
      messages[messages.length - 1].content += '\n\nLIVE WEB, OFFICIAL GOVERNMENT + WIKIPEDIA RESULTS (retrieved for this question; use these as primary evidence, prefer official government sources over Wikipedia for current office holders and changing facts, never answer from old training knowledge when current results contradict it, distinguish confirmed facts from uncertainty, and cite source URLs as Markdown links):\n' + research;
    } else {
      console.error('KarkiAI live research unavailable:', settled.map(x => x.status === 'rejected' ? x.reason?.message : '').filter(Boolean).join('; '));
      const asksAboutPerson = /\b(who is|who was|tell me about|biography of|bio of|information about|about)\b/i.test(latestQuestion);
      messages[messages.length - 1].content += asksAboutPerson
        ? '\n\nRESEARCH NOTE: Search did not return useful results. Do not automatically claim this person does not exist or is not notable. Use your own knowledge to provide the best careful answer you can; if the name could refer to multiple people, ask one concise question for context. Be transparent about uncertainty.'
        : '\n\nLIVE RESEARCH NOTE: Neither web search nor Wikipedia returned usable results. Do not guess about current facts; clearly say you could not verify them.';
    }
  }

    const providers = [];
  if (process.env.GROQ_API_KEY) providers.push(['Groq', () => askGroq(messages)]);
  if (process.env.GEMINI_API_KEY) providers.push(['Gemini', () => askGemini(messages)]);

  const failures = [];
  if (providers.length) {
    const attempts = providers.map(async ([name, run]) => {
      try { return await run(); }
      catch (error) {
        console.error(`KarkiAI ${name} provider failed:`, error.message);
        failures.push(`${name}: ${error.message}`);
        throw error;
      }
    });
    try { return res.json(await Promise.any(attempts)); } catch {}
  }

  try {
    return res.json(await Promise.race([
      askPollinations(messages),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Free fallback timed out')), 18000))
    ]));
  } catch (error) {
    console.error('KarkiAI Pollinations provider failed:', error.message);
    failures.push(`Pollinations: ${error.message}`);
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
