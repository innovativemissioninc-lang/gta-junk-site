/**
 * Quotes and invoices for the GTA Junk CRM.
 * Stored as doc/<id> in the "crm" store. Each doc has a random token; the
 * customer link is /crm/doc/?id=<id>&t=<token> (no login, unguessable).
 */
const crypto = require('crypto');
const { clean } = require('./crm-lib');

const DEFAULT_SETTINGS = {
  businessName: 'GTA Junk and Property Cleanout Inc.',
  phone: '(416) 659-5401',
  email: 'info@gtajunkandpropertycleanout.ca',
  website: 'gtajunkandpropertycleanout.ca',
  address: 'Toronto, ON',
  hstNumber: '',            // e.g. 123456789 RT0001 — HST is only charged when this is set
  hstRate: 13,
  depositPct: 30,
  quoteValidDays: 30,
  paymentInstructions: 'Interac e-Transfer to info@gtajunkandpropertycleanout.ca (auto-deposit), or cash/cheque on completion.',
  quoteTerms: 'Price is fixed for the scope described. A 30% deposit confirms the booking and comes off the final invoice. Balance due on completion after you walk the site with us. Heavy materials (soil, concrete, shingles, tile) are billed by the tonne with scale tickets.',
  invoiceTerms: 'Due on receipt. Thank you for choosing GTA Junk and Property Cleanout.',
  reviewUrl: 'https://g.page/r/CWUHyrYovKM_EAI/review',
  smsFrom: '+13655365494',
  ownerMobile: '+16472040632', // customer replies are forwarded here; daily brief goes here
  dailyBrief: 'on'
};

async function getSettings(store) {
  const s = await store.get('config/settings', { type: 'json' }).catch(() => null);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

function num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
const r2 = (n) => Math.round(n * 100) / 100;

function computeTotals(doc, settings) {
  const items = (doc.items || []).map((it) => ({ desc: clean(it.desc, 300), qty: num(it.qty) || 1, price: r2(num(it.price)) }))
    .filter((it) => it.desc || it.price);
  const subtotal = r2(items.reduce((s, it) => s + it.qty * it.price, 0));
  const discount = r2(Math.max(0, num(doc.discount)));
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = settings.hstNumber ? num(settings.hstRate) : 0;
  const tax = r2(taxable * taxRate / 100);
  const total = r2(taxable + tax);
  const paid = r2(Math.max(0, num(doc.paid)));
  const deposit = doc.type === 'quote' ? r2(total * num(settings.depositPct) / 100) : 0;
  return { items, subtotal, discount, taxRate, tax, total, paid, balance: r2(total - paid), deposit };
}

function docNumber(type) {
  const d = new Date(Date.now() - 5 * 36e5).toISOString().slice(2, 10).replace(/-/g, '');
  return `${type === 'quote' ? 'Q' : 'INV'}-${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/** Create or update a quote/invoice. Returns the saved doc. */
async function saveDoc(store, input, by, settings) {
  settings = settings || await getSettings(store);
  const now = new Date().toISOString();
  let doc = input.id ? await store.get(`doc/${input.id}`, { type: 'json' }) : null;
  if (!doc) {
    const type = input.type === 'invoice' ? 'invoice' : 'quote';
    const id = docNumber(type);
    doc = { id, type, token: crypto.randomBytes(12).toString('base64url'), created: now, status: 'Draft', createdBy: by };
  }
  for (const f of ['leadId', 'customerName', 'customerPhone', 'customerEmail', 'customerAddress', 'notes', 'jobDate']) if (f in input) doc[f] = clean(input[f], f === 'notes' ? 2000 : 300);
  for (const f of ['items', 'discount', 'paid']) if (f in input) doc[f] = input[f];
  if ('status' in input && ['Draft', 'Sent', 'Accepted', 'Declined', 'Paid', 'Void'].includes(input.status)) doc.status = input.status;
  if (doc.type === 'quote' && !doc.validUntil) doc.validUntil = new Date(Date.now() + settings.quoteValidDays * 864e5).toISOString().slice(0, 10);
  Object.assign(doc, computeTotals(doc, settings));
  doc.updated = now;
  await store.setJSON(`doc/${doc.id}`, doc);
  return doc;
}

function docUrl(doc, origin) {
  return `${origin || 'https://gtajunkandpropertycleanout.ca'}/crm/doc/?id=${encodeURIComponent(doc.id)}&t=${doc.token}`;
}

/** What the customer may see (no internal fields). */
function publicDoc(doc, settings) {
  const pick = ['id', 'type', 'status', 'created', 'validUntil', 'customerName', 'customerAddress', 'notes', 'jobDate', 'items', 'subtotal', 'discount', 'taxRate', 'tax', 'total', 'paid', 'balance', 'deposit', 'acceptedAt', 'acceptedName'];
  const out = Object.fromEntries(pick.filter((k) => k in doc).map((k) => [k, doc[k]]));
  out.business = {
    name: settings.businessName, phone: settings.phone, email: settings.email, website: settings.website, address: settings.address,
    hstNumber: settings.hstNumber, depositPct: settings.depositPct,
    terms: doc.type === 'quote' ? settings.quoteTerms : settings.invoiceTerms,
    payment: settings.paymentInstructions
  };
  return out;
}

async function sendSms(to, body, from) {
  const sid = process.env.TWILIO_ACCOUNT_SID || process.env.TwilioSSID;
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.TwilioAUTHToken;
  if (!sid || !token) return { ok: false, error: 'Texting is not set up (Twilio keys missing).' };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString()
  });
  if (res.ok) return { ok: true };
  const err = await res.json().catch(() => ({}));
  return { ok: false, error: `Text failed: ${err.message || res.status}` };
}

module.exports = { DEFAULT_SETTINGS, getSettings, computeTotals, saveDoc, docUrl, publicDoc, sendSms, num };
