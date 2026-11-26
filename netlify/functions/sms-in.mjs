// Twilio "A message comes in" webhook for the GTA Junk texting number.
// Set in Twilio: Phone Numbers → (365) 536-5494 → Messaging → Webhook (HTTP POST):
//   https://gtajunkandpropertycleanout.ca/api/sms-in
import { getStore } from '@netlify/blobs';
import smsIn from '../lib/crm-sms-in.js';

export default async (req) => {
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  const res = await smsIn.handle({
    url: 'https://gtajunkandpropertycleanout.ca/api/sms-in',
    params,
    signature: req.headers.get('x-twilio-signature'),
    store: getStore({ name: 'crm', consistency: 'strong' })
  });
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': 'text/xml' } });
};

export const config = { path: '/api/sms-in', method: 'POST' };
