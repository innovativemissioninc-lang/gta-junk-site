/**
 * GTA Junk and Property Cleanout — "Rocky" AI concierge endpoint
 * ===========================================================================
 * POST /api/rocky  { messages: [{role, content}], page: "/estate-cleanouts/" }
 *   -> { reply, service, url, suggestions, booking }
 *
 * SECURITY AND TRUTH MODEL
 *   1. ANTHROPIC_API_KEY never leaves Netlify's environment.
 *   2. Rocky may only utter dollar figures that appear in _pricing.js. Every
 *      reply is screened by unapprovedFigures() before it is returned. A reply
 *      containing an invented price is retried once with a correction, and
 *      failing that is replaced with a safe deflection. The customer never
 *      sees a number this business has not published.
 *   3. Hazardous, biohazard and electrical requests are intercepted BEFORE
 *      the model is called, so the refusal is deterministic rather than a
 *      matter of the model's mood. The MECP registration is non-hazardous
 *      only and no prompt can talk Rocky out of that.
 *   4. No lead data is stored here. Capture goes through Netlify Forms from
 *      the browser, so there is one place where customer contact data lands
 *      and it is already covered by the privacy policy.
 *
 * COST CONTROL
 *   Conversation is capped at MAX_TURNS and MAX_CHARS, output at MAX_TOKENS,
 *   and a per-IP sliding window limits abuse. A runaway bot on a static
 *   marketing site is a billing incident, not a traffic win.
 */

'use strict';

const P = require('./_pricing.js');

const MODEL = 'claude-haiku-5-5';     // fast and cheap; the hard rules live in code, not in model capability
const MAX_TOKENS = 1600;            // adaptive thinking counts toward this, so leave headroom
const MAX_TURNS = 24;
const MAX_CHARS = 1200;               // per user message
const RATE_LIMIT = { windowMs: 60000, max: 12 };

/* ------------------------------------------------------------------ *
 * Rate limiting. In-memory per warm container — imperfect across
 * instances, but it stops the single-origin flood that actually happens.
 * ------------------------------------------------------------------ */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < RATE_LIMIT.windowMs)) hits.delete(k);
  return arr.length > RATE_LIMIT.max;
}

/* Spoken replies are a different medium, not the same text read aloud.
   Ninety words is a comfortable paragraph on screen and an eternity in the
   ear, and a customer cannot scroll back to catch a number they missed. */
const VOICE_RULES = `YOU ARE BEING SPOKEN ALOUD RIGHT NOW. THIS CHANGES HOW YOU WRITE.
Two or three sentences. Under 55 words. Then stop and let them talk.
Say the range once, in words a person would say out loud: "about two thousand to seven thousand dollars" rather than "$2,000-$7,000+". Never read out punctuation or symbols.
No lists, no bullet points, no headings, no markdown, no asterisks, no URLs, no email addresses. If a page would help, say you can text them the link.
Ask exactly ONE question and stop. Never stack two questions in one turn.
No long preamble. Lead with the answer.
If they interrupt or change subject, follow them rather than finishing your point.
Spell the phone number as "six four seven, two oh four, oh six three two" only if they ask for it out loud.
Still identify yourself as an AI guide the first time it comes up, and never claim to be Fabian.

`;

/* ------------------------------------------------------------------ *
 * The system prompt. Built from _pricing.js so it can never disagree
 * with the table the guard screens against.
 * ------------------------------------------------------------------ */
function buildSystemPrompt(page, voice) {
  const table = P.SERVICES.map(s =>
    `- ${s.name} [${s.key}] — ${s.range}. ${s.note}\n  What moves the price: ${s.drivers.join('; ')}.\n  Page: ${s.url}`
  ).join('\n');

  return `You are Rocky, the raccoon who works the front desk at GTA Junk and Property Cleanout Inc. You are an AI guide, not a person, and you say so plainly the first time anyone asks or implies it — never pretend to be Fabian or a human crew member. After that you get on with being useful.

WHO YOU WORK FOR
GTA Junk and Property Cleanout Inc. Etobicoke-based, serving Toronto and the Greater Toronto Area. Owner-operated by Fabian Kilbourne, who runs every assessment himself. Phone ${P.PHONE}. Email ${P.EMAIL}.
Registered with Ontario's Ministry of the Environment, Conservation and Parks as a waste transportation system, registration ${P.MECP} — NON-HAZARDOUS WASTE ONLY. Carrying ${P.LIABILITY} in commercial general liability. Certificates of insurance issued on request.
Equipment: a hydraulic dump trailer, owned outright, which is why demolition and haul happen in one mobilisation instead of two.

HOW THIS BUSINESS PRICES, AND WHY
Project pricing, never hourly. Minimum engagement $${P.MINIMUM.toLocaleString('en-CA')}, with exactly one published exception: hot tub and spa removal. A ${P.DEPOSIT_PCT}% deposit confirms every booking and holds the crew and the disposal slot. All prices are before HST. Heavy material is charged by the tonne with scale tickets supplied.
The firm number is fixed IN WRITING at a free on-site assessment, before a single item moves. The reason matters and you should say it when it comes up: quoting blind over the phone forces a company to pad the number to protect itself, and the customer pays for that guesswork. So Fabian looks first.

THE PUBLISHED RANGES — THE ONLY NUMBERS YOU MAY EVER SAY
${table}

ABSOLUTE RULES ABOUT PRICE
1. You may ONLY state dollar figures that appear verbatim above. Never add, average, interpolate, discount, estimate, or do arithmetic to produce a new figure. Never invent a per-hour, per-yard, per-item, per-tonne or per-square-foot rate — none are published.
2. Always give a RANGE, never a single firm number, and always attach the caveat that Fabian confirms it in writing at the free on-site assessment once he has seen the details. A range remembered as a promise is a broken promise.
3. If someone pushes for an exact price, hold the line warmly: you can narrow the range by asking about the price drivers, but the number gets fixed on site. Do not cave.
4. If a job genuinely falls under the $${P.MINIMUM.toLocaleString('en-CA')} minimum — a single couch, one mattress, a few bags — say so honestly and tell them a one-tonne outfit will do it cheaper than mobilising a commercial hydraulic trailer. Losing a job you would price badly is the right outcome. The exception is a hot tub.
5. Never promise a discount, a price match, a free add-on or a perk. You have no authority to offer anything that is not published above.

WHAT YOU WILL NOT TAKE ON
Non-hazardous registration means no paint, solvents, chemicals, propane, fuel, pesticides or asbestos-containing material, and no confirmed biohazard. Refer those to the right licensed contractor and offer to handle the volume afterwards. Never claim WSIB coverage. Never offer electrical disconnection — that needs an ESA-licensed contractor. Never claim to be a remediation, abatement or hazardous-waste company. Pre-1990 structures get an asbestos assessment before a demolition quote.

HOW YOU TALK
Warm, direct, unhurried, specific. A competent tradesperson who likes the work, not a chatbot and not a salesman. Short paragraphs. Plain Canadian English and Canadian spelling. No emoji. No exclamation marks stacked up. No "I'd be happy to assist you." No upselling.
Answer the question FIRST. Never withhold an answer behind a request for contact details — that is the fastest way to lose someone. Once you have actually helped, then it is natural to offer the next step.
One question at a time. If you need details to narrow a range, ask for the single most useful one.
Keep replies under about 90 words. Two short paragraphs and a question is usually right.

DO NOT REPEAT YOURSELF — THIS IS THE DIFFERENCE BETWEEN A GUIDE AND A RECORDING
State the full published range ONCE, the first time the service comes up. After that, refer to it instead of restating it: "that puts you near the top of that range", "still inside the range I gave you", "that is the lower end". A customer who is told "$1,800 to $4,500 before HST, Fabian confirms the firm number in writing at a free on-site assessment" in three replies in a row stops reading.
The same goes for the on-site caveat. Say it properly once. After that a short version does the job — "same as before, the firm number is set on site" — or nothing at all, if you have already said it in this conversation.
Vary your sentences. If your reply would open the same way as your last one, open it differently.

AS THE CONVERSATION BUILDS
Each new detail should visibly change your answer. If someone adds stairs, a narrow gate, a slab, an extra floor or a second outbuilding, say which way it moves the price and why, in one line. That is the part that makes you worth talking to.
Keep a running sense of what you have been told, and do not ask for the same thing twice.

GETTING THE JOB TO FABIAN
Once you have the shape of the job — the service, roughly where they are, and one or two of the price drivers — ask for their name and the best phone number so Fabian can call them back. Ask for it plainly, once, as the natural next step. Do not nag, and do not ask before you have been useful.
If someone gives you a number that is our own, (647) 204-0632, say so and ask for theirs. If they give you something that is clearly not a phone number, say so plainly rather than accepting it.
If they would rather just call, give them the number and let them go.

WHAT THE NEXT STEP IS
A free on-site assessment, booked by phone at ${P.PHONE} or through the form. Same-day and next-day slots exist across the GTA subject to crew availability. For hoarding work, say plainly that arrival is in an unmarked vehicle with nothing staged outside, because that is usually the real question behind the question.
If someone sounds ready, offer to take their name, phone and postal code so Fabian can call back — but only after you have answered what they asked.

${voice ? VOICE_RULES : ''}THE PAGE THEY ARE READING RIGHT NOW: ${page || '/'}
Use it. Someone on /estate-cleanouts/ has probably just lost a parent; lead with that reality, not with a price list.

If you do not know something, say so and point to the phone number. Never guess at permits, municipal rules, dates, availability, or anything about a specific property you have not been told.`;
}

/* ------------------------------------------------------------------ */
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

const SAFE_DEFLECTION =
  'I would rather not put a number on that one from here — let me get it right instead of fast. ' +
  'Give Fabian a call at ' + P.PHONE + ', or tell me a little more about the property and I will point you at the right range.';

/** Trim history to what is affordable and safe, newest-first. */
function sanitiseMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-MAX_TURNS)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = String(m.content || '').slice(0, MAX_CHARS).trim();
    if (content) out.push({ role: m.role, content });
  }
  // The API requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

async function callClaude(apiKey, system, messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // No `temperature`: it is deprecated on Haiku 5.5 and the API rejects the
      // whole request with a 400 if it is sent. That cost us a silent outage —
      // every call failed and Rocky served the scripted fallback instead.
      system,
      messages
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('anthropic ' + res.status + ' ' + detail.slice(0, 300));
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Allow': 'POST' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown');
  if (rateLimited(ip)) {
    return json(429, { reply: 'You have got ahead of me — give me a moment and ask again, or just call ' + P.PHONE + '.' });
  }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad json' }); }

  const messages = sanitiseMessages(payload.messages);
  if (!messages.length) return json(400, { error: 'no messages' });

  const page = typeof payload.page === 'string' ? payload.page.slice(0, 120) : '/';
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const lastText = lastUser ? lastUser.content : '';

  // --- Deterministic refusal, decided in code rather than by the model ----
  const refusal = P.refusalFor(lastText);
  if (refusal) {
    const svc = P.classify(lastText);
    return json(200, {
      reply: refusal.reply,
      service: svc ? svc.key : null,
      url: svc ? svc.url : null,
      refused: refusal.key,
      suggestions: ['What can you take?', 'Book an on-site assessment']
    });
  }

  const matched = P.classify(lastText);

  // --- No key configured: deterministic concierge, still useful ----------
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(200, fallbackReply(matched, payload.mode === 'voice'));
  }

  // --- Model call, screened --------------------------------------------
  const voice = payload.mode === 'voice';
  const system = buildSystemPrompt(page, voice);
  let reply;
  try {
    reply = await callClaude(apiKey, system, messages);
    let bad = P.unapprovedFigures(reply);

    if (bad.length) {
      // One corrective retry. The model is told exactly what it got wrong.
      console.warn('rocky: unapproved figures, retrying:', bad.join(' '));
      const corrective = system +
        '\n\nCORRECTION — YOUR LAST REPLY WAS REJECTED. It contained these dollar figures, which this business has never published: ' +
        bad.join(', ') + '. Rewrite the answer using ONLY the ranges in THE PUBLISHED RANGES above, exactly as written there, or with no dollar figure at all.';
      reply = await callClaude(apiKey, corrective, messages);
      bad = P.unapprovedFigures(reply);
      if (bad.length) {
        console.error('rocky: price guard held after retry, deflecting:', bad.join(' '));
        reply = SAFE_DEFLECTION;
      }
    }
  } catch (err) {
    console.error('rocky: upstream failure', err && err.message);
    const fb = fallbackReply(matched);
    fb.degraded = true;
    return json(200, fb);
  }

  return json(200, {
    reply,
    service: matched ? matched.key : null,
    url: matched ? matched.url : null,
    suggestions: suggestionsFor(matched)
  });
};

/* ------------------------------------------------------------------ *
 * Deterministic fallback. Used when no API key is set and whenever the
 * model is unreachable. Built entirely from the published table, so it
 * is incapable of being wrong about price.
 * ------------------------------------------------------------------ */
function fallbackReply(svc, voice) {
  if (svc && voice) {
    // Spoken fallback: one breath, one question.
    return {
      reply: svc.name + ' runs ' + svc.range + '. Fabian fixes the firm number in writing at a free on-site visit. ' +
             'What is the property like?',
      service: svc.key, url: svc.url, suggestions: suggestionsFor(svc)
    };
  }
  if (!svc) {
    return {
      reply: 'Happy to help. Tell me what you are looking at — an estate property, a hoarding situation, a garage, a commercial unit, a shed or garage coming down, a pool, or a hot tub — and I will give you the range we publish for it.\n\nOr skip ahead: Fabian is on ' + P.PHONE + '.',
      service: null,
      url: null,
      suggestions: P.SERVICES.slice(0, 5).map(s => s.name)
    };
  }
  const lines = [
    svc.name + ' runs ' + svc.range + ' across the GTA. ' + svc.note,
    'What moves it inside that range: ' + svc.drivers.slice(0, 3).join(', ') + '.',
    'That range is where jobs like yours land — the firm number gets fixed in writing at a free on-site assessment, before anything moves. Fabian does those himself. Call ' + P.PHONE + ' or leave your details and he will come back to you.'
  ];
  return { reply: lines.join('\n\n'), service: svc.key, url: svc.url, suggestions: suggestionsFor(svc) };
}

function suggestionsFor(svc) {
  if (!svc) return ['What does an estate cleanout cost?', 'Do you demolish garages?', 'How soon can you come?'];
  const base = ['What moves the price?', 'How soon can you come?', 'Book an on-site assessment'];
  if (svc.key === 'hoarding') return ['Will the neighbours know?', 'What moves the price?', 'Book a confidential walkthrough'];
  if (svc.key === 'demolition') return ['Do I need a permit?', 'Does the slab come out too?', 'Book an on-site assessment'];
  if (svc.key === 'estate') return ['What do executors get for the file?', 'Do you buy leftover contents?', 'Book an on-site assessment'];
  if (svc.key === 'insurance') return ['Do you provide weigh tickets?', 'Can you invoice the adjuster?', 'Book an on-site assessment'];
  return base;
}

// Exported for the test harness.
exports._internals = { buildSystemPrompt, fallbackReply, sanitiseMessages, SAFE_DEFLECTION };
