/**
 * CRM intake (wrapped by netlify/functions/submission-created.mjs). Runs automatically after every VERIFIED form
 * submission on this site (spam-filtered submissions never reach it).
 * Turns each GTA Junk enquiry into a CRM lead (store "crm").
 *
 * phone-lead.js posts the AI phone agent's calls to the "phone-lead" form, so
 * phone calls arrive here too. Forms that are not customer enquiries
 * (partner-enquiry and partner-referral become partner records/leads) are
 * mapped below. Errors are logged and swallowed: a CRM problem must never
 * break the form email Fabian already gets.
 */
const { addInboundLead, newId, clean, prettyPhone } = require('./crm-lib');

const SOURCES = {
  'quote-request': 'Website form',
  'fast-quote': 'Photo/video quote',
  'site-assessment': 'Site assessment form',
  'rocky-lead': 'Rocky (website AI)',
  'phone-lead': 'AI phone agent',
  'estate-cleanout-lead': 'Estate cleanout page',
  'hoarding-cleanout-lead': 'Hoarding cleanout page',
  'restoration-debris-lead': 'Restoration page',
  'prelisting-cleanout-lead': 'Pre-listing page',
  'pool-deck-lead': 'Pool/deck page',
  'partner-referral': 'Partner referral'
};

function pick(d, ...keys) {
  for (const k of keys) if (d[k] && String(d[k]).trim() && !/^\(not given\)$/i.test(String(d[k]).trim())) return String(d[k]).trim();
  return '';
}

exports.handle = async (body, store) => {
  try {
    const p = body.payload || {};
    const form = p.form_name || (p.data && p.data['form-name']) || '';
    const d = p.data || {};

    if (form === 'partner-enquiry') {
      const now = new Date().toISOString();
      const partner = {
        id: newId('P'), created: now, updated: now,
        type: clean(pick(d, 'partner-type', 'vertical', 'type'), 60) || 'Other',
        name: clean(pick(d, 'name'), 120), company: clean(pick(d, 'company', 'business'), 120),
        phone: prettyPhone(pick(d, 'phone')), email: clean(pick(d, 'email'), 200),
        area: clean(pick(d, 'city', 'town', 'area'), 120),
        stage: 'Interested', lastTouch: now.slice(0, 10), nextTouch: '', referrals: 0,
        notes: [{ at: now, by: 'Website', text: clean(pick(d, 'details', 'notes', 'message'), 3000) || 'Partner enquiry from website form.' }]
      };
      await store.setJSON(`partner/${partner.id}`, partner);
      return { statusCode: 200, body: 'partner saved' };
    }

    const source = SOURCES[form];
    if (!source) return { statusCode: 200, body: `ignored form ${form}` };

    const links = [];
    if (d.conversation) links.push(d.conversation);
    for (const k of ['photos', 'media']) if (d[k] && /^https?:/.test(String(d[k]))) links.push(String(d[k]));

    const details = [
      pick(d, 'details', 'notes', 'message', 'description'),
      pick(d, 'summary', 'conversation_summary') && `Summary: ${pick(d, 'summary', 'conversation_summary')}`,
      pick(d, 'property') && `Property: ${pick(d, 'property')}`,
      pick(d, 'finish-level') && `Finish level: ${pick(d, 'finish-level')}`,
      pick(d, 'caller_id') && `Caller ID: ${pick(d, 'caller_id')}`,
      pick(d, 'call_length') && `Call length: ${pick(d, 'call_length')}`,
      pick(d, 'text_sent') && `Auto-text: ${pick(d, 'text_sent')}`,
      pick(d, 'page') && `Page: ${pick(d, 'page')}`
    ].filter(Boolean).join('\n');

    const res = await addInboundLead(store, {
      source,
      name: pick(d, 'name'),
      phone: pick(d, 'phone'),
      email: pick(d, 'email'),
      address: pick(d, 'address'),
      town: pick(d, 'town', 'city', 'postal'),
      job: pick(d, 'job', 'service', 'job_type'),
      timing: pick(d, 'timing', 'timeline', 'preferred-date'),
      details,
      note: details,
      links
    });
    return { statusCode: 200, body: JSON.stringify(res) };
  } catch (e) {
    console.error('crm submission-created failed:', e && e.message);
    return { statusCode: 200, body: 'logged' };
  }
};
