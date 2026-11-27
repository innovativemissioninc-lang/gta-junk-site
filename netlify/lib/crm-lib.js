/**
 * GTA Junk CRM — shared storage helpers (Netlify Blobs, store "crm").
 * Keys:  lead/<id>   partner/<id>   user/<name>   config/secret
 * One record per key, so two people editing different leads never collide.
 */
const crypto = require('crypto');

const STATUSES = ['New', 'Contacted', 'Quoted', 'Booked', 'Done', 'Lost'];

function newId(prefix) {
  const t = Date.now().toString(36);
  return `${prefix}_${t}${crypto.randomBytes(3).toString('hex')}`;
}

function digits(s) {
  return String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

function prettyPhone(s) {
  const d = digits(s);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(s || '').trim();
}

function clean(v, max = 4000) {
  if (v === null || v === undefined) return '';
  return String(v).trim().slice(0, max);
}

async function listRecords(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const out = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json', consistency: 'strong' }).catch(() => null)));
  return out.filter(Boolean);
}

/** Find an open lead for the same phone in the last 14 days (so a caller who
 *  also fills the form becomes one lead with two notes, not two leads). */
async function findRecentByPhone(store, phone, email) {
  const d = digits(phone).slice(-10), e = String(email || '').trim().toLowerCase();
  if (d.length !== 10 && !e) return null;
  const leads = await listRecords(store, 'lead/');
  const cutoff = Date.now() - 14 * 864e5;
  return leads.find((l) => ((d.length === 10 && digits(l.phone).slice(-10) === d) || (e && String(l.email || '').toLowerCase() === e)) && !['Done', 'Lost'].includes(l.status) && Date.parse(l.created) > cutoff) || null;
}

async function addInboundLead(store, data) {
  const now = new Date().toISOString();
  const note = { at: now, by: data.source || 'system', text: clean(data.note, 6000) };
  const existing = await findRecentByPhone(store, data.phone, data.email);
  if (existing) {
    existing.notes = existing.notes || [];
    existing.notes.unshift({ ...note, text: `New ${data.source} enquiry. ${note.text}` });
    for (const k of ['email', 'town', 'address', 'job']) if (!existing[k] && data[k]) existing[k] = clean(data[k], 300);
    if (!existing.phone && data.phone) existing.phone = prettyPhone(data.phone);
    if ((!existing.name || existing.name === '(no name)') && data.name) existing.name = clean(data.name, 120);
    if (data.links && data.links.length) existing.links = [...(existing.links || []), ...data.links.filter(Boolean)].slice(-20);
    existing.unread = true;
    if (existing.status === 'New') existing.unread = true;
    if (data.partnerId && !existing.partnerId) existing.partnerId = clean(data.partnerId, 60);
    existing.updated = now;
    await store.setJSON(`lead/${existing.id}`, existing);
    return { id: existing.id, merged: true };
  }
  const lead = {
    id: newId('L'),
    created: now,
    updated: now,
    source: clean(data.source, 60),
    status: 'New',
    unread: true,
    name: clean(data.name, 120) || '(no name)',
    phone: prettyPhone(data.phone),
    email: clean(data.email, 200),
    address: clean(data.address, 300),
    town: clean(data.town, 120),
    job: clean(data.job, 300),
    details: clean(data.details, 6000),
    timing: clean(data.timing, 200),
    quote: '', price: '', jobDate: '', jobTime: '', crew: '', followUp: '', partnerId: clean(data.partnerId, 60),
    reviewAsked: '',
    links: (data.links || []).filter(Boolean).slice(0, 10),
    notes: note.text ? [note] : []
  };
  await store.setJSON(`lead/${lead.id}`, lead);
  return { id: lead.id, merged: false };
}

module.exports = { STATUSES, newId, digits, prettyPhone, clean, listRecords, addInboundLead };
