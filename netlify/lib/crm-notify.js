/**
 * Lead alerts: every new lead (or a returning customer) that reaches the CRM
 * texts the owner's cell from the business texting number, with a link that
 * opens the lead in the CRM. Email alerts come from the inbox itself
 * (Netlify form notification -> info@, or the customer's own email).
 * Turn off with Settings: leadAlerts = 'off'.
 */
const { getSettings, sendSms } = require('./crm-docs');

const CRM = 'https://gtajunkandpropertycleanout.ca/crm/#/lead/';

async function notifyOwner(store, leadId, { merged, source } = {}) {
  try {
    const settings = await getSettings(store);
    if (settings.leadAlerts === 'off' || !settings.ownerMobile || !settings.smsFrom) return { skipped: true };
    const l = await store.get('lead/' + leadId, { type: 'json' });
    if (!l) return { skipped: true };
    const who = [l.name && l.name !== '(no name)' ? l.name : '', l.phone, l.email].filter(Boolean).join(', ') || 'no contact given';
    const what = [l.job, l.town].filter(Boolean).join(' – ');
    const head = merged ? `GTJ: ${l.name || 'Customer'} came back via ${source || l.source}` : `GTJ NEW LEAD (${source || l.source})`;
    const body = `${head}\n${who}${what ? '\n' + what : ''}${l.timing ? '\nWhen: ' + l.timing : ''}\nOpen: ${CRM}${l.id}`.slice(0, 600);
    return await sendSms(settings.ownerMobile, body, settings.smsFrom);
  } catch (e) { console.error('notifyOwner', e && e.message); return { ok: false }; }
}

module.exports = { notifyOwner };
