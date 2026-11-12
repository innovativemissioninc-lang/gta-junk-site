/**
 * GTA Junk and Property Cleanout — phone lead follow-up
 * ---------------------------------------------------------------------------
 * ElevenLabs calls this endpoint (post-call webhook) after every phone call the
 * GTA Junk Phone Agent (GTJ-05P) answers. For each real customer call it:
 *
 *   1. Emails Fabian, by submitting the hidden Netlify form "phone-lead"
 *      (index.html). Netlify's form notification sends the email, the same
 *      way website leads arrive.
 *   2. Texts the caller a thank-you with the number to text photos to and the
 *      upload link — only if the caller said yes to a text during the call.
 *
 * ENVIRONMENT VARIABLES (Netlify → Site configuration → Environment variables)
 *   ELEVENLABS_WEBHOOK_SECRET  HMAC secret shown when the webhook is created
 *   TWILIO_ACCOUNT_SID         Twilio account that owns +1 365 536 5494
 *                              (also read from TwilioSSID, the name first used)
 *   TWILIO_AUTH_TOKEN          its auth token
 * Without the Twilio pair the email still goes out; the text is skipped.
 * Without the webhook secret every request is refused.
 *
 * CPS HOT TUB MOVERS — Sam (website AI guide, agent_6001m6vxt0rhfja8m6wfkh8s0zps)
 * The same webhook also handles Sam: every conversation where the visitor said
 * something is emailed to Fabian through the CPS site's "ai-lead" form, and the
 * visitor is texted from the CPS Twilio number (env CPS_SMS_FROM, e.g.
 * +1XXXXXXXXXX) if they gave a number and agreed to a text. Never from the
 * GTA Junk number: each business texts from its own number.
 *
 * Retries: ElevenLabs may resend a webhook. Each conversation id is recorded
 * in Netlify Blobs so a caller is never texted twice for one call.
 */

const crypto = require('crypto');
const blobs = require('@netlify/blobs');

const PHONE_AGENT_ID = 'agent_6001m70cw8jnfvp9q7kpkjfcksr6';
const SMS_FROM = '+13655365494';
const PHOTO_NUMBER = '416-659-5401';
const UPLOAD_URL = 'https://gtajunkandpropertycleanout.ca/fast-quote/';
const SITE_URL = 'https://gtajunkandpropertycleanout.ca';
const MAX_SKEW_SECONDS = 30 * 60;

function verifySignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=')).filter((p) => p.length === 2)
  );
  const t = parts.t;
  const v0 = parts.v0;
  if (!t || !v0) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > MAX_SKEW_SECONDS) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v0);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Data collection fields come back as { value, rationale, ... } objects. The
// agent's fields are shared workspace items, so ElevenLabs may key them by an
// internal id rather than by the name (gtj_caller_name). Find each one by its
// key, by any name/id property, by its name appearing anywhere in the entry,
// or by the opening words of the description written for it.
const DESCRIPTION_STARTS = {
  gtj_caller_name: /^The caller's first name/i,
  gtj_callback_number: /callback number|best number|phone number|number to call/i,
  gtj_job: /^What needs to be removed/i,
  gtj_town: /^The town or neighbourhood/i,
  gtj_timing: /^When the customer needs/i,
  gtj_summary: /summary of the call/i,
  gtj_text_ok: /^True only if the caller clearly said yes/i,
  cps_name: /^CPS: the visitor's first name/i,
  cps_phone: /^CPS: the visitor's phone number/i,
  cps_job: /^CPS: the hot tub job/i,
  cps_town: /^CPS: the town/i,
  cps_timing: /^CPS: when the visitor/i,
  cps_text_ok: /^CPS: true only if the visitor clearly said yes/i,
  cps_summary: /^CPS: a 2-3 sentence summary/i,
  pa_name: /^PA: the caller's name/i,
  pa_phone: /^PA: a different callback number/i,
  pa_caller_type: /^PA: who is calling/i,
  pa_reason: /^PA: the message for Fabian/i,
  pa_callback: /^PA: when the caller would like/i,
  pa_urgent: /^PA: true only if the caller said it is urgent/i
};

const SAM_AGENT_ID = 'agent_6001m6vxt0rhfja8m6wfkh8s0zps';
const CPS_SITE_URL = 'https://cpshottubmovers.ca';
const CPS_PHOTO_NUMBER = '647-204-0632';
const CPS_QUOTE_URL = 'https://cpshottubmovers.ca/#quote';

// Fabian's personal assistant: answers his 647 cell after 3 rings.
const PA_AGENT_ID = 'agent_1101m77r6zt5f8fa8zshse39tjyv';
const FABIAN_CELL = '+16472040632';

function entries(results) {
  if (!results) return [];
  if (Array.isArray(results)) return results.map((r, i) => [String(i), r]);
  return Object.entries(results);
}

function findEntry(results, name) {
  const list = entries(results);
  const byKey = list.find(([k]) => k === name);
  if (byKey) return byKey[1];
  const byProp = list.find(([, r]) => r && [r.data_collection_id, r.name, r.identifier, r.json_schema && r.json_schema.name].includes(name));
  if (byProp) return byProp[1];
  const byText = list.find(([, r]) => r && JSON.stringify(r).includes(`"${name}"`));
  if (byText) return byText[1];
  const re = DESCRIPTION_STARTS[name];
  const byDesc = re && list.find(([, r]) => {
    const desc = r && ((r.json_schema && r.json_schema.description) || r.description || '');
    return desc && re.test(desc);
  });
  return byDesc ? byDesc[1] : null;
}

function field(results, name) {
  const r = findEntry(results, name);
  if (!r || r.value === null || r.value === undefined) return '';
  return String(r.value).trim();
}

// Shape of the results without any caller details, for the function log.
function describeShape(results) {
  return entries(results).map(([k, r]) => {
    const props = r && typeof r === 'object' ? Object.keys(r).join('/') : typeof r;
    const desc = r && r.json_schema && r.json_schema.description ? r.json_schema.description.slice(0, 30) : '';
    return `${k}{${props}}${desc ? ' "' + desc + '"' : ''}`;
  }).join(' | ');
}

function yes(value) {
  return /^(true|yes|y|ok|okay|sure)$/i.test(String(value).trim());
}

// Accept only a North American number; return it as +1XXXXXXXXXX.
function toE164(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}

function pretty(e164) {
  const d = e164.replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

function firstName(name) {
  const n = String(name || '').trim().split(/\s+/)[0] || '';
  return /^[A-Za-zÀ-ÿ'’-]{1,30}$/.test(n) ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}

async function emailFabian(lead) {
  const body = new URLSearchParams({ 'form-name': 'phone-lead', ...lead });
  const res = await fetch(`${SITE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  return res.ok;
}

async function textCaller(to, name, opts = {}) {
  const from = opts.from || SMS_FROM;
  if (!from) return 'skipped: no texting number set for this business';
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.TwilioSSID;
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.TwilioAUTHToken;
  if (!sid || !token) return 'skipped: Twilio keys not set';
  const hello = name ? `Hi ${name}, thanks` : 'Thanks';
  const message = opts.message ? opts.message(hello) :
    `${hello} for calling GTA Junk and Property Cleanout. Fabian will call you back soon. ` +
    `To get your price faster, text photos or a short video of the job to ${PHOTO_NUMBER}, ` +
    `or upload them here: ${UPLOAD_URL} Reply STOP to opt out.`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString()
  });
  if (res.ok) return 'sent';
  const err = await res.json().catch(() => ({}));
  return `failed: ${err.code || res.status} ${err.message || ''}`.trim();
}

// Sam (CPS website guide): email every real conversation, text if agreed.
async function handleSam(data, results, convId) {
  const turns = Array.isArray(data.transcript) ? data.transcript : [];
  const userTurns = turns.filter((t) => t && t.role === 'user' && String(t.message || '').trim()).length;
  if (turns.length && userTurns === 0) return { emailed: false, text: 'skipped: visitor said nothing' };

  const name = field(results, 'cps_name');
  const phone = toE164(field(results, 'cps_phone'));
  const summary = field(results, 'cps_summary') || (data.analysis && data.analysis.transcript_summary) || '';
  const job = field(results, 'cps_job');
  const town = field(results, 'cps_town');

  let text = 'skipped: no number given';
  if (phone && yes(field(results, 'cps_text_ok'))) {
    text = await textCaller(phone, firstName(name), {
      from: process.env.CPS_SMS_FROM,
      message: (hello) =>
        `${hello} for chatting with CPS Hot Tub Movers. Fabian will be in touch soon. ` +
        `For a flat-rate quote, text photos of your hot tub and the path to it to ${CPS_PHOTO_NUMBER}, ` +
        `or send them here: ${CPS_QUOTE_URL} Reply STOP to opt out.`
    });
  } else if (phone) {
    text = 'skipped: visitor did not agree to a text';
  }

  const subjectBits = [name || 'Visitor', town, job].filter(Boolean).join(', ');
  const form = {
    'form-name': 'ai-lead',
    subject: `[CPS] Sam conversation: ${subjectBits}`.slice(0, 140),
    name: name || '(not given)',
    phone: phone ? pretty(phone) : '(not given)',
    town,
    job_type: job,
    preferred_time: field(results, 'cps_timing'),
    details: `Text to customer: ${text}`,
    conversation_summary: summary,
    page: convId ? `https://elevenlabs.io/app/agents/history/${convId}` : 'Sam conversation'
  };
  const res = await fetch(`${CPS_SITE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  });
  return { emailed: res.ok, text };
}

// Personal assistant: email Fabian and text his cell after every real call.
async function handleAssistant(data, results, convId) {
  const turns = Array.isArray(data.transcript) ? data.transcript : [];
  const userTurns = turns.filter((t) => t && t.role === 'user' && String(t.message || '').trim()).length;
  const phoneMeta = (data.metadata && data.metadata.phone_call) || {};
  const dyn = (data.conversation_initiation_client_data && data.conversation_initiation_client_data.dynamic_variables) || {};
  const callerId = toE164(phoneMeta.external_number || dyn.system__caller_id);
  const callback = toE164(field(results, 'pa_phone')) || callerId;
  const name = field(results, 'pa_name');
  const type = field(results, 'pa_caller_type');
  const reason = field(results, 'pa_reason');
  const when = field(results, 'pa_callback');
  const urgent = yes(field(results, 'pa_urgent'));
  const summary = (data.analysis && data.analysis.transcript_summary) || '';
  const silent = turns.length && userTurns === 0;
  const spam = /sales|spam/i.test(type);

  const who = [name || 'Caller', callback ? pretty(callback) : 'no number'].join(', ');
  let text = 'skipped';
  if (!spam) {
    const msg = silent
      ? `Missed call from ${callerId ? pretty(callerId) : 'a hidden number'}. They hung up without talking to your assistant.`
      : `${urgent ? 'URGENT. ' : ''}Missed call: ${who}${type ? ' (' + type + ')' : ''}. ` +
        `${reason || summary}`.trim() + (when ? ` Call back: ${when}.` : '');
    text = await textCaller(FABIAN_CELL, '', { from: process.env.PA_SMS_FROM, message: () => msg.slice(0, 600) });
  }

  if (silent && !callerId) return { emailed: false, text };
  const form = {
    'form-name': 'ai-lead',
    subject: `${urgent ? '[URGENT] ' : ''}[Assistant] Missed call: ${who}${type ? ' - ' + type : ''}`.slice(0, 140),
    name: name || '(not given)',
    phone: callback ? pretty(callback) : '(not given)',
    town: '',
    job_type: type,
    preferred_time: when,
    details: [reason, `Caller ID: ${callerId ? pretty(callerId) : 'hidden'}`, `Urgent: ${urgent ? 'yes' : 'no'}`, `Text to you: ${text}`].filter(Boolean).join('\n'),
    conversation_summary: silent ? 'Caller hung up without speaking.' : summary,
    page: convId ? `https://elevenlabs.io/app/agents/history/${convId}` : 'Assistant call'
  };
  const res = await fetch(`${CPS_SITE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  });
  return { emailed: res.ok, text };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  const sigHeader = event.headers['elevenlabs-signature'] || event.headers['ElevenLabs-Signature'];
  if (!verifySignature(raw, sigHeader, process.env.ELEVENLABS_WEBHOOK_SECRET)) {
    return { statusCode: 401, body: 'bad signature' };
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return { statusCode: 400, body: 'bad json' }; }

  // Only full transcripts from the GTA Junk phone agent. Everything else
  // (Sam, Rocky, audio or failure events) is acknowledged and ignored.
  const data = payload.data || {};
  if (payload.type !== 'post_call_transcription' || ![PHONE_AGENT_ID, SAM_AGENT_ID, PA_AGENT_ID].includes(data.agent_id)) {
    return { statusCode: 200, body: 'ignored' };
  }

  const convId = data.conversation_id || '';
  // Blobs are only for de-duplicating retries; never let them block a lead.
  let store = null;
  try {
    if (blobs.connectLambda) blobs.connectLambda(event);
    store = blobs.getStore('phone-leads');
    if (convId && (await store.get(convId))) return { statusCode: 200, body: 'already handled' };
  } catch (e) { store = null; }

  const results = (data.analysis && data.analysis.data_collection_results) || {};
  console.log('phone-lead', data.agent_id, convId, 'fields:', describeShape(results));

  if (data.agent_id === SAM_AGENT_ID || data.agent_id === PA_AGENT_ID) {
    const res = data.agent_id === SAM_AGENT_ID ? await handleSam(data, results, convId) : await handleAssistant(data, results, convId);
    if (store && convId) {
      try { await store.set(convId, JSON.stringify({ at: new Date().toISOString(), ...res })); } catch (e) {}
    }
    return { statusCode: 200, body: JSON.stringify(res) };
  }
  const phoneMeta = (data.metadata && data.metadata.phone_call) || {};
  const dyn = (data.conversation_initiation_client_data && data.conversation_initiation_client_data.dynamic_variables) || {};
  const callerId = toE164(phoneMeta.external_number || dyn.system__caller_id);
  const callback = toE164(field(results, 'gtj_callback_number')) || callerId;

  const name = field(results, 'gtj_caller_name');
  const summary = field(results, 'gtj_summary') || (data.analysis && data.analysis.transcript_summary) || '';
  const isJunkCall = /sales call|robocall|wrong number|spam/i.test(summary) && !field(results, 'gtj_job');

  const lead = {
    name: name || '(not given)',
    phone: callback ? pretty(callback) : '(not given)',
    caller_id: callerId ? pretty(callerId) : '(hidden)',
    job: field(results, 'gtj_job'),
    town: field(results, 'gtj_town'),
    timing: field(results, 'gtj_timing'),
    summary,
    text_sent: '',
    call_length: data.metadata && data.metadata.call_duration_secs ? `${data.metadata.call_duration_secs}s` : '',
    conversation: convId ? `https://elevenlabs.io/app/agents/history/${convId}` : ''
  };

  // Text the caller only for a real enquiry, a usable mobile-style number,
  // and a clear yes to "can I text you the link?" during the call.
  if (!isJunkCall && callback && yes(field(results, 'gtj_text_ok'))) {
    lead.text_sent = await textCaller(callback, firstName(name));
  } else {
    lead.text_sent = isJunkCall ? 'skipped: not a customer' : !callback ? 'skipped: no number' : 'skipped: caller did not agree to a text';
  }

  const emailed = await emailFabian(lead);
  if (store && convId) {
    try { await store.set(convId, JSON.stringify({ at: new Date().toISOString(), emailed, text: lead.text_sent })); } catch (e) {}
  }

  return { statusCode: 200, body: JSON.stringify({ emailed, text: lead.text_sent }) };
};
