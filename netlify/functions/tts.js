/**
 * GTA Junk and Property Cleanout — Rocky's voice
 * ===========================================================================
 * POST /api/tts  { text: "..." }  ->  audio/mpeg
 *
 * Speaks Rocky's replies in Fabian's cloned ElevenLabs voice.
 *
 * WHY THIS IS A PROXY AND NOT A BROWSER CALL
 *   ELEVENLABS_API_KEY stays on the server. A key shipped to the browser is a
 *   key anyone can read and spend.
 *
 * WHY THE TEXT IS SCREENED AGAIN HERE
 *   This endpoint takes text from the client, so on its own it would happily
 *   speak anything anyone posted to it — including a price this business has
 *   never published, in Fabian's own voice. That is a worse failure than the
 *   same sentence appearing as text, because a recording of the owner saying
 *   a number sounds like a quote. Every string is run through the same
 *   unapprovedFigures() guard as the chat endpoint before it is synthesised.
 *
 * COST CONTROL
 *   ElevenLabs bills per character. Text is capped, the endpoint is rate
 *   limited per IP, and the widget only calls it when the listener has
 *   switched speech on. Without those three a single scraper is a bill.
 *
 * DEGRADES QUIETLY
 *   With no ELEVENLABS_API_KEY configured this returns 503 and the widget
 *   falls back to the browser's built-in speech, which is free and already
 *   working. Voice never breaks the page.
 */

'use strict';

const P = require('./_pricing.js');

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'z6myX5PHKvJ1HNM76e3S'; // Fabian
const MODEL = 'eleven_turbo_v2_5';     // low latency, cheapest per character
const MAX_CHARS = 700;
const RATE_LIMIT = { windowMs: 60000, max: 20 };

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < RATE_LIMIT.windowMs)) hits.delete(k);
  return arr.length > RATE_LIMIT.max;
}

function fail(code, reason) {
  return {
    statusCode: code,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: reason })
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return fail(405, 'POST only');

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (rateLimited(ip)) return fail(429, 'slow down');

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return fail(503, 'voice not configured');   // widget falls back to browser speech

  let text;
  try {
    text = String(JSON.parse(event.body || '{}').text || '').trim().slice(0, MAX_CHARS);
  } catch { return fail(400, 'bad json'); }
  if (!text) return fail(400, 'no text');

  // The guard, again. This endpoint must never voice an unpublished price.
  const bad = P.unapprovedFigures(text);
  if (bad.length) {
    console.error('tts: refused to speak unapproved figures:', bad.join(' '));
    return fail(422, 'unapproved figure');
  }

  try {
    const res = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(VOICE_ID) + '?output_format=mp3_22050_32',
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: MODEL,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true }
        })
      }
    );
    if (!res.ok) {
      console.error('tts: elevenlabs', res.status, (await res.text().catch(() => '')).slice(0, 200));
      return fail(502, 'voice upstream failed');
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      body: buf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error('tts: failure', err && err.message);
    return fail(502, 'voice upstream failed');
  }
};
