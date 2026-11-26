/**
 * Customer texts to the GTA Junk texting number (Twilio) land here:
 *  1. logged on the matching CRM lead (or a new lead is created), flagged
 *     "texted back" so it shows at the top of Today;
 *  2. forwarded to the owner's cell so nothing is missed on the road.
 * STOP/UNSUBSCRIBE marks the lead opted-out (Twilio also blocks further texts).
 */
const crypto = require('crypto');
const { clean, digits, prettyPhone, listRecords, newId } = require('./crm-lib');
const { getSettings } = require('./crm-docs');

function validSignature(url, params, sig) {
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.TwilioAUTHToken;
  if (!token || !sig) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const xmlEsc = (s) => String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

async function handle({ url, params, signature, store }) {
  if (!validSignature(url, params, signature)) return { status: 403, body: 'Forbidden' };
  const settings = await getSettings(store);
  const from = params.From || '';
  const text = clean(params.Body, 1500);
  const media = [...Array(Number(params.NumMedia || 0))].map((_, i) => params['MediaUrl' + i]).filter(Boolean);
  const now = new Date().toISOString();
  const d = digits(from);

  const leads = await listRecords(store, 'lead/');
  let lead = leads.filter((l) => digits(l.phone) === d).sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created))[0];
  if (!lead) {
    lead = { id: newId('L'), created: now, status: 'New', source: 'Text message', name: prettyPhone(from), phone: prettyPhone(from), notes: [], links: [], checks: {} };
  }
  lead.notes = [{ at: now, by: 'Customer (text)', text: text + (media.length ? `\n[${media.length} photo${media.length > 1 ? 's' : ''}]` : ''), in: true }, ...(lead.notes || [])];
  if (media.length) lead.links = [...(lead.links || []), ...media].slice(-20);
  lead.unread = true; lead.unreadReply = true; lead.updated = now;
  if (/^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i.test(text)) { lead.checks = { ...(lead.checks || {}), optOut: now.slice(0, 10) }; lead.unreadReply = false; }
  await store.setJSON(`lead/${lead.id}`, lead);

  const owner = settings.ownerMobile;
  if (!owner || digits(owner) === d) return { status: 200, body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' };
  const fwd = `GTJ text from ${lead.name && lead.name !== lead.phone ? lead.name + ' ' : ''}${prettyPhone(from)}: ${text}${media.length ? ' [' + media.length + ' photo(s) in CRM]' : ''}`.slice(0, 1500);
  return { status: 200, body: `<?xml version="1.0" encoding="UTF-8"?><Response><Message to="${xmlEsc(owner)}">${xmlEsc(fwd)}</Message></Response>` };
}

module.exports = { handle, validSignature };
