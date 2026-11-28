// Twilio "Call status changes" webhook for the AI phone line.
// Set in Twilio: Phone Numbers -> (AI number) -> Voice -> Call status changes (HTTP POST):
//   https://gtajunkandpropertycleanout.ca/api/call-status
// The ElevenLabs AI keeps owning the main voice webhook; this only listens.
// Every call the AI picks up (calls you missed on (416) 659-5401 after ~3 rings)
// is logged on the caller's CRM lead, or creates a new lead, and you get a text.
import { getStore } from '@netlify/blobs';
import smsIn from '../lib/crm-sms-in.js';
import lib from '../lib/crm-lib.js';
import notify from '../lib/crm-notify.js';

const URL = 'https://gtajunkandpropertycleanout.ca/api/call-status';

export default async (req) => {
  const params = Object.fromEntries(new URLSearchParams(await req.text()));
  if (!smsIn.validSignature(URL, params, req.headers.get('x-twilio-signature'))) return new Response('Forbidden', { status: 403 });
  if (params.CallStatus !== 'completed' && params.CallStatus !== 'no-answer' && params.CallStatus !== 'busy') return new Response('ok');
  const from = params.From || '';
  if (lib.digits(from).length < 10) return new Response('ok');
  const secs = Number(params.CallDuration || 0);
  const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
  const via = params.ForwardedFrom ? ` (forwarded from ${lib.prettyPhone(params.ForwardedFrom)})` : '';
  const note = `Phone call ${when}${via}: you missed it and the AI receptionist took it` +
    (secs ? ` (${Math.floor(secs / 60)}m ${secs % 60}s).` : ` - caller hung up before talking.`) +
    ' Call them back.';
  const store = getStore({ name: 'crm', consistency: 'strong' });
  const res = await lib.addInboundLead(store, { source: 'Phone call', phone: from, note, details: note });
  await notify.notifyOwner(store, res.id, { merged: res.merged, source: 'missed call, AI answered' });
  return new Response('ok');
};

export const config = { path: '/api/call-status', method: 'POST' };
