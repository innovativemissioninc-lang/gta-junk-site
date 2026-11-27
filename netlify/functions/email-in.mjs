// Receives customer emails forwarded by the Apps Script in the info@ mailbox.
import { getStore } from '@netlify/blobs';
import emailIn from '../lib/crm-email-in.js';

export default async (req) => {
  const body = await req.json().catch(() => ({}));
  const res = await emailIn.handle({ secret: req.headers.get('x-gtj-secret'), body, store: getStore({ name: 'crm', consistency: 'strong' }) });
  return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
};

export const config = { path: '/api/email-in', method: 'POST' };
