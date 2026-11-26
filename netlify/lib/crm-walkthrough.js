/**
 * Video walkthrough estimator for the GTA Junk CRM (internal, for Fabian/crew).
 * The phone extracts still frames from the walkthrough video (Meta glasses or
 * phone camera) and sends them with the estimator's notes. Claude reads the
 * job; THIS FILE does the pricing math from the owner's estimating settings,
 * so the suggestion is consistent and every number is shown as a breakdown
 * the estimator can change before anything goes to the customer.
 */
const crypto = require('crypto');
const { clean, newId } = require('./crm-lib');
const { getSettings, num } = require('./crm-docs');

const MODEL = 'claude-sonnet-5-5';
const MAX_FRAMES = 20;

const ESTIMATOR_DEFAULTS = {
  minimum: 1500,        // published project minimum
  perYard: 85,          // $ per loose cubic yard removed (labour + loading + haul + disposal)
  trailerYards: 45,     // 20 ft dump trailer
  stairsPerFlight: 150, // per flight carried, applied once per job
  longCarry: 150,       // carry over ~75 ft / no close parking
  dismantlePerHour: 120,// dismantling / light demo per crew-hour beyond simple removal
  heavyPerTonne: 180,   // soil, concrete, shingles, tile (scale tickets)
  confidenceBuffer: { high: 1.0, medium: 1.12, low: 1.25 }
};

const PROMPT = `You are the estimating assistant for GTA Junk and Property Cleanout, a premium junk removal, estate/property/garage/hoarding (non-biohazard) cleanout and light demolition company in Toronto. You are looking at still frames from the OWNER'S OWN walkthrough video of a customer's job (filmed on Meta glasses or a phone), plus his spoken/typed notes. Your read goes into an internal quote that he will check and edit before the customer sees it.

Return ONLY one JSON object, no markdown:
{
  "job_type": "junk removal" | "estate cleanout" | "garage cleanout" | "basement cleanout" | "hoarding cleanout" | "commercial cleanout" | "light demolition" | "hot tub removal" | "other",
  "areas": ["short names of the rooms/areas seen, e.g. basement, garage, backyard shed"],
  "items": [{"label": "plain item or group", "quantity": <int>, "bulk": "small"|"medium"|"large"}],
  "cubic_yards": <number, loose volume of everything to remove, what you can see plus what the notes say>,
  "heavy_tonnes": <number, only soil/concrete/brick/shingles/tile/pool sand, else 0>,
  "stairs_flights": <int, flights the crew must carry down/up, from frames or notes>,
  "long_carry": <true|false, long walk to the truck, no driveway access, laneway, condo elevator>,
  "dismantle_hours": <number, crew-hours of dismantling/demolition beyond simple carry-out, else 0>,
  "crew_size": <int, 2-4>,
  "onsite_hours": <number, total hours on site for that crew incl. loading and a broom sweep>,
  "hazards": ["visible or mentioned: paint/solvents, propane, chemicals, fuel, suspected asbestos, mould, biohazard/sharps/pest waste"],
  "confidence": "high"|"medium"|"low",
  "missing": ["what you could not see that could change the price, e.g. 'far side of garage', 'what's inside closets'"],
  "scope_for_quote": "3-6 short lines in plain English for the customer's written quote: what's being removed, from where, what's included (loading, haul-away, disposal/recycling/donation, broom sweep), and anything excluded (e.g. items they are keeping). No prices.",
  "summary_for_owner": "2-3 sentences for the owner: the job, volume in trailer loads, main time drivers, risks."
}
Volume reference: fridge ~0.7 yd³, 3-seat sofa ~1.5, queen mattress+box ~1, pickup bed heaped ~3, single-car garage packed to shoulder height ~15-20, our 20 ft dump trailer holds ~45 loose yd³. Report what is really there; don't pad (pricing adds its own buffer) and don't lowball. Trust the owner's notes over the frames when they conflict (e.g. "there's a second room just like this"). If biohazard, sharps, trauma or heavy pest waste is involved, list it in hazards: the company does not do that work.`;

function priceFrom(read, est) {
  const conf = ['high', 'medium', 'low'].includes(read.confidence) ? read.confidence : 'medium';
  const yards = Math.max(0, num(read.cubic_yards));
  const lines = [];
  const volume = Math.round(yards * est.perYard * (est.confidenceBuffer[conf] || 1.12));
  lines.push({ desc: `Removal, loading, haul-away and disposal${read.areas && read.areas.length ? ' – ' + read.areas.join(', ') : ''} (approx. ${Math.round(yards)} cu yd${yards >= est.trailerYards * 0.5 ? ', ' + (Math.ceil(yards / est.trailerYards * 10) / 10) + ' trailer loads' : ''})`, qty: 1, price: volume, key: 'volume' });
  const flights = Math.max(0, Math.round(num(read.stairs_flights)));
  if (flights) lines.push({ desc: `Stair carry (${flights} flight${flights > 1 ? 's' : ''})`, qty: 1, price: est.stairsPerFlight * flights, key: 'stairs' });
  if (read.long_carry) lines.push({ desc: 'Long carry / limited truck access', qty: 1, price: est.longCarry, key: 'carry' });
  const dh = Math.max(0, num(read.dismantle_hours));
  if (dh) lines.push({ desc: 'Dismantling / light demolition', qty: Math.round(dh * 2) / 2, price: est.dismantlePerHour, key: 'dismantle' });
  const t = Math.max(0, num(read.heavy_tonnes));
  if (t) lines.push({ desc: 'Heavy materials by the tonne (scale tickets provided)', qty: Math.round(t * 10) / 10, price: est.heavyPerTonne, key: 'heavy' });
  let subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  if (subtotal < est.minimum) {
    lines[0].price += est.minimum - subtotal; lines[0].note = `raised to the $${est.minimum} project minimum`;
    subtotal = est.minimum;
  }
  // Round the headline to a clean number (nearest $25) by adjusting the main line.
  const rounded = Math.ceil(subtotal / 25) * 25;
  lines[0].price += rounded - subtotal;
  return { lines, subtotal: rounded, buffer: est.confidenceBuffer[conf] || 1.12, confidence: conf };
}

async function analyze({ store, me, leadId, frames, notes, checklist }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'The Anthropic API key is missing on Netlify.' };
  const imgs = (frames || []).filter((f) => typeof f === 'string' && f.startsWith('data:image/jpeg;base64,')).slice(0, MAX_FRAMES);
  if (imgs.length < 2) return { error: 'Need at least 2 frames from the video.' };
  const lead = leadId ? await store.get(`lead/${leadId}`, { type: 'json' }) : null;
  const settings = await getSettings(store);
  const est = { ...ESTIMATOR_DEFAULTS, ...(settings.estimator || {}) };
  est.confidenceBuffer = { ...ESTIMATOR_DEFAULTS.confidenceBuffer, ...((settings.estimator || {}).confidenceBuffer || {}) };

  const content = [];
  imgs.forEach((d, i) => {
    content.push({ type: 'text', text: `Frame ${i + 1} of ${imgs.length}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } });
  });
  content.push({ type: 'text', text: `Owner's notes: ${clean(notes, 3000) || '(none)'}\nWalkthrough checklist the owner confirmed: ${clean(checklist, 600) || '(none)'}\nCustomer: ${lead ? `${lead.name}, ${[lead.address, lead.town].filter(Boolean).join(', ')}. Lead details: ${clean(lead.details, 800)}` : 'not linked'}` });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system: PROMPT, messages: [{ role: 'user', content }] })
  });
  if (!res.ok) { console.error('walkthrough api', res.status, (await res.text()).slice(0, 300)); return { error: 'The AI could not read the video right now. Try again.' }; }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let read;
  try { read = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { return { error: 'The AI answer was unreadable. Try again.' }; }

  const price = priceFrom(read, est);
  const now = new Date().toISOString();
  const id = newId('W');
  // Keep up to 6 frames as a record for the crew (small JPEGs).
  const keep = imgs.filter((_, i) => i % Math.ceil(imgs.length / 6) === 0).slice(0, 6);
  for (let i = 0; i < keep.length; i++) await store.set(`media/${id}/${i}.jpg`, Buffer.from(keep[i].split(',')[1], 'base64'));
  const walk = { id, created: now, by: me.name, leadId: leadId || '', notes: clean(notes, 3000), checklist: clean(checklist, 600), read, price, frames: keep.length, token: crypto.randomBytes(8).toString('hex') };
  await store.setJSON(`walk/${id}`, walk);

  if (lead) {
    const hz = (read.hazards || []).length ? ` Hazards: ${read.hazards.join(', ')}.` : '';
    lead.notes = [{ at: now, by: `${me.name} (video estimate)`, text: `Video walkthrough: ${read.summary_for_owner || ''} ~${Math.round(num(read.cubic_yards))} cu yd, ${read.crew_size || 3} crew ~${read.onsite_hours || '?'} h. Suggested $${price.subtotal} before HST (${price.confidence} confidence).${hz}` }, ...(lead.notes || [])];
    if (!lead.job && read.job_type) lead.job = read.job_type;
    lead.checks = { ...(lead.checks || {}), walkthrough: now.slice(0, 10) };
    if (lead.status === 'New') lead.status = 'Contacted';
    lead.walkDoc = clean(checklist, 600);
    lead.updated = now;
    await store.setJSON(`lead/${lead.id}`, lead);
  }
  return { walk };
}

module.exports = { analyze, priceFrom, ESTIMATOR_DEFAULTS };
