// GTA Junk CRM API. Logic lives in netlify/lib/crm-core.js (shared with tests).
// Modern function format so Netlify Blobs strong-consistency reads work.
import core from '../lib/crm-core.js';

export default async (req) => {
  const headers = Object.fromEntries(req.headers);
  const res = await core.handle({ httpMethod: req.method, headers, body: req.method === 'POST' ? await req.text() : '' });
  return new Response(res.body, { status: res.statusCode, headers: res.headers });
};

export const config = { path: '/api/crm' };
