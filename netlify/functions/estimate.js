/**
 * GTA Junk and Property Cleanout — "See Your Price" video estimate endpoint
 * ---------------------------------------------------------------------------
 * SECURITY MODEL
 *   - ANTHROPIC_API_KEY lives ONLY in Netlify environment variables.
 *   - ALL pricing math happens here. The client never receives cubic yards,
 *     crew-hour figures, buffer multipliers, or raw model output.
 *   - The customer-facing payload is assembled explicitly in buildClientResponse().
 *     If a field isn't added there, it cannot leak.
 *
 * WHY WE PAD BEFORE PRICING
 *   Video reads low by nature — volume hides behind and underneath what the
 *   camera sees. We buffer the signal upward before selecting a tier so a
 *   customer is never quoted optimistically and then upcharged on site.
 *   Quoting high and holding the price is recoverable. Surprising someone on
 *   the day is the one thing we will not do.
 */

const { getStore } = require('@netlify/blobs');

// ---------------------------------------------------------------------------
// CALIBRATED CONSTANTS — server-side only, never serialised to the client
// ---------------------------------------------------------------------------
const TIERS = {
  clearOut: {
    key: 'clear-out',
    name: 'The Clear-Out',
    tagline: 'Total removal, zero friction',
    priceLow: 495,
    priceHigh: 620,
    showPrice: true,
    includes: [
      'Full haul-away — furniture, appliances, debris, the lot',
      'Heavy extraction (workbenches, shelving, hot tubs)',
      'Floor and wall protection before we start',
      'Broom-clean floor before we leave',
      'Donation and recycling sorting included'
    ]
  },
  standardReset: {
    key: 'standard-reset',
    name: 'The Standard Reset',
    tagline: 'Clean, clear, and ready',
    priceLow: 795,
    priceHigh: 950,
    showPrice: true,
    includes: [
      'Everything in The Clear-Out',
      'Full cobweb removal — walls, corners, ceiling',
      'Industrial sweep of the entire footprint',
      'Surface wipe-down of shelves and sills',
      'Ready for parking, storage, or staging'
    ]
  },
  pristine: {
    key: 'pristine-transformation',
    name: 'The Pristine Transformation',
    tagline: 'Like-new property detailing',
    // Deliberately no numbers. A job at this scope is never quoted from video.
    showPrice: false,
    includes: [
      'Everything in The Standard Reset',
      'Power degreasing of oil-stained concrete',
      'Wall-to-wall shop-vac detailing',
      'Air-blowing of dust from every corner',
      'Organisation and staging of what stays',
      'The list-ready, like-new handover'
    ]
  }
};

const BUFFER = { high: 1.1, medium: 1.2 }; // "low" never reaches pricing

// Internal signal model. Not exposed. Converts a volume read into a
// dollar-equivalent purely for tier boundary comparison.
const SIGNAL_PER_CUBIC_YARD = 55;

const MAX_FRAMES = 8;
const MAX_FRAME_BYTES = 1400000;   // ~1.4MB per frame after client-side compression
const MAX_TOTAL_BYTES = 7000000;

// ---------------------------------------------------------------------------
// VISION PROMPT
// NOTE: The original prototype prompt was not reachable from this environment.
// This is a faithful reconstruction against the documented output contract.
// If you have the original text, replace the string below verbatim.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an estimating assistant for a premium junk removal and property cleanout company in Toronto. You are looking at still frames extracted from a customer's walkthrough video of a space they want cleared.

Your job is to read the space accurately and conservatively. You are NOT setting a price — you are reporting what you can see so a human pricing system can act on it.

Return ONLY a single valid JSON object, no prose, no markdown fences, with exactly these keys:

{
  "items": [
    { "label": "short plain-English item name", "quantity": <integer>, "bulk": "small" | "medium" | "large" }
  ],
  "estimated_cubic_yards": <number>,
  "hazard_flags": [ "<string>" ],
  "estimated_onsite_minutes": <integer>,
  "visibility_confidence": "high" | "medium" | "low",
  "confidence_note": "<one sentence, plain English, customer-appropriate>"
}

Guidance:

ITEMS — List distinct visible items or item groups. Group sensibly ("approx. 30 storage boxes" rather than 30 entries). Use everyday language a homeowner would use, not trade jargon.

ESTIMATED_CUBIC_YARDS — Estimate the loose volume of everything that would need to be removed. Reference points: a standard fridge is roughly 0.7 cubic yards; a three-seat sofa roughly 1.5; a pickup bed heaped roughly 3. Report what you can actually see. Do NOT inflate to be safe — the pricing system applies its own buffer downstream, and inflating here would double-count.

HAZARD_FLAGS — Flag only if visible: paint or solvent containers, propane tanks, chemical drums, suspected asbestos material (old pipe wrap, vermiculite, certain floor tiles), biohazard or heavy pest evidence, sharps, fuel containers, compressed gas cylinders. Use short descriptive strings. Empty array if none.

ESTIMATED_ONSITE_MINUTES — Total minutes for a three-person crew to remove everything visible AND complete a basic sweep. Account for carry distance, stairs, doorway width, whether items must be dismantled, and whether access looks tight. Be realistic rather than optimistic.

VISIBILITY_CONFIDENCE — This is the most important field. Be strict:
  "high"   — well lit, camera covered the space thoroughly, you can see floor, walls, and the full extent of the pile.
  "medium" — you can see most of the space but some areas are dark, obstructed, panned past too quickly, or you suspect volume behind or beneath what is visible.
  "low"    — footage is dark, blurred, very short, covers only part of the space, or you genuinely cannot judge the extent. Also use "low" if the frames don't appear to show a cleanout space at all.
When you are between two levels, choose the lower one.

CONFIDENCE_NOTE — One friendly sentence a customer will read. If confidence is low, say plainly what would help (better lighting, a slower pan, showing the far corners). Never mention pricing, tiers, or dollar figures.`;

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: Object.assign({}, headers, { Allow: 'POST, OPTIONS' }), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error_code: 'method_not_allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not configured');
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        ok: false,
        error_code: 'not_configured',
        message: "Our estimator is offline right now. Give us a call at (647) 204-0632 and we'll sort you out directly."
      })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error_code: 'bad_request' }) };
  }

  // Honeypot — bots fill hidden fields, humans don't.
  if (body.website_url) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, ignored: true }) };
  }

  const frames = Array.isArray(body.frames) ? body.frames.slice(0, MAX_FRAMES) : [];
  if (frames.length === 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error_code: 'no_frames', message: "We didn't receive any footage. Please try again." })
    };
  }

  let totalBytes = 0;
  for (let i = 0; i < frames.length; i++) {
    if (typeof frames[i] !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error_code: 'bad_frame' }) };
    }
    const bytes = Math.floor(frames[i].length * 0.75);
    if (bytes > MAX_FRAME_BYTES) {
      return { statusCode: 413, headers, body: JSON.stringify({ ok: false, error_code: 'frame_too_large' }) };
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return { statusCode: 413, headers, body: JSON.stringify({ ok: false, error_code: 'payload_too_large' }) };
  }

  const contact = sanitiseContact(body.contact || {});
  const estimateId = randomId();
  const clientIp = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';

  // ---- Vision analysis ----------------------------------------------------
  let analysis;
  try {
    analysis = await analyseFrames(frames, apiKey);
  } catch (err) {
    console.error('vision_call_failed', estimateId, err && err.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        ok: false,
        error_code: 'analysis_failed',
        message: "Something went wrong reading your walkthrough. Give us a call at (647) 204-0632 — we'll get you a number the quick way."
      })
    };
  }

  // ---- Pricing (SERVER-SIDE ONLY) ----------------------------------------
  const decision = decideTier(analysis);

  // ---- Calibration log ----------------------------------------------------
  const logRecord = {
    estimate_id: estimateId,
    created_at: new Date().toISOString(),
    frame_count: frames.length,
    payload_bytes: totalBytes,
    client_ip_hash: hashString(clientIp),
    detected_items: analysis.items,
    estimated_cubic_yards: analysis.estimated_cubic_yards,
    estimated_onsite_minutes: analysis.estimated_onsite_minutes,
    hazard_flags: analysis.hazard_flags,
    visibility_confidence: analysis.visibility_confidence,
    confidence_note: analysis.confidence_note,
    buffer_applied: decision.buffer,
    buffered_signal: decision.bufferedSignal,
    buffered_hours: decision.bufferedHours,
    tier_assigned: decision.tier ? decision.tier.key : null,
    price_low_shown: decision.tier && decision.tier.showPrice ? decision.tier.priceLow : null,
    price_high_shown: decision.tier && decision.tier.showPrice ? decision.tier.priceHigh : null,
    price_withheld_reason: decision.withheldReason || null,
    contact_name: contact.name,
    contact_phone: contact.phone,
    contact_email: contact.email,
    contact_city: contact.city,
    contact_notes: contact.notes,
    raw_model_output: analysis._raw || null
  };

  try {
    await persistEstimate(logRecord, frames);
  } catch (err) {
    // Logging must never block a customer from getting their answer.
    console.error('persist_failed', estimateId, err && err.message);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(buildClientResponse(estimateId, analysis, decision))
  };
};

// ---------------------------------------------------------------------------
// VISION CALL
// ---------------------------------------------------------------------------
async function analyseFrames(frames, apiKey) {
  const content = [];
  frames.forEach(function (data, i) {
    content.push({ type: 'text', text: 'Frame ' + (i + 1) + ' of ' + frames.length + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data } });
  });
  content.push({
    type: 'text',
    text: 'Analyse these frames and return the JSON object exactly as specified. No prose, no markdown fences.'
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: content }]
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(function () { return ''; });
    throw new Error('anthropic ' + res.status + ': ' + detail.slice(0, 300));
  }

  const payload = await res.json();
  const text = (payload.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('')
    .trim();

  return normaliseAnalysis(extractJson(text), text);
}

function extractJson(text) {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error('model did not return parseable JSON');
}

/** Defensive normalisation — a malformed field must never crash pricing. */
function normaliseAnalysis(raw, rawText) {
  const conf = String(raw.visibility_confidence || '').toLowerCase();
  return {
    items: Array.isArray(raw.items) ? raw.items.slice(0, 40).map(function (it) {
      return {
        label: String(it.label || 'Item').slice(0, 120),
        quantity: isFinite(+it.quantity) ? Math.max(1, Math.round(+it.quantity)) : 1,
        bulk: ['small', 'medium', 'large'].indexOf(String(it.bulk)) !== -1 ? it.bulk : 'medium'
      };
    }) : [],
    estimated_cubic_yards: clampNumber(raw.estimated_cubic_yards, 0, 200, 0),
    hazard_flags: Array.isArray(raw.hazard_flags)
      ? raw.hazard_flags.slice(0, 12).map(function (h) { return String(h).slice(0, 160); })
      : [],
    estimated_onsite_minutes: clampNumber(raw.estimated_onsite_minutes, 0, 3000, 0),
    visibility_confidence: ['high', 'medium', 'low'].indexOf(conf) !== -1 ? conf : 'low',
    confidence_note: String(raw.confidence_note || '').slice(0, 400),
    _raw: String(rawText).slice(0, 6000)
  };
}

function clampNumber(v, min, max, fallback) {
  const n = Number(v);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// PRICING — the only place tiers are chosen. Never runs client-side.
// ---------------------------------------------------------------------------
function decideTier(a) {
  // Low visibility: we do not price. Full stop.
  if (a.visibility_confidence === 'low') {
    return {
      tier: null,
      buffer: null,
      bufferedSignal: null,
      bufferedHours: null,
      withheldReason: 'low_visibility'
    };
  }

  const buffer = BUFFER[a.visibility_confidence] || BUFFER.medium;

  const rawHours = a.estimated_onsite_minutes / 60;
  const rawSignal = a.estimated_cubic_yards * SIGNAL_PER_CUBIC_YARD;

  const bufferedHours = rawHours * buffer;
  const bufferedSignal = rawSignal * buffer;

  // Boundaries skew to the higher tier: either condition promotes.
  let tier;
  if (bufferedHours >= 3.5 || bufferedSignal >= 900) {
    tier = TIERS.pristine;
  } else if (bufferedHours >= 2.5 || bufferedSignal >= 600) {
    tier = TIERS.standardReset;
  } else {
    tier = TIERS.clearOut;
  }

  return {
    tier: tier,
    buffer: buffer,
    bufferedSignal: bufferedSignal,
    bufferedHours: bufferedHours,
    withheldReason: tier.showPrice ? null : 'scope_requires_valuation'
  };
}

// ---------------------------------------------------------------------------
// CUSTOMER-FACING RESPONSE
// Explicit allow-list. Anything not written here cannot reach the browser.
// ---------------------------------------------------------------------------
function buildClientResponse(estimateId, a, d) {
  // --- Case 1: we couldn't see enough. No price, no guessing. ---
  if (d.withheldReason === 'low_visibility') {
    return {
      ok: true,
      estimate_id: estimateId,
      outcome: 'needs_clearer_look',
      headline: "Let's get a clearer look",
      message: a.confidence_note ||
        "We couldn't see quite enough of the space to give you an honest number — and we'd rather tell you that than guess.",
      tips: [
        'Turn on every light you have, and open the garage door or curtains',
        'Walk slowly — a steady pan beats a quick sweep',
        'Get the far corners, and pan down to the floor',
        'Twenty to sixty seconds of footage is plenty'
      ],
      actions: {
        retry_label: 'Try another walkthrough',
        book_label: 'Book a free on-site valuation',
        book_url: '/contact/',
        phone_label: 'Or call (647) 204-0632',
        phone_href: 'tel:+16472040632'
      }
    };
  }

  const tier = d.tier;
  const hazardNotes = a.hazard_flags.map(function (h) {
    return {
      flag: h,
      note: 'We bring the right disposal for this — it just needs handling separately from the rest of the load.'
    };
  });

  // --- Case 2: scope reads as Pristine. Never a number. ---
  if (!tier.showPrice) {
    return {
      ok: true,
      estimate_id: estimateId,
      outcome: 'valuation_required',
      tier_name: tier.name,
      tier_tagline: tier.tagline,
      headline: 'This one deserves a proper look',
      message: "From your walkthrough this reads as a Pristine Transformation — our most thorough finish. Jobs at this scope have too much riding on the details for us to quote from video, so we'll come out, walk it with you, and fix your price on the spot. Free, and no obligation.",
      includes: tier.includes,
      items: a.items,
      hazard_notes: hazardNotes,
      confidence_note: a.confidence_note || null,
      actions: {
        book_label: 'Book my free on-site valuation',
        book_url: '/contact/',
        phone_label: 'Or call (647) 204-0632',
        phone_href: 'tel:+16472040632'
      }
    };
  }

  // --- Case 3: a price range we're willing to stand behind. ---
  return {
    ok: true,
    estimate_id: estimateId,
    outcome: 'estimated',
    tier_name: tier.name,
    tier_tagline: tier.tagline,
    price_low: tier.priceLow,
    price_high: tier.priceHigh,
    price_display: '$' + tier.priceLow + '–$' + tier.priceHigh,
    headline: 'Looks like ' + tier.name,
    message: "That's our honest read from your walkthrough. We confirm it in person before anything moves — and once we agree the number on site, it doesn't change.",
    includes: tier.includes,
    items: a.items,
    hazard_notes: hazardNotes,
    confidence_note: a.confidence_note || null,
    actions: {
      book_label: 'Book this cleanout',
      book_url: '/contact/',
      phone_label: 'Or call (647) 204-0632',
      phone_href: 'tel:+16472040632'
    }
  };
}

// ---------------------------------------------------------------------------
// PERSISTENCE
// Default: Netlify Blobs (zero-config). Optional: Postgres via DATABASE_URL.
// ---------------------------------------------------------------------------
async function persistEstimate(record, frames) {
  // 1. Netlify Blobs — always on, no setup required.
  try {
    const store = getStore('estimates');
    await store.setJSON(record.created_at + '__' + record.estimate_id + '.json', record);

    const frameStore = getStore('estimate-frames');
    await Promise.all(frames.map(function (f, i) {
      const name = record.estimate_id + '/frame-' + String(i + 1).padStart(2, '0') + '.jpg';
      return frameStore.set(name, Buffer.from(f, 'base64'), { metadata: { contentType: 'image/jpeg' } });
    }));
  } catch (err) {
    console.error('blob_persist_failed', err && err.message);
  }

  // 2. Postgres — only if DATABASE_URL is configured (see schema.sql).
  if (!process.env.DATABASE_URL) return;
  try {
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO estimates (
        estimate_id, created_at, frame_count, client_ip_hash,
        detected_items, estimated_cubic_yards, estimated_onsite_minutes,
        hazard_flags, visibility_confidence, confidence_note,
        buffer_applied, buffered_signal, buffered_hours,
        tier_assigned, price_low_shown, price_high_shown, price_withheld_reason,
        contact_name, contact_phone, contact_email, contact_city, contact_notes,
        frames_storage_path
      ) VALUES (
        ${record.estimate_id}, ${record.created_at}, ${record.frame_count}, ${record.client_ip_hash},
        ${JSON.stringify(record.detected_items)}, ${record.estimated_cubic_yards}, ${record.estimated_onsite_minutes},
        ${JSON.stringify(record.hazard_flags)}, ${record.visibility_confidence}, ${record.confidence_note},
        ${record.buffer_applied}, ${record.buffered_signal}, ${record.buffered_hours},
        ${record.tier_assigned}, ${record.price_low_shown}, ${record.price_high_shown}, ${record.price_withheld_reason},
        ${record.contact_name}, ${record.contact_phone}, ${record.contact_email}, ${record.contact_city}, ${record.contact_notes},
        ${'estimate-frames/' + record.estimate_id + '/'}
      )`;
  } catch (err) {
    console.error('pg_persist_failed', err && err.message);
  }
}

// ---------------------------------------------------------------------------
// UTILITIES
// ---------------------------------------------------------------------------
function sanitiseContact(c) {
  function clean(v, n) {
    return (typeof v === 'string' ? v.trim().slice(0, n) : '') || null;
  }
  return {
    name: clean(c.name, 120),
    phone: clean(c.phone, 40),
    email: clean(c.email, 160),
    city: clean(c.city, 80),
    notes: clean(c.notes, 1000)
  };
}

function randomId() {
  return require('crypto').randomUUID();
}

function hashString(s) {
  return require('crypto').createHash('sha256').update(String(s)).digest('hex').slice(0, 32);
}
