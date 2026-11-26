// Runs after every verified form submission on this site and turns GTA Junk
// enquiries (website forms, Rocky, AI phone line via phone-lead) into CRM leads.
// Logic: netlify/lib/crm-intake.js.
import { getStore } from '@netlify/blobs';
import intake from '../lib/crm-intake.js';

export default async (req) => {
  const body = await req.json().catch(() => ({}));
  const res = await intake.handle(body, getStore({ name: 'crm', consistency: 'strong' }));
  return new Response(res.body, { status: res.statusCode });
};
