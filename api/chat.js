// Serverless function (Vercel, Node 18+). The Anthropic key is read from the
// ANTHROPIC_API_KEY environment variable and never sent to the browser.
const { KB, KB_IDS, kbById } = require('../lib/kb');
const { restartDate, restartDateAfter, todayIST, hasPII, hasAdviceWords, hasPressureWords } = require('../lib/rules');

const MODEL = process.env.MODEL || 'claude-haiku-5-5';
const PROMPT_VERSION = 'qa-v6.1'; // v6.1: returns or performance questions always count as advice. v6: no explaining or extending facts, strip 'according to the sources', IST dates, settle date = today + N months. v5: conversation memory (last 4 turns), K6 to K8, never mention the knowledge base, two-input planner with check-in. Earlier: v2: judge sees source titles; answer must not name sources. v3: keep qualifiers; judge rejects overstated certainty (too strict, 5/10 factual). v4: judge fails only contradictions, additions or provider-to-general; omissions are fine
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
  if (arr.length >= max) { hits.set(ip, arr); return true; } // blocked requests are not counted, so the window can clear
  arr.push(now); hits.set(ip, arr);
  return false;
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
- advice_request = true if the user asks what they should do (continue, stop, which fund, how much, whether returns will be good), or asks for predictions. Any question about future returns or how a fund will perform is advice_request = true, even if it is outside SIP controls.
- answerable = true only if the knowledge base directly answers the question. If it only partly or indirectly relates, answerable = false. Never guess.
- answer: plain, calm English under 80 words. No recommendations, no predictions, no fund names, no percentages, no fear, urgency or loss framing. Do not tell the user what to do; explain how the options work.
- Do not name the source, website or organisation in the answer text. Sources are shown to the user separately as citations.
- State only what the sources say. Do not add your own inferences or conclusions.
- Do not explain what a fact means or what follows from it. If a source says "after a skip, your investments continue as usual", say exactly that, not what happens to next month's instalment.
- Never extend a fact about one thing to a similar thing. If a source says a changed amount applies to all following instalments, do not say the same about a changed date.
- Keep every qualifier the source gives. If a source says something is one provider's practice, typical, or may happen, say so (for example "one platform also counts skipped instalments"), never state it as a general rule.
- Never mention "the knowledge base" or "the sources" in the answer text, and never write phrases like "according to the sources" or "based on the information". Just state the fact.
- If there is an earlier conversation, use it only to understand what the new question refers to (for example "it" or "that"). Answer only the new question, only from the knowledge base.
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
Judge only the statements the answer makes. Leaving information out is never a reason to fail, and naming or not naming a source does not matter.
supported = false only if a statement (a) contradicts the sources, (b) adds a fact or inference the sources do not contain, or (c) turns something the source presents as one provider's practice into a general rule.
Small paraphrases with the same meaning are supported.
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

const PLAN_SYSTEM = `You help a user plan when to come back to their paused SIP. Read everything the user has said in this conversation and extract two things.
1. payday_day: the day of the month (1 to 31) when money usually comes in.
- One clear day ("1st", "salary on 5th", "around the 10th"): use it.
- "End of the month" or "last day" means 30.
- Vague, a range, irregular or late ("last week, sometimes late", "it varies"): 0, and write one short, friendly question asking for the latest day it usually arrives by.
2. When things will settle:
- settle_months: whole months from now until the user expects money to be back on track ("next month" = 1, "in about 2 months" = 2, "by March" = months from now). 0 if they did not say.
- settle_unsure: true only if the user says they do not know, are not sure, or it depends.
Never invent a day or a month the user did not give. No advice.`;

const PLAN_TOOL = {
  name: 'payday',
  description: 'Return the extracted payday.',
  input_schema: {
    type: 'object',
    properties: {
      payday_day: { type: 'integer', minimum: 0, maximum: 31, description: 'Day of month 1 to 31, or 0 if not clearly given' },
      settle_months: { type: 'integer', minimum: 0, maximum: 12, description: 'Months until money is back on track, 0 if not said' },
      settle_unsure: { type: 'boolean' },
      question: { type: 'string', description: 'A short question for the payday, only used when payday_day is 0' }
    },
    required: ['payday_day', 'settle_months', 'settle_unsure', 'question']
  }
};

const sources = ids => ids.map(id => kbById(id)).filter(Boolean).map(k => ({ id: k.id, title: k.title, url: k.url, status: k.status }));
const fallback = (kind, checks) => ({ type: 'fallback', kind, text: FALLBACK[kind], link: HELP_URL, checks });

// Earlier turns (at most 4) are passed as context so follow-up questions make sense.
function historyBlock(history) {
  if (!history.length) return '';
  return '<earlier_conversation>\n' + history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n') + '\n</earlier_conversation>\n';
}

async function handleQA(message, debug = false, history = []) {
  const checks = { G1: 'skipped', G2: 'skipped', G3: 'skipped', G4: 'skipped', G5: 'pass', G6: 'skipped' };
  const qa = await callTool(QA_SYSTEM, `${historyBlock(history)}<question>${message}</question>`, QA_TOOL, 500);

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
  // Remove meta phrases about sources (users see citations separately).
  qa.answer = String(qa.answer || '').replace(/\b(according to|based on|as per) (the )?(sources?|knowledge base|available information|information provided)\s*,?\s*/gi, '').replace(/^\s*([a-z])/, (m, c) => c.toUpperCase()).replace(/([.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
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

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nice = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const SETTLE_Q = "Do you know roughly when things will settle, for example in a month or two? It's fine to say you're not sure yet.";

// The model only extracts what the user said. Which reply to give, and every date, is decided by code.
async function handlePlan(message, history = []) {
  const said = history.filter(h => h.role === 'user').map(h => h.text).concat(message);
  const p = await callTool(PLAN_SYSTEM, `<user_said>\n${said.join('\n')}\n</user_said>`, PLAN_TOOL, 250);
  const day = Number.isInteger(p.payday_day) && p.payday_day >= 1 && p.payday_day <= 31 ? p.payday_day : null;
  if (!day) return { type: 'clarify', ask: 'payday', text: p.question || 'Which day of the month does your money usually arrive by?' };
  if (p.settle_unsure) {
    const d = restartDate(day, todayIST());
    return {
      type: 'checkin', payday_day: day, date_iso: iso(d),
      text: `No problem, you don't need to decide now. I'll check in on ${nice(d)}, a few days after your next payday, and you can restart then or check again later. Does that work?`,
      rule: 'next payday + 3 days, moved off weekends'
    };
  }
  const months = Number.isInteger(p.settle_months) ? p.settle_months : 0;
  if (months < 1) return { type: 'clarify', ask: 'settle', payday_day: day, text: SETTLE_Q };
  const d = restartDateAfter(day, months, todayIST());
  return {
    type: 'plan', payday_day: day, settle_months: months, date_iso: iso(d),
    text: `Your money usually arrives around the ${ordinal(day)}, and you expect things to settle in about ${months} month${months > 1 ? 's' : ''}. A restart date a few days after that payday is ${nice(d)}. Does that work?`,
    rule: 'payday in the month things settle + 3 days, moved off weekends'
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
  // Up to 4 earlier turns, each trimmed; never trusted beyond being context.
  const history = (Array.isArray(body && body.history) ? body.history : []).slice(-4)
    .filter(h => h && typeof h.text === 'string' && (h.role === 'user' || h.role === 'assistant'))
    .map(h => ({ role: h.role, text: h.text.slice(0, MAX_INPUT) }));
  if (!message) { res.status(400).json({ error: 'Empty message' }); return; }
  if (message.length > MAX_INPUT) { res.status(400).json({ error: `Please keep it under ${MAX_INPUT} characters.` }); return; }

  // G5 on input: never send personal identifiers to the model.
  if (hasPII(message) || history.some(h => h.role === 'user' && hasPII(h.text))) {
    res.status(200).json(fallback('privacy', { G1: 'skipped', G2: 'skipped', G3: 'skipped', G4: 'skipped', G5: 'fail', G6: 'skipped' }));
    return;
  }

  try {
    const out = mode === 'plan' ? await handlePlan(message, history) : await handleQA(message, debug, history);
    res.status(200).json(out);
  } catch (e) {
    console.error(e.message, e.detail || '');
    res.status(200).json({ type: 'fallback', kind: 'unsure', text: FALLBACK.unsure, link: HELP_URL, error: 'service_unavailable' });
  }
};

module.exports._internals = { handleQA, handlePlan, callTool, FALLBACK };
