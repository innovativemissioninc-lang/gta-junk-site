/**
 * Rocky test harness. Run with: node test-rocky.js
 *
 * The guard is the whole safety argument for letting an AI discuss price on a
 * site where the owner's promise is "the number we write down is the number
 * you pay". So it gets tested, not assumed.
 */
'use strict';
const P = require('./netlify/functions/_pricing.js');
const R = require('./netlify/functions/rocky.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  <- ' + extra : '')); }
}

console.log('\n1. Published figures are accepted');
[
  'Estate clearances run $2,000 to $4,500.',
  'The Signature finish is $3,200.',
  'Hoarding runs $4,000 to $12,000+, with Tier 2 from $8,000.',
  'Hot tubs are from $550, or from $900 with the deck.',
  'Commercial work is $2,500 to $7,500.',
  'Demolition is $1,800 to $4,500.',
  'Pools are $1,500 to $3,200.',
  'We carry $2 million in liability and the minimum is $1,500.'
].forEach(s => ok(JSON.stringify(s.slice(0, 44)), P.unapprovedFigures(s).length === 0, P.unapprovedFigures(s).join(' ')));

console.log('\n2. Invented figures are caught — this is the point of the guard');
[
  ['averaged a range',        'That would be about $3,250.'],
  ['invented hourly rate',    'We charge $149 per hour.'],
  ['invented per-yard rate',  'About $85 per cubic yard.'],
  ['split the difference',    'Call it $5,000 for yours.'],
  ['discount Rocky cannot give', 'I can do it for $1,200.'],
  ['under-minimum quote',     'A single couch is $180.'],
  ['decimal creep',           'Roughly $2,750.50 all in.'],
  ['plausible but unpublished', 'Garages are $1,600 to $2,900.'],
  ['malformed grouping',       'That comes to $5,00 even.'],
  ['unpublished inside a published sentence', 'From $550, or $700 with the deck.']
].forEach(([n, s]) => ok(n, P.unapprovedFigures(s).length > 0, 'guard did NOT catch: ' + s));

console.log('\n2b. Regression: sentence punctuation must not be read as part of the figure');
[
  'Hot tub removal is from $550, or from $900 with the surrounding deck.',
  'The minimum engagement is $1,500.',
  'Hoarding projects reach $12,000+, sometimes more.',
  'Estate work is $2,000 to $4,500; the Signature finish is $3,200.'
].forEach(s => ok(JSON.stringify(s.slice(0, 40)), P.unapprovedFigures(s).length === 0, P.unapprovedFigures(s).join(' ')));

console.log('\n3. Refusals are decided in code, not by the model');
[
  ['asbestos',   'the shed might have asbestos siding', 'hazardous'],
  ['paint tins', 'there are 40 tins of old paint',      'hazardous'],
  ['propane',    'two propane tanks in the garage',     'hazardous'],
  ['needles',    'there are needles and sharps',        'biohazard'],
  ['animal waste','years of animal waste on the floor', 'biohazard'],
  ['panel',      'can you disconnect the breaker panel','electrical']
].forEach(([n, q, expect]) => {
  const r = P.refusalFor(q);
  ok(n + ' -> ' + expect, r && r.key === expect, r ? 'got ' + r.key : 'got nothing');
});

console.log('\n4. Refusal replies never claim capability we lack');
P.REFUSALS.forEach(r => {
  const t = r.reply.toLowerCase();
  ok(r.key + ': no WSIB claim', !t.includes('wsib'));
  ok(r.key + ': no licensed-remediation self-claim',
     !/we are (a )?licensed/.test(t) && !/we can remediate/.test(t));
  ok(r.key + ': prices clean', P.unapprovedFigures(r.reply).length === 0);
});

console.log('\n5. Classifier routes the things people actually type');
[
  ['my mother passed away and the house needs clearing', 'estate'],
  ['cant walk through the house, packed floor to ceiling', 'hoarding'],
  ['need the shed torn down', 'demolition'],
  ['above ground pool and deck gone', 'pool'],
  ['hot tub removal', 'hottub'],
  ['tenant left our commercial unit full', 'commercial'],
  ['flood damage, insurance claim debris', 'insurance'],
  ['carpet out before the MLS listing', 'prelisting'],
  ['garage is full of junk', 'garage']
].forEach(([q, expect]) => {
  const s = P.classify(q);
  ok(JSON.stringify(q.slice(0, 38)) + ' -> ' + expect, s && s.key === expect, s ? 'got ' + s.key : 'got nothing');
});

console.log('\n6. The deterministic fallback is always price-safe and always caveated');
[null].concat(P.SERVICES).forEach(svc => {
  const out = R._internals.fallbackReply(svc);
  const label = svc ? svc.key : 'no-match';
  ok(label + ': no unpublished figure', P.unapprovedFigures(out.reply).length === 0,
     P.unapprovedFigures(out.reply).join(' '));
  if (svc) {
    ok(label + ': states the range verbatim', out.reply.includes(svc.range));
    ok(label + ': caveats the on-site assessment', /on-site assessment/i.test(out.reply));
  }
});
ok('deflection is price-clean', P.unapprovedFigures(R._internals.SAFE_DEFLECTION).length === 0);

console.log('\n7. The system prompt states every published range and the hard rules');
const sys = R._internals.buildSystemPrompt('/estate-cleanouts/');
P.SERVICES.forEach(s => ok('prompt carries ' + s.key + ' range', sys.includes(s.range)));
[
  ['non-hazardous only', /NON-HAZARDOUS WASTE ONLY/],
  ['never claim WSIB', /Never claim WSIB/],
  ['no electrical disconnection', /ESA-licensed/],
  ['AI disclosure', /AI guide, not a person/],
  ['never invent a figure', /Never add, average, interpolate/],
  ['never promise a discount', /Never promise a discount/],
  ['answers before contact details', /Never withhold an answer behind a request for contact/],
  ['30% deposit', /30% deposit/],
  ['page context injected', /\/estate-cleanouts\//]
].forEach(([n, rx]) => ok('prompt: ' + n, rx.test(sys)));
ok('prompt itself contains no unpublished figure', P.unapprovedFigures(sys).length === 0,
   P.unapprovedFigures(sys).join(' '));

console.log('\n8. History sanitising');
const san = R._internals.sanitiseMessages;
ok('drops leading assistant turn', san([{role:'assistant',content:'hi'},{role:'user',content:'q'}])[0].role === 'user');
ok('drops junk roles', san([{role:'system',content:'x'},{role:'user',content:'q'}]).length === 1);
ok('truncates long input', san([{role:'user',content:'x'.repeat(5000)}])[0].content.length === 1200);
ok('caps turn count', san(Array.from({length:60},(_,i)=>({role:i%2?'assistant':'user',content:'m'+i}))).length <= 24);
ok('empty in, empty out', san(null).length === 0);

console.log('\n' + (fail ? 'FAILED ' + fail + ' / ' : 'ALL ') + (pass + fail) + ' assertions' + (fail ? '' : ' passed'));
process.exit(fail ? 1 : 0);
