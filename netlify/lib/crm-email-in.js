/**
 * Emails sent straight to info@ (not through a website form) reach the CRM
 * through a small Google Apps Script running in the info@ mailbox
 * (crm/email-to-crm.gs). It posts each new customer email here; the sender
 * becomes a lead (or the note is added to their existing lead) and the owner
 * gets a text. Auth: shared secret, only its SHA-256 lives in code.
 */
const crypto = require('crypto');
const { addInboundLead, clean } = require('./crm-lib');
const { notifyOwner } = require('./crm-notify');

const SECRET_HASH = '49090a780a0974b35bbf648e9873e35698cf19427f09ff08b1856cee3f9fb984';

async function handle({ secret, body, store }) {
  const h = crypto.createHash('sha256').update(String(secret || '')).digest('hex');
  if (h.length !== SECRET_HASH.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(SECRET_HASH))) return { status: 403, body: { error: 'forbidden' } };
  const email = clean(body.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { status: 400, body: { error: 'no sender email' } };
  const text = [body.subject && 'Subject: ' + clean(body.subject, 300), clean(body.text, 4000), body.attachments ? `[${body.attachments} attachment(s) – see the email]` : ''].filter(Boolean).join('\n');
  const res = await addInboundLead(store, { source: 'Email to info@', name: clean(body.name, 120), email, phone: clean(body.phone, 40), details: text, note: text, links: [body.link].filter((x) => /^https:\/\/mail\.google\.com\//.test(String(x || ''))) });
  await notifyOwner(store, res.id, { merged: res.merged, source: 'email' });
  return { status: 200, body: res };
}

module.exports = { handle };
