// Morning brief: 7:30 AM Toronto (12:30 UTC in winter / EST; 8:30 AM in summer EDT),
// texts the owner today's CRM to-do list from the job playbook.
import { getStore } from '@netlify/blobs';
import playbook from '../../crm/playbook.js';
import lib from '../lib/crm-lib.js';
import docsLib from '../lib/crm-docs.js';

export default async () => {
  const store = getStore({ name: 'crm', consistency: 'strong' });
  const settings = await docsLib.getSettings(store);
  if (settings.dailyBrief !== 'on' || !settings.ownerMobile) return new Response('off');
  const [leads, docs, partners] = await Promise.all([lib.listRecords(store, 'lead/'), lib.listRecords(store, 'doc/'), lib.listRecords(store, 'partner/')]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
  const t = playbook.tasks(leads, docs.map((d) => ({ ...d, url: docsLib.docUrl(d) })), partners, { today, settings, me: 'Fabian' });
  const jobs = leads.filter((l) => l.status === 'Booked' && l.jobDate === today);
  const owed = docs.filter((d) => d.type === 'invoice' && !['Paid', 'Void', 'Draft'].includes(d.status)).reduce((s, d) => s + (d.balance || 0), 0);
  if (!t.length && !jobs.length) return new Response('nothing');
  const lines = [`GTJ today: ${jobs.length} job${jobs.length === 1 ? '' : 's'}, ${t.length} to-do${t.length === 1 ? '' : 's'}${owed ? `, $${Math.round(owed).toLocaleString('en-CA')} unpaid` : ''}.`];
  for (const j of jobs) lines.push(`🚚 ${j.jobTime || ''} ${j.name}${j.address ? ', ' + j.address : ''}`.trim());
  for (const x of t.slice(0, 8)) lines.push(`${x.overdue || x.pri === 0 ? '❗' : '•'} ${x.title}`);
  if (t.length > 8) lines.push(`+${t.length - 8} more`);
  lines.push('Open: gtajunkandpropertycleanout.ca/crm');
  const r = await docsLib.sendSms(settings.ownerMobile, lines.join('\n').slice(0, 1500), settings.smsFrom);
  return new Response(r.ok ? 'sent' : r.error);
};

export const config = { schedule: '30 12 * * *' };
