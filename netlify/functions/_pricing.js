/**
 * GTA Junk and Property Cleanout — SINGLE SOURCE OF PRICING TRUTH
 * ===========================================================================
 * Every published price in the business lives here and nowhere else.
 *
 * WHY THIS FILE EXISTS
 *   Before this file, three places quoted prices independently: the homepage
 *   `makesOffer` schema ($495 / $795 / $1,195), the video-estimate function
 *   ($495-$620 / $795-$950), and the visible page copy ($1,500 minimum).
 *   A customer could film a garage, be shown "$495 to $620", then be told the
 *   minimum engagement is $1,500. That is the one thing this business says it
 *   will never do. Anything that quotes a price now imports from here.
 *
 * THE GUARANTEE ROCKY MUST NEVER BREAK
 *   Rocky quotes RANGES, never a firm number. The firm number is set in
 *   writing at a free on-site assessment. Every range Rocky gives must carry
 *   that caveat, because a range remembered as a promise is a lost customer.
 *
 * HOW THE HALLUCINATION GUARD WORKS
 *   ALLOWED_FIGURES below is generated from this table. After the model
 *   replies, rocky.js extracts every dollar figure in the reply and checks it
 *   against that set. A figure that is not in the set means the model invented
 *   a price, and the reply is discarded rather than shown. This makes an
 *   invented price structurally impossible rather than merely unlikely.
 */

'use strict';

const MINIMUM = 1500;
const DEPOSIT_PCT = 30;
const PHONE = '(647) 204-0632';
const PHONE_E164 = '+16472040632';
const EMAIL = 'gtajunkandpropertycleanout@gmail.com';
const MECP = 'R-004-5477911257';
const LIABILITY = '$2 million';

/**
 * The published service table.
 *
 *   key        stable identifier; the model classifies into this
 *   name       customer-facing service name
 *   low/high   published range in CAD. high === null means "starting at"
 *   range      the exact string Rocky is permitted to say. Pre-rendered so
 *              the model cannot reformat a number into something new.
 *   url        the page to link when this service is matched
 *   drivers    what actually moves the price, in plain language. Rocky uses
 *              these to explain WHY a range is wide instead of guessing.
 *   match      words that indicate this service, for the deterministic
 *              fallback estimator used when no API key is configured.
 */
const SERVICES = [
  {
    key: 'hoarding',
    name: 'Hoarding and heavy-clutter cleanout',
    low: 4000, high: 12000,
    range: '$4,000 to $12,000+',
    note: 'Tier 1 heavy clutter starts at $4,000. Severe accumulation with blocked access or multi-day scope runs $8,000 to $12,000+.',
    url: '/hoarding-cleanouts/',
    drivers: ['how many levels and rooms are affected', 'whether access and walkways are blocked', 'floor condition underneath', 'whether it is a one-day or multi-day scope', 'discretion requirements'],
    match: ['hoard', 'clutter', 'packed', 'cant walk', "can't walk", 'floor to ceiling', 'accumulat'],
    discreet: true
  },
  {
    key: 'commercial',
    name: 'Commercial cleanout and white-box decommissioning',
    low: 2500, high: 7500,
    range: '$2,500 to $7,500',
    note: 'Covers tenant-default clearing, cubicle and workstation teardown, and removal of fixtures, millwork, partitions, signage and abandoned cabling.',
    url: '/commercial-cleanouts/',
    drivers: ['square footage', 'how much is built in versus loose', 'dock and elevator access', 'after-hours or weekend windows', 'whether the unit must be handed back white-box'],
    match: ['commercial', 'office', 'tenant', 'white box', 'white-box', 'retail', 'warehouse', 'unit', 'lease', 'decommission']
  },
  {
    key: 'estate',
    name: 'Estate complete clearance',
    low: 2000, high: 7000,
    range: '$2,000 to $7,000+',
    note: 'A standard clear starts at $2,000 and the Signature finish is $3,200. Large or multi-level properties, full basements, garages and outbuildings run to $7,000 and beyond.',
    url: '/estate-cleanouts/',
    drivers: ['property size and number of levels', 'how full it is', 'basement, attic and garage access', 'how much needs itemising for the estate file', 'finish level'],
    match: ['estate', 'probate', 'executor', 'passed away', 'passed', 'deceased', 'inherit', 'mother', 'father', 'parent']
  },
  {
    key: 'demolition',
    name: 'Light structural demolition',
    low: 1800, high: 4500,
    range: '$1,800 to $4,500',
    note: 'Detached sheds, garages, sunrooms, porches and small additions, demolished and hauled in one mobilisation. The municipal permit is obtained before work begins and the fee is passed through at cost.',
    url: '/demolition-sheds-garages/',
    drivers: ['footprint and construction type', 'access for the trailer', 'whether the slab and footings come out too', 'whether the structure predates 1990 and needs an asbestos assessment', 'municipal permit fee, passed through at cost'],
    match: ['demolition', 'demo', 'tear down', 'teardown', 'shed', 'garage demo', 'sunroom', 'porch', 'addition', 'knock down', 'carport']
  },
  {
    key: 'insurance',
    name: 'Insurance and restoration debris removal',
    low: 1800, high: null,
    range: 'from $1,800',
    note: 'Heavy material is priced by the tonne with scale tickets supplied, so the invoice reconciles against the weight for the adjuster.',
    url: '/insurance-restoration-cleanouts/',
    drivers: ['tonnage of debris', 'whether it is fire, flood or demolition material', 'how much documentation the adjuster needs', 'site access and continuity of the haul'],
    match: ['insurance', 'restoration', 'adjuster', 'flood', 'fire', 'water damage', 'claim', 'mitigation']
  },
  {
    key: 'prelisting',
    name: 'Pre-sale rip-out and carpet extraction',
    low: 1500, high: 3500,
    range: '$1,500 to $3,500',
    note: 'Carpet, underlay and tack strip pulled to subfloor, dated built-ins and fixtures stripped out, property depersonalised for listing photographs.',
    url: '/pre-listing-cleanouts/',
    drivers: ['square footage of carpet', 'how many built-ins and fixtures come out', 'how much contents is left behind', 'how tight the MLS date is'],
    match: ['listing', 'mls', 'realtor', 'selling', 'sell', 'stage', 'staging', 'carpet', 'pre-sale', 'presale', 'agent']
  },
  {
    key: 'pool',
    name: 'Above-ground pool and deck removal',
    low: 1500, high: 3200,
    range: '$1,500 to $3,200',
    note: 'Includes draining to municipal requirements, dismantling wall, liner and frame, cutting down the surround deck, and hauling the sand base — commonly three to six tonnes.',
    url: '/pool-deck-removal/',
    drivers: ['pool diameter', 'how much surround deck and pergola comes down', 'tonnage of sand base underneath', 'gate and yard access for the trailer'],
    match: ['pool', 'above ground', 'above-ground', 'deck', 'pergola', 'liner']
  },
  {
    key: 'garage',
    name: 'Garage cleanout, Signature finish',
    low: 1500, high: null,
    range: 'from $1,500',
    note: 'Packed to the rafters back to bare, degreased concrete, usually in one visit.',
    url: '/services/garage-cleanouts/',
    drivers: ['single, double or triple garage', 'how full it is and how heavy the contents are', 'whether the floor is degreased at the end', 'driveway access'],
    match: ['garage', 'basement', 'attic', 'shed cleanout', 'house cleanout', 'property cleanout', 'junk removal', 'declutter']
  },
  {
    key: 'hottub',
    name: 'Hot tub and spa removal',
    low: 550, high: null,
    range: 'from $550, or from $900 with the surrounding deck',
    note: 'This is the one service offered below the $1,500 project minimum.',
    url: '/services/',
    drivers: ['tub size', 'whether the surrounding deck comes down too', 'gate and side-yard access', 'whether it has to come over a fence'],
    match: ['hot tub', 'hottub', 'spa', 'jacuzzi', 'swim spa']
  }
];

/** Things this business is registered and insured to do — and the things it is not. */
const REFUSALS = [
  {
    key: 'hazardous',
    match: ['asbestos', 'paint', 'solvent', 'chemical', 'propane', 'pesticide', 'fuel', 'oil drum', 'mercury', 'pcb'],
    reply: 'Our Ministry of the Environment registration (' + MECP + ') covers non-hazardous waste only, so we cannot transport paint, solvents, chemicals, propane, fuel or asbestos-containing material. Everything else in the load is fair game — we clear around it and point you to the right drop-off for that one item. Where a designated substance survey is required under the OHSA, abatement goes to a licensed abatement contractor and we handle the clearance after.'
  },
  {
    key: 'biohazard',
    match: ['biohazard', 'bio hazard', 'needle', 'sharps', 'feces', 'faeces', 'urine', 'blood', 'animal waste', 'dead animal', 'crime scene', 'decomposition', 'mould remediation', 'mold remediation'],
    reply: 'Confirmed biohazard is outside what we are registered to transport, so I will not pretend otherwise. We refer that to a licensed remediation contractor, and we come in after clearance to handle the volume — which is usually where the cost sits anyway. If you are not sure whether what you are looking at counts, book the walkthrough and Fabian will tell you straight.'
  },
  {
    key: 'electrical',
    match: ['disconnect the electrical', 'electrical disconnect', 'panel', 'breaker', 'hardwire', 'hard wire', 'rewire'],
    reply: 'Electrical disconnection needs an ESA-licensed electrical contractor, which we are not. For a hot tub, most are on a disconnect switch an electrician can isolate in minutes — once it is isolated, the removal is ours.'
  }
];

/* --------------------------------------------------------------------------
 * THE HALLUCINATION GUARD
 * Every dollar figure Rocky is permitted to utter. Generated from the table
 * above plus the handful of non-service figures that legitimately appear in
 * conversation, so the two can never drift apart.
 * ------------------------------------------------------------------------ */
function figureVariants(n) {
  const plain = String(n);
  const grouped = n.toLocaleString('en-CA');
  return [plain, grouped];
}

const EXTRA_FIGURES = [
  3200,    // the Signature estate finish
  8000,    // hoarding Tier 2 floor
  900,     // hot tub with deck
  1500,    // the minimum, quoted in its own right
  2        // "$2 million in commercial general liability"
];

const ALLOWED_FIGURES = new Set();
for (const s of SERVICES) {
  for (const n of [s.low, s.high]) {
    if (n != null) figureVariants(n).forEach(v => ALLOWED_FIGURES.add(v));
  }
}
for (const n of EXTRA_FIGURES) figureVariants(n).forEach(v => ALLOWED_FIGURES.add(v));

/**
 * Returns the list of dollar figures in `text` that this business has never
 * published. An empty array means the reply is safe to show.
 *
 * Sentence punctuation is stripped before comparison: "from $550, or from
 * $900 with the deck" is a published sentence, and an earlier version of this
 * function flagged it because the match swallowed the comma. Malformed digit
 * grouping ("$5,00") is treated as unapproved rather than normalised away,
 * because a mangled number in a price is not something to paper over.
 */
const WELL_FORMED = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;

function unapprovedFigures(text) {
  const found = String(text || '').match(/\$\s?[\d][\d,]*(?:\.\d+)?/g) || [];
  const bad = [];
  for (const raw of found) {
    let token = raw.replace(/^\$\s?/, '').replace(/[.,]+$/, '');
    if (!WELL_FORMED.test(token)) { bad.push(raw); continue; }
    token = token.replace(/\.00$/, '');
    if (!ALLOWED_FIGURES.has(token)) bad.push(raw);
  }
  return bad;
}

/** Deterministic classifier. Used by the no-API-key fallback and to pre-tag intent. */
function classify(text) {
  const t = (text || '').toLowerCase();
  let best = null, bestScore = 0;
  for (const s of SERVICES) {
    let score = 0;
    for (const m of s.match) if (t.includes(m)) score += m.length;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore > 0 ? best : null;
}

/** Any refusal triggered by this text, or null. */
function refusalFor(text) {
  const t = (text || '').toLowerCase();
  for (const r of REFUSALS) {
    for (const m of r.match) if (t.includes(m)) return r;
  }
  return null;
}

module.exports = {
  MINIMUM, DEPOSIT_PCT, PHONE, PHONE_E164, EMAIL, MECP, LIABILITY,
  SERVICES, REFUSALS, ALLOWED_FIGURES,
  unapprovedFigures, classify, refusalFor
};
