// Texts that arrive on the owner's phone for (416) 659-5401 (a Bell eSIM)
// are relayed here by an automation on that phone (iPhone Shortcut or
// Android SMS-forwarder app): JSON {from, text} with header x-gtj-secret.
// Each text is logged on the customer's CRM lead (or creates a new lead).
// No text alert is sent: the owner already has the text on that phone.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import smsIn from '../lib/crm-sms-in.js';
import lib from '../lib/crm-lib.js';

const SECRET_HASH = '292979114c852ab00148f9070fba7f87b3f3add6df1dea0e11b477e9b2c4f2d3';

export default async (req) => {
  const h = crypto.createHash('sha256').update(String(req.headers.get('x-gtj-secret') || '')).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(h), Buffer.from(SECRET_HASH))) return Response.json({ error: 'forbidden' }, { status: 403 });
  const raw = await req.text();
  let b = {};
  try { b = JSON.parse(raw); } catch { b = Object.fromEntries(new URLSearchParams(raw)); }
  const from = lib.clean(b.from || b.sender || b.From || '', 60);
  const text = lib.clean(b.text || b.message || b.body || b.Body || '', 1500);
  const digits = lib.digits(from);
  if (digits.length < 10) return Response.json({ skipped: 'sender is not a phone number' });
  if (!text) return Response.json({ skipped: 'empty' });
  const lead = await smsIn.logText(getStore({ name: 'crm', consistency: 'strong' }), { from, text, line: '(416)' });
  return Response.json({ ok: true, lead: lead.id });
};

export const config = { path: '/api/sms-relay', method: 'POST' };
