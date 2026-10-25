// Serverless function (Vercel, Node 18+). The Anthropic key is read from the
// ANTHROPIC_API_KEY environment variable and never sent to the browser.
const { KB, KB_IDS, kbById } = require('../lib/kb');
const { restartDate, hasPII, hasAdviceWords, hasPressureWords } = require('../lib/rules');

const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const PROMPT_VERSION = 'qa-v3'; // v2: judge sees source titles; answer must not name sources. v3: keep qualifiers; judge rejects overstated certainty
const MAX_INPUT = 500;
const HELP_URL = 'https://groww.in/help';

const FALLBACK = {
  scope: "I can only help with skipping, pausing, stopping or restarting a SIP. For anything else, Groww Help has the details.",
  advice: "I can't advise on whether to continue, which fund, or how much to invest. I can explain how each option works so you can decide.",
  unsure: "I'm not confident I can answer that correctly. Here's the official help page.",
  privacy: "Please don't share account numbers or PAN here. I don't need them to help."
};

// Best-effort per-instance rate limit (serverless instances are short-lived; the
// monthly spend limit on the API key is the hard cap).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 60;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  return arr.length > max;
}

async function callTool(system, user, tool, maxTokens = 500) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!r.ok) {
    const body = await r.text();
    const err = new Error(`Anthropic API ${r.status}`);
    err.detail = body.slice(0, 300);
    throw err;
  }
  const data = await r.json();
  const block = (data.content || []).find(b => b.type === 'tool_use');
  if (!block) throw new Error('No tool output');
  return block.input;
}

const KB_TEXT = KB.map(k => `[${k.id}] ${k.title}\n${k.text}`).join('\n\n');

const QA_SYSTEM = `You explain how SIP (systematic investment plan) controls work for first-time mutual fund investors in India.
Use ONLY the knowledge base below. Never use outside knowledge.

Knowledge base:
${KB_TEXT}

Rules:
- in_scope = true only if the question is about skipping, pausing, stopping, restarting or editing a SIP, or about failed SIP instalments.
- advice_request = true if the user asks what they should do (continue, stop, which fund, how much, whether returns will be good), or asks for predictions.
- answerable = true only if the knowledge base directly answers the question. If it only partly or indirectly relates, answerable = false. Never guess.
- answer: plain, calm English under 80 words. No recommendations, no predictions, no fund names, no percentages, no fear, urgency or loss framing. Do not tell the user what to do; explain how the options work.
- Do not name the source, website or organisation in the answer text. Sources are shown to the user separately as citations.
- Keep every qualifier the source gives. If a source says something is one provider's practice, typical, or may happen, say so (for example "one platform also counts skipped instalments"), never state it as a general rule.
- citations: the knowledge base IDs that support every statement in the answer.`;

const QA_TOOL = {
  name: 'answer',
  description: 'Return the answer and its classification.',
  input_schema: {
    type: 'object',
    properties: {
      in_scope: { type: 'boolean' },
      advice_request: { type: 'boolean' },
      answerable: { type: 'boolean' },
      answer: { type: 'string' },
      citations: { type: 'array', items: { type: 'string', enum: KB_IDS } }
    },
    required: ['in_scope', 'advice_request', 'answerable', 'answer', 'citations']
  }
};

const JUDGE_SYSTEM = `You are a strict reviewer. You get an answer and the source texts it cites.
supported = true only if every factual statement in the answer is directly supported by the cited sources.
supported = false if the answer states something more certainly or more generally than the source does, for example dropping words like "typically", "may" or "one provider".
Each source starts with its title, which names the publisher. Naming that publisher in the answer counts as supported.
gives_advice = true if the answer recommends any action, fund, amount or timing, or predicts returns.
pressure_language = true if the answer uses fear, regret, loss framing, missing out or urgency.`;

const JUDGE_TOOL = {
  name: 'review',
  description: 'Review an answer.',
  input_schema: {
    type: 'object',
    properties: {
      supported: { type: 'boolean' },
      gives_advice: { type: 'boolean' },
      pressure_language: { type: 'boolean' },
      reason: { type: 'string' }
    },
    required: ['supported', 'gives_advice', 'pressure_language', 'reason']
  }
};

const PLAN_SYSTEM = `You help a user say when their income usually arrives each month.
Extract the day of the month (1 to 31) when money usually comes in.
- If they give one clear day (for example "1st", "salary on 5th", "around the 10th"), set payday_day to it and needs_clarification = false.
- "End of the month" or "last day" means 30.
- If it is vague, a range, irregular or late (for example "last week, sometimes late", "it varies"), set payday_day to 0, needs_clarification = true, and write one short, friendly question asking for the latest day it usually arrives by.
- Never invent a day the user did not give. No advice.`;

const PLAN_TOOL = {
  name: 'payday',
  description: 'Return the extracted payday.',
  input_schema: {
    type: 'object',
    properties: {
      payday_day: { type: 'integer', minimum: 0, maximum: 31, description: 'Day of month 1 to 31, or 0 if not clearly given' },
      needs_clarification: { type: 'boolean' },
      question: { type: 'string' }
    },
    required: ['payday_day', 'needs_clarification', 'question']
  }
};

const sources = ids => ids.map(id => kbById(id)).filter(Boolean).map(k => ({ id: k.id, title: k.title, url: k.url, status: k.status }));
const fallback = (kind, checks) => ({ type: 'fallback', kind, text: FALLBACK[kind], link: HELP_URL, checks });

async function handleQA(message, debug = false) {
  const checks = { G1: 'skipped', G2: 'skipped', G3: 'skipped', G4: 'skipped', G5: 'pass', G6: 'skipped' };
  const qa = await callTool(QA_SYSTEM, `<question>${message}</question>`, QA_TOOL, 500);

  if (qa.advice_request) { checks.G3 = 'fail'; return fallback('advice', checks); }
  checks.G3 = 'pending';
  if (!qa.in_scope) { checks.G6 = 'fail'; return fallback('scope', checks); }
  checks.G6 = 'pass';
  // Eval tracing: when debug is on, attach the rejected draft and the reason so failures can be diagnosed.
  const trace = extra => debug ? { draft: qa.answer, draft_citations: qa.citations || [], ...extra } : undefined;
  const fb = (kind, extra) => { const f = fallback(kind, checks); const t = trace(extra); if (t) f.trace = t; return f; };
  if (!qa.answerable) { checks.G2 = 'fail'; return fb('unsure', { stopped_at: 'model said not answerable' }); }

  const cites = [...new Set(qa.citations || [])];
  if (!cites.length || cites.some(c => !KB_IDS.includes(c))) { checks.G1 = 'fail'; return fb('unsure', { stopped_at: 'no valid citation' }); }
  checks.G1 = 'pass';
  if (hasPII(qa.answer)) { checks.G5 = 'fail'; return fb('privacy', { stopped_at: 'PII in answer' }); }
  if (hasAdviceWords(qa.answer)) { checks.G3 = 'fail'; return fb('advice', { stopped_at: 'advice words in answer' }); }
  if (hasPressureWords(qa.answer)) { checks.G4 = 'fail'; return fb('unsure', { stopped_at: 'pressure words in answer' }); }

  // The judge sees the same evidence the answerer saw: ID, title (publisher) and text.
  const cited = cites.map(id => `[${id}] ${kbById(id).title}\n${kbById(id).text}`).join('\n\n');
  const j = await callTool(JUDGE_SYSTEM, `<answer>${qa.answer}</answer>\n<sources>\n${cited}\n</sources>`, JUDGE_TOOL, 300);
  checks.G2 = j.supported ? 'pass' : 'fail';
  checks.G3 = j.gives_advice ? 'fail' : 'pass';
  checks.G4 = j.pressure_language ? 'fail' : 'pass';
  if (j.gives_advice || !j.supported || j.pressure_language) {
    console.log('judge_reject', JSON.stringify({ q: message, draft: qa.answer, cites, reason: j.reason }));
  }
  if (j.gives_advice) return fb('advice', { stopped_at: 'judge: gives advice', judge_reason: j.reason });
  if (!j.supported || j.pressure_language) return fb('unsure', { stopped_at: j.supported ? 'judge: pressure language' : 'judge: not supported by sources', judge_reason: j.reason });

  return { type: 'answer', text: qa.answer, citations: sources(cites), checks };
}

async function handlePlan(message) {
  const p = await callTool(PLAN_SYSTEM, `<user>${message}</user>`, PLAN_TOOL, 200);
  const day = Number.isInteger(p.payday_day) && p.payday_day >= 1 && p.payday_day <= 31 ? p.payday_day : null;
  if (p.needs_clarification || !day) {
    return { type: 'clarify', text: p.question || 'Which day of the month does your money usually arrive by?' };
  }
  const d = restartDate(day);
  return {
    type: 'plan',
    payday_day: day,
    date_iso: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    text: `Your money usually arrives around the ${ordinal(day)}. A restart date a few days after that is ${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}. Does that work?`,
    rule: 'payday + 3 days, moved off weekends'
  };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: 'Server is missing ANTHROPIC_API_KEY' }); return; }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0] || 'local';
  if (rateLimited(ip)) { res.status(429).json({ error: 'Too many messages. Please try again in a few minutes.' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = body && body.mode === 'plan' ? 'plan' : 'qa';
  const message = String((body && body.message) || '').trim();
  const debug = !!(body && body.debug === true);
  if (!message) { res.status(400).json({ error: 'Empty message' }); return; }
  if (message.length > MAX_INPUT) { res.status(400).json({ error: `Please keep it under ${MAX_INPUT} characters.` }); return; }

  // G5 on input: never send personal identifiers to the model.
  if (hasPII(message)) {
    res.status(200).json(fallback('privacy', { G1: 'skipped', G2: 'skipped', G3: 'skipped', G4: 'skipped', G5: 'fail', G6: 'skipped' }));
    return;
  }

  try {
    const out = mode === 'plan' ? await handlePlan(message) : await handleQA(message, debug);
    res.status(200).json(out);
  } catch (e) {
    console.error(e.message, e.detail || '');
    res.status(200).json({ type: 'fallback', kind: 'unsure', text: FALLBACK.unsure, link: HELP_URL, error: 'service_unavailable' });
  }
};

module.exports._internals = { handleQA, handlePlan, callTool, FALLBACK };
