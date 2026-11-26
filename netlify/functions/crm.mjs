// GTA Junk CRM API. Logic lives in netlify/lib/crm-core.js (shared with tests).
// Modern function format so Netlify Blobs strong-consistency reads work.
import { getStore } from '@netlify/blobs';
import core from '../lib/crm-core.js';

export default async (req) => {
  const store = getStore({ name: 'crm', consistency: 'strong' });
  const headers = Object.fromEntries(req.headers);
  const res = await core.handle({ httpMethod: req.method, headers, body: req.method === 'POST' ? await req.text() : '' }, store);
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
};

export const config = { path: '/api/crm' };
