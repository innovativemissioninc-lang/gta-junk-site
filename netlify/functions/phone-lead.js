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

// Data collection fields come back as { value, rationale } objects.
function field(results, name) {
  const r = results && results[name];
  if (!r || r.value === null || r.value === undefined) return '';
  return String(r.value).trim();
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

async function textCaller(to, name) {
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.TwilioSSID;
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.TwilioAUTHToken;
  if (!sid || !token) return 'skipped: Twilio keys not set';
  const hello = name ? `Hi ${name}, thanks` : 'Thanks';
  const message =
    `${hello} for calling GTA Junk and Property Cleanout. Fabian will call you back soon. ` +
    `To get your price faster, text photos or a short video of the job to ${PHOTO_NUMBER}, ` +
    `or upload them here: ${UPLOAD_URL} Reply STOP to opt out.`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ To: to, From: SMS_FROM, Body: message }).toString()
  });
  if (res.ok) return 'sent';
  const err = await res.json().catch(() => ({}));
  return `failed: ${err.code || res.status} ${err.message || ''}`.trim();
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
  if (payload.type !== 'post_call_transcription' || data.agent_id !== PHONE_AGENT_ID) {
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
