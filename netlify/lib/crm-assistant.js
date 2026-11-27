/**
 * Voice/text assistant for the GTA Junk CRM.
 * Claude reads and updates the CRM through the tools below. Anything that
 * reaches a customer (a text, a quote link, an invoice link) is NEVER sent
 * here: it comes back as a "pending action" card, and the person taps Send
 * in the app, which calls the sendSms action.
 */
const { STATUSES, clean, prettyPhone, listRecords, newId } = require('./crm-lib');
const { getSettings, saveDoc, docUrl } = require('./crm-docs');

const MODEL = 'claude-sonnet-5-5';
const MAX_TURNS = 8;

function torontoNow() {
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const human = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  return { date, human };
}

const TOOLS = [
  { name: 'find_leads', description: 'Search CRM leads/customers by name, phone, town, job or status. Returns short summaries with ids. Use before acting on a customer the user names.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Name, phone digits, town or job words. Empty = all.' }, status: { type: 'string', enum: [...STATUSES, 'Open', 'Any'] } } } },
  { name: 'get_lead', description: 'Full details, notes and quotes/invoices for one lead.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_lead', description: 'Add a new lead/customer.', input_schema: { type: 'object', properties: { name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, town: { type: 'string' }, job: { type: 'string' }, details: { type: 'string' }, source: { type: 'string' } }, required: ['name'] } },
  { name: 'update_lead', description: 'Change fields on a lead: status, contact info, job, quote amount, final price, job date (YYYY-MM-DD) and time (HH:MM 24h), crew lead, follow-up date. Use this to schedule, reschedule, book or mark done.',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: STATUSES }, name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, town: { type: 'string' }, job: { type: 'string' }, details: { type: 'string' }, quote: { type: 'string' }, price: { type: 'string' }, jobDate: { type: 'string' }, jobTime: { type: 'string' }, crew: { type: 'string' }, followUp: { type: 'string' }, lostReason: { type: 'string' } }, required: ['id'] } },
  { name: 'add_note', description: 'Add a note to a lead (what the customer said, access details, items, etc.).', input_schema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'schedule', description: 'Booked jobs, follow-ups and partner visits between two dates (inclusive). Use to answer "what do we have Tuesday", find free slots, or plan the week.',
    input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['from', 'to'] } },
  { name: 'create_quote', description: 'Create a written quote for a lead with line items (prices BEFORE HST, in dollars). Only use prices the user stated; never invent them. Sets the lead to Quoted. Returns the customer link; then use draft_text to send it.',
    input_schema: { type: 'object', properties: { leadId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { desc: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } }, required: ['desc', 'price'] } }, discount: { type: 'number' }, notes: { type: 'string', description: 'Scope details shown on the quote: what is included, access, exclusions.' }, jobDate: { type: 'string' } }, required: ['leadId', 'items'] } },
  { name: 'create_invoice', description: 'Create an invoice for a lead (usually after the job is Done). Line items before HST. paid = deposit or amount already received. Sets the lead to Done with the final price. Returns the customer link; then use draft_text to send it.',
    input_schema: { type: 'object', properties: { leadId: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { desc: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } }, required: ['desc', 'price'] } }, discount: { type: 'number' }, paid: { type: 'number' }, notes: { type: 'string' }, fromQuoteId: { type: 'string', description: 'Copy the line items from this quote if the user says "invoice the quote".' } }, required: ['leadId'] } },
  { name: 'mark_paid', description: 'Record a payment on an invoice (amount in dollars). Marks it Paid when the balance reaches zero.', input_schema: { type: 'object', properties: { docId: { type: 'string' }, amount: { type: 'number' } }, required: ['docId', 'amount'] } },
  { name: 'draft_text', description: 'Prepare a text message to a customer or partner. It is NOT sent: the user sees it and taps Send. Write it in a calm, professional, friendly voice from GTA Junk and Property Cleanout; first name only; no emojis unless asked. Include any quote/invoice link you created.',
    input_schema: { type: 'object', properties: { leadId: { type: 'string' }, partnerId: { type: 'string' }, to: { type: 'string', description: 'Phone number if no lead/partner.' }, body: { type: 'string' }, purpose: { type: 'string', enum: ['reply', 'quote', 'invoice', 'booking', 'reminder', 'review', 'followup', 'other'] } }, required: ['body'] } },
  { name: 'find_partners', description: 'Search referral partners (realtors, estate lawyers, property managers...).', input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'log_partner_visit', description: 'Log a card drop / visit / call with a partner and set the next touch date.', input_schema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' }, nextTouch: { type: 'string' }, stage: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'add_partner', description: 'Add a referral partner.', input_schema: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, company: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, address: { type: 'string' }, area: { type: 'string' }, nextTouch: { type: 'string' } } } }
];

const brief = (l) => ({ id: l.id, name: l.name, phone: l.phone, status: l.status, job: l.job, town: l.town, address: l.address, quote: l.quote, price: l.price, jobDate: l.jobDate, jobTime: l.jobTime, crew: l.crew, followUp: l.followUp, created: (l.created || '').slice(0, 10) });

async function runTool(name, input, ctx) {
  const { store, me, pending, changed } = ctx;
  const now = new Date().toISOString();
  const leads = ctx.leads || (ctx.leads = await listRecords(store, 'lead/'));
  const getLead = async (id) => store.get(`lead/${id}`, { type: 'json' });
  const saveLead = async (l, note) => {
    l.updated = now; l.unread = false;
    if (note) l.notes = [{ at: now, by: `${me.name} (assistant)`, text: note, auto: true }, ...(l.notes || [])];
    await store.setJSON(`lead/${l.id}`, l);
    const i = leads.findIndex((x) => x.id === l.id); if (i >= 0) leads[i] = l; else leads.unshift(l);
    changed.leads = true;
  };

  switch (name) {
    case 'find_leads': {
      const q = clean(input.query, 100).toLowerCase(); const qd = q.replace(/\D/g, '');
      let list = leads.filter((l) => !q || [l.name, l.town, l.job, l.address, l.email].join(' ').toLowerCase().includes(q) || (qd.length >= 3 && String(l.phone).replace(/\D/g, '').includes(qd)));
      if (input.status && input.status !== 'Any') list = list.filter((l) => input.status === 'Open' ? !['Done', 'Lost'].includes(l.status) : l.status === input.status);
      return { count: list.length, leads: list.slice(0, 15).map(brief) };
    }
    case 'get_lead': {
      const l = await getLead(input.id); if (!l) return { error: 'No lead with that id' };
      const docs = (await listRecords(store, 'doc/')).filter((d) => d.leadId === l.id).map((d) => ({ id: d.id, type: d.type, status: d.status, total: d.total, balance: d.balance, link: docUrl(d) }));
      return { ...brief(l), email: l.email, details: l.details, source: l.source, reviewAsked: l.reviewAsked, notes: (l.notes || []).slice(0, 8).map((n) => `${n.at.slice(0, 10)} ${n.by}: ${n.text}`), docs };
    }
    case 'create_lead': {
      const l = { id: newId('L'), created: now, status: 'New', notes: [], links: [], source: clean(input.source, 60) || `Added by ${me.name}` };
      for (const f of ['name', 'email', 'address', 'town', 'job', 'details']) l[f] = clean(input[f], 1000);
      l.phone = prettyPhone(input.phone);
      await saveLead(l, 'Lead added by voice.');
      return { created: brief(l) };
    }
    case 'update_lead': {
      const l = await getLead(input.id); if (!l) return { error: 'No lead with that id' };
      const ch = [];
      for (const [k, v] of Object.entries(input)) {
        if (k === 'id' || v === undefined) continue;
        if (k === 'status' && !STATUSES.includes(v)) continue;
        const val = k === 'phone' ? prettyPhone(v) : clean(v, 2000);
        if ((l[k] || '') !== val) { ch.push(`${k}: ${l[k] || '—'} → ${val || '—'}`); l[k] = val; }
      }
      if (l.status === 'Done' && !l.price && l.quote) l.price = l.quote;
      await saveLead(l, ch.join(' · ') || null);
      return { updated: brief(l), changes: ch };
    }
    case 'add_note': {
      const l = await getLead(input.id); if (!l) return { error: 'No lead with that id' };
      l.notes = [{ at: now, by: me.name, text: clean(input.text, 3000) }, ...(l.notes || [])];
      await saveLead(l); return { ok: true };
    }
    case 'schedule': {
      const inRange = (d) => d && d >= input.from && d <= input.to;
      const partners = await listRecords(store, 'partner/');
      return {
        jobs: leads.filter((l) => l.status === 'Booked' && inRange(l.jobDate)).sort((a, b) => (a.jobDate + a.jobTime).localeCompare(b.jobDate + b.jobTime)).map(brief),
        followUps: leads.filter((l) => !['Done', 'Lost'].includes(l.status) && inRange(l.followUp)).map(brief),
        partnerVisits: partners.filter((p) => inRange(p.nextTouch)).map((p) => ({ id: p.id, name: p.name, company: p.company, nextTouch: p.nextTouch, address: p.address }))
      };
    }
    case 'create_quote':
    case 'create_invoice': {
      const l = await getLead(input.leadId); if (!l) return { error: 'No lead with that id' };
      const type = name === 'create_quote' ? 'quote' : 'invoice';
      let items = input.items;
      if (type === 'invoice' && (!items || !items.length) && input.fromQuoteId) {
        const q = await store.get(`doc/${input.fromQuoteId}`, { type: 'json' }); items = q ? q.items : [];
      }
      if (!items || !items.length) return { error: 'Need at least one line item with a price. Ask the user for the price.' };
      const doc = await saveDoc(store, { type, leadId: l.id, items, discount: input.discount, paid: input.paid, notes: input.notes, jobDate: input.jobDate || l.jobDate,
        customerName: l.name, customerPhone: l.phone, customerEmail: l.email, customerAddress: [l.address, l.town].filter(Boolean).join(', ') }, me.name, ctx.settings);
      if (type === 'quote') { l.quote = String(doc.subtotal - (doc.discount || 0)); if (['New', 'Contacted'].includes(l.status)) l.status = 'Quoted'; if (!l.followUp) l.followUp = addDays(ctx.today, 2); }
      else { l.price = String(doc.subtotal - (doc.discount || 0)); l.status = 'Done'; }
      await saveLead(l, `${type === 'quote' ? 'Quote' : 'Invoice'} ${doc.id} created: $${doc.total.toFixed(2)}${doc.tax ? ' incl. HST' : ''}.`);
      ctx.docs.push({ id: doc.id, type, total: doc.total, link: docUrl(doc) });
      return { id: doc.id, type, subtotal: doc.subtotal, tax: doc.tax, total: doc.total, deposit: doc.deposit, balance: doc.balance, hstCharged: !!doc.tax, link: docUrl(doc) };
    }
    case 'mark_paid': {
      const d = await store.get(`doc/${input.docId}`, { type: 'json' }); if (!d) return { error: 'No document with that id' };
      const doc = await saveDoc(store, { id: d.id, paid: (d.paid || 0) + Number(input.amount || 0) }, me.name, ctx.settings);
      if (doc.balance <= 0 && doc.status !== 'Paid') await saveDoc(store, { id: doc.id, status: 'Paid' }, me.name, ctx.settings);
      const l = doc.leadId && await getLead(doc.leadId); if (l) await saveLead(l, `Payment $${Number(input.amount).toFixed(2)} recorded on ${doc.id}. Balance $${doc.balance.toFixed(2)}.`);
      return { id: doc.id, paid: doc.paid, balance: doc.balance };
    }
    case 'draft_text': {
      let to = input.to, who = '';
      if (input.leadId) { const l = await getLead(input.leadId); if (l) { to = l.phone; who = l.name; } }
      if (input.partnerId) { const p = await store.get(`partner/${input.partnerId}`, { type: 'json' }); if (p) { to = p.phone; who = p.name || p.company; } }
      const digits = String(to || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (digits.length !== 10) return { error: 'No valid phone number for this person. Ask the user for it.' };
      pending.push({ kind: 'sms', to: '+1' + digits, who, leadId: input.leadId || '', partnerId: input.partnerId || '', purpose: input.purpose || 'other', body: clean(input.body, 1200) });
      return { drafted: true, note: 'Shown to the user with a Send button. Not sent yet.' };
    }
    case 'find_partners': {
      const q = clean(input.query, 100).toLowerCase();
      const ps = (await listRecords(store, 'partner/')).filter((p) => !q || [p.name, p.company, p.area, p.type].join(' ').toLowerCase().includes(q));
      return { partners: ps.slice(0, 15).map((p) => ({ id: p.id, name: p.name, company: p.company, type: p.type, stage: p.stage, phone: p.phone, area: p.area, nextTouch: p.nextTouch, lastTouch: p.lastTouch })) };
    }
    case 'log_partner_visit': {
      const p = await store.get(`partner/${input.id}`, { type: 'json' }); if (!p) return { error: 'No partner with that id' };
      p.notes = [{ at: now, by: me.name, text: clean(input.text, 2000) }, ...(p.notes || [])];
      p.lastTouch = ctx.today; if (input.nextTouch) p.nextTouch = clean(input.nextTouch, 10); if (input.stage) p.stage = clean(input.stage, 40);
      else if (p.stage === 'To visit') p.stage = 'Card dropped';
      p.updated = now; await store.setJSON(`partner/${p.id}`, p); changed.partners = true;
      return { ok: true, nextTouch: p.nextTouch };
    }
    case 'add_partner': {
      const p = { id: newId('P'), created: now, updated: now, stage: 'To visit', referrals: 0, notes: [{ at: now, by: me.name, text: 'Added by voice.', auto: true }] };
      for (const f of ['type', 'name', 'company', 'email', 'address', 'area', 'nextTouch']) p[f] = clean(input[f], 300);
      p.phone = prettyPhone(input.phone); if (!p.type) p.type = 'Other';
      await store.setJSON(`partner/${p.id}`, p); changed.partners = true; return { created: { id: p.id, name: p.name, company: p.company } };
    }
  }
  return { error: 'Unknown tool' };
}

function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

function systemPrompt(me, settings, now) {
  return `You are the voice assistant inside the GTA Junk and Property Cleanout CRM, talking with ${me.name} (${me.role}). Now: ${now.human} (Toronto). Today = ${now.date}.
The business: premium, white-glove junk removal, estate/property/garage/hoarding (non-biohazard) cleanouts, commercial cleanouts and light demolition across Toronto and the GTA. Phone ${settings.phone}. Published pricing: junk removal and garage cleanouts by finish level — The Clear-Out from $495, The Standard Reset from $795, The Pristine Transformation from $1,195; estate cleanouts have a $1,500 minimum charge (standard clear typically $2,000, Signature $3,200, up to $7,000+); hot tub removal from $550 ($900 with deck); hoarding $4,000–12,000+; demolition $1,800–4,500. Prices are before HST, fixed in writing, never hourly. ${settings.depositPct}% deposit confirms a booking and comes off the final invoice. ${settings.hstNumber ? `HST ${settings.hstRate}% is charged (HST # ${settings.hstNumber}).` : 'No HST number is set in Settings yet, so quotes/invoices show no HST line — mention this once if the user creates a quote or invoice.'}

How to work:
- The user is usually speaking on the phone, often on a job site. Keep replies SHORT (1–3 sentences), plain words, no markdown tables. Read back the key facts (name, date, amount) so they can catch mistakes.
- Always look the customer up with find_leads first; if several match, ask which one. Use ids from tool results only.
- Never invent prices, dates, names or job details. If a price or date is missing, ask for it.
- Interpret relative dates ("Tuesday", "tomorrow at 9") against today and convert to YYYY-MM-DD / 24h HH:MM. Booking a job = update_lead status Booked + jobDate + jobTime. Check schedule() for clashes before booking and mention any.
- Texts, quotes and invoices: create the quote/invoice first, then draft_text with the link. Nothing reaches a customer until the user taps Send on the card — say "tap Send when it looks right".
- Typical texts: booking confirmation with date/time; day-before reminder; quote ("your fixed price is $X before HST, here's the written quote: link"); invoice after the job ("thanks, here's your invoice: link"); review request after a completed job (${settings.reviewUrl}) — ask every customer the same way, never ask for specific words or star ratings.
- Never claim biohazard, sharps or trauma cleanup. Never promise a firm price without photos or a site visit unless the user gives the price.
- You can't make phone calls, send email, or charge cards. The app has Call and Email buttons on each lead.`;
}

async function runAssistant({ store, me, history }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { reply: 'The assistant is not set up yet: the Anthropic API key is missing on Netlify.', pending: [], docs: [] };
  const settings = await getSettings(store);
  const now = torontoNow();
  const ctx = { store, me, settings, today: now.date, pending: [], docs: [], changed: {} };
  const messages = (history || []).slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: clean(m.text, 4000) })).filter((m) => m.content);
  while (messages.length && messages[0].role !== 'user') messages.shift();
  if (!messages.length) return { reply: 'What would you like to do?', pending: [], docs: [] };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: systemPrompt(me, settings, now), tools: TOOLS, messages })
    });
    if (!res.ok) { const t = await res.text(); console.error('assistant api', res.status, t.slice(0, 300)); return { reply: 'Sorry, the assistant had a problem. Try again in a moment.', pending: ctx.pending, docs: ctx.docs, changed: ctx.changed }; }
    const data = await res.json();
    messages.push({ role: 'assistant', content: data.content });
    const uses = data.content.filter((c) => c.type === 'tool_use');
    if (!uses.length || data.stop_reason !== 'tool_use') {
      const reply = data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
      return { reply: reply || 'Done.', pending: ctx.pending, docs: ctx.docs, changed: ctx.changed };
    }
    const results = [];
    for (const u of uses) {
      let out;
      try { out = await runTool(u.name, u.input || {}, ctx); } catch (e) { console.error('tool', u.name, e && e.message); out = { error: 'Tool failed: ' + (e && e.message) }; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 12000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'That took too many steps. Can you break it into smaller requests?', pending: ctx.pending, docs: ctx.docs, changed: ctx.changed };
}

module.exports = { runAssistant, TOOLS };
