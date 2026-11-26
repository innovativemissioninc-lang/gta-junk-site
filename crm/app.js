/* GTA Junk CRM — single-page phone app. Data: POST /api/crm (see netlify/functions/crm.js). */
(function () {
  'use strict';
  const API = '/api/crm';
  const REVIEW_URL = 'https://g.page/r/CWUHyrYovKM_EAI/review';
  const BIZ = 'GTA Junk and Property Cleanout';
  const PARTNER_TYPES = ['Realtor', 'Estate lawyer', 'Property manager', 'Restoration company', 'Senior living / downsizing', 'Contractor / builder', 'Storage facility', 'Other'];
  const S = { token: null, me: null, leads: [], partners: [], users: [], statuses: [], stages: [], filter: 'Open', pfilter: 'All', q: '', pq: '', loaded: 0 };
  const $app = document.getElementById('app');

  try { S.token = localStorage.getItem('gtjcrm_token'); } catch (e) {}

  // ---------- utils ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const e164 = (s) => { const d = digits(s); return d.length === 10 ? '+1' + d : ''; };
  const first = (n) => { const f = String(n || '').trim().split(/\s+/)[0]; return f && !/^\(/.test(f) ? f : 'there'; };
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const fmtDay = (d) => { if (!d) return ''; const t = today(); if (d === t) return 'Today'; if (d === addDays(t, 1)) return 'Tomorrow'; if (d === addDays(t, -1)) return 'Yesterday'; return new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); };
  const ago = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - Date.parse(iso)) / 6e4); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago'; const d = Math.round(h / 24); return d + ' d ago'; };
  const money = (v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isNaN(n) ? '' : '$' + n.toLocaleString('en-CA', { maximumFractionDigits: 0 }); };
  const isOpen = (l) => !['Done', 'Lost'].includes(l.status);
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2200); }

  async function api(action, data = {}) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) }, body: JSON.stringify({ action, ...data }) });
    const out = await res.json().catch(() => ({ error: 'Network problem' }));
    if (res.status === 401 && !['login', 'setup'].includes(action)) { logout(); throw new Error(out.error || 'Please log in'); }
    if (!res.ok) throw new Error(out.error || 'Something went wrong');
    return out;
  }
  async function load(quiet) {
    const d = await api('load');
    Object.assign(S, { me: d.me, leads: d.leads, partners: d.partners, users: d.users, statuses: d.statuses, stages: d.partnerStages, loaded: Date.now() });
    S.leads.sort((a, b) => (b.updated || b.created).localeCompare(a.updated || a.created));
    S.partners.sort((a, b) => (a.nextTouch || '9999').localeCompare(b.nextTouch || '9999'));
    if (!quiet) render(); else softRefresh();
  }
  function logout() { S.token = null; S.me = null; try { localStorage.removeItem('gtjcrm_token'); } catch (e) {} renderLogin(); }
  const lead = (id) => S.leads.find((l) => l.id === id);
  const partner = (id) => S.partners.find((p) => p.id === id);
  function upsert(list, rec) { const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.unshift(rec); }

  // ---------- message templates ----------
  const T = {
    reply: (l) => `Hi ${first(l.name)}, it's ${S.me.name} from ${BIZ}. Thanks for reaching out${l.job ? ' about ' + l.job.toLowerCase() : ''}. Could you text a few photos or a short video of everything that's going? We'll send you a fixed price before anything moves.`,
    quote: (l) => `Hi ${first(l.name)}, your price${l.job ? ' for ' + l.job.toLowerCase() : ''} is ${money(l.quote) || '$___'} all-in: labour, loading, hauling and disposal. Reply YES and we'll lock in a time that works for you.`,
    booked: (l) => `Hi ${first(l.name)}, you're booked with ${BIZ} for ${l.jobDate ? fmtDay(l.jobDate) : '___'}${l.jobTime ? ' at ' + l.jobTime : ''}. Our crew will text you when we're on the way. Thank you!`,
    followup: (l) => `Hi ${first(l.name)}, just checking in from ${BIZ}. Still need a hand${l.job ? ' with ' + l.job.toLowerCase() : ''}? Happy to answer any questions or find a time that suits you.`,
    review: (l) => `Hi ${first(l.name)}, thank you for choosing ${BIZ}! If you were happy with the job, a quick Google review helps our small local team a lot: ${REVIEW_URL}`
  };
  const smsHref = (phone, body) => `sms:${e164(phone) || ''}?&body=${encodeURIComponent(body)}`;

  // ---------- layout ----------
  function shell(title, body, opts = {}) {
    const newCount = S.leads.filter((l) => l.unread).length;
    const tab = (id, ic, label, badge) => `<button data-go="#/${id}" class="${opts.tab === id ? 'on' : ''}"><span class="ic">${ic}</span>${label}${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
    $app.innerHTML = `
      <header class="top">${opts.back ? `<button class="back" data-back>‹</button>` : ''}<h1>${esc(title)}</h1>${opts.hbtn || ''}</header>
      <main>${body}</main>
      ${opts.fab ? `<button class="fab" data-go="${opts.fab}" aria-label="Add">+</button>` : ''}
      <nav class="tabs">${tab('today', '☀️', 'Today')}${tab('leads', '📋', 'Leads', newCount)}${tab('jobs', '🚚', 'Jobs')}${tab('partners', '🤝', 'Partners')}${tab('more', '⚙️', 'More')}</nav>`;
    document.title = (newCount ? `(${newCount}) ` : '') + 'GTJ CRM';
  }
  function leadCard(l) {
    const meta = [l.job, l.town].filter(Boolean).join(' · ') || l.source || '';
    const when = l.status === 'Booked' && l.jobDate ? '🚚 ' + fmtDay(l.jobDate) + (l.jobTime ? ' ' + l.jobTime : '') : l.followUp && isOpen(l) ? (l.followUp <= today() ? '<span class="overdue">⏰ ' + fmtDay(l.followUp) + '</span>' : '⏰ ' + fmtDay(l.followUp)) : ago(l.created);
    return `<div class="card" data-go="#/lead/${l.id}"><div class="row">${l.unread ? '<span class="dot"></span>' : ''}<div class="grow"><div class="title">${esc(l.name)}</div><div class="muted small">${esc(meta)}</div></div><div style="text-align:right"><span class="pill s-${esc(l.status)}">${esc(l.status)}</span><div class="muted small" style="margin-top:4px">${when}</div></div></div></div>`;
  }
  function partnerCard(p) {
    const due = p.nextTouch && p.nextTouch <= today();
    return `<div class="card" data-go="#/partner/${p.id}"><div class="row"><div class="grow"><div class="title">${esc(p.name || p.company)}</div><div class="muted small">${esc([p.type, p.company && p.name ? p.company : '', p.area].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><span class="pill">${esc(p.stage || 'To visit')}</span><div class="muted small" style="margin-top:4px">${p.nextTouch ? (due ? '<span class="overdue">Next: ' + fmtDay(p.nextTouch) + '</span>' : 'Next: ' + fmtDay(p.nextTouch)) : p.referrals ? p.referrals + ' referrals' : ''}</div></div></div></div>`;
  }

  // ---------- views ----------
  function viewToday() {
    const t = today();
    const newL = S.leads.filter((l) => l.status === 'New');
    const due = S.leads.filter((l) => isOpen(l) && l.followUp && l.followUp <= t && l.status !== 'New');
    const jobsT = S.leads.filter((l) => l.status === 'Booked' && l.jobDate === t);
    const jobsTm = S.leads.filter((l) => l.status === 'Booked' && l.jobDate === addDays(t, 1));
    const quoted = S.leads.filter((l) => l.status === 'Quoted');
    const pDue = S.partners.filter((p) => p.nextTouch && p.nextTouch <= t);
    const doneNoReview = S.leads.filter((l) => l.status === 'Done' && !l.reviewAsked);
    const monthStart = t.slice(0, 7);
    const won = S.leads.filter((l) => l.status === 'Done' && (l.updated || '').slice(0, 7) === monthStart);
    const revenue = won.reduce((s, l) => s + (parseFloat(String(l.price || l.quote).replace(/[^0-9.]/g, '')) || 0), 0);
    const sec = (title, arr, fn) => arr.length ? `<h2>${title}</h2><div class="list">${arr.map(fn).join('')}</div>` : '';
    shell(`Hi ${S.me.name}`, `
      <div class="stats">
        <div class="stat ${newL.length ? 'hot' : ''}" data-filter="New"><b>${newL.length}</b><span>New leads</span></div>
        <div class="stat ${due.length ? 'hot' : ''}" data-filter="Follow-up"><b>${due.length}</b><span>Follow-ups due</span></div>
        <div class="stat" data-go="#/jobs"><b>${jobsT.length}</b><span>Jobs today</span></div>
        <div class="stat"><b>${money(revenue) || '$0'}</b><span>Done this month (${won.length})</span></div>
      </div>
      ${sec('New — reply fast', newL, leadCard)}
      ${sec('Jobs today', jobsT, leadCard)}
      ${sec('Jobs tomorrow', jobsTm, leadCard)}
      ${sec('Follow-ups due', due, leadCard)}
      ${sec('Quotes waiting on customer', quoted.filter((l) => !due.includes(l)), leadCard)}
      ${sec('Partners to visit or call', pDue, partnerCard)}
      ${sec('Ask for a review', doneNoReview.slice(0, 10), leadCard)}
      ${!newL.length && !due.length && !jobsT.length && !pDue.length ? '<div class="empty">All caught up. Time to drop off some cards 🤝</div>' : ''}
    `, { tab: 'today', fab: '#/lead/new' });
  }

  function viewLeads() {
    const filters = ['Open', 'New', 'Follow-up', 'Contacted', 'Quoted', 'Booked', 'Done', 'Lost', 'All'];
    const q = S.q.toLowerCase();
    let list = S.leads.filter((l) => {
      if (S.filter === 'Open' && !isOpen(l)) return false;
      if (S.filter === 'Follow-up' && !(isOpen(l) && l.followUp && l.followUp <= today())) return false;
      if (!['Open', 'All', 'Follow-up'].includes(S.filter) && l.status !== S.filter) return false;
      if (q && ![l.name, l.phone, l.town, l.job, l.address, l.email, l.source].join(' ').toLowerCase().includes(q) && !digits(l.phone).includes(q.replace(/\D/g, '') || '§')) return false;
      return true;
    });
    shell('Leads', `
      <input class="search" id="q" placeholder="Search name, phone, town, job" value="${esc(S.q)}">
      <div class="chips">${filters.map((f) => `<button class="chip ${S.filter === f ? 'on' : ''}" data-filter="${f}">${f}${f === 'New' ? ' (' + S.leads.filter((l) => l.status === 'New').length + ')' : ''}</button>`).join('')}</div>
      <div class="list">${list.map(leadCard).join('') || '<div class="empty">No leads here.</div>'}</div>
    `, { tab: 'leads', fab: '#/lead/new' });
    const qi = document.getElementById('q');
    qi.addEventListener('input', () => { S.q = qi.value; const pos = qi.selectionStart; viewLeads(); const n = document.getElementById('q'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewJobs() {
    const booked = S.leads.filter((l) => l.status === 'Booked').sort((a, b) => ((a.jobDate || '9') + (a.jobTime || '')).localeCompare((b.jobDate || '9') + (b.jobTime || '')));
    let html = ''; let last = null;
    for (const l of booked) {
      const day = l.jobDate || 'No date set';
      if (day !== last) { html += `<div class="daygrp">${l.jobDate ? (l.jobDate < today() ? '<span class="overdue">' + fmtDay(l.jobDate) + ' (mark done?)</span>' : fmtDay(l.jobDate)) : 'No date set'}</div>`; last = day; }
      html += `<div class="card" data-go="#/lead/${l.id}"><div class="row"><div class="grow"><div class="title">${esc(l.jobTime ? l.jobTime + ' · ' : '')}${esc(l.name)}</div><div class="muted small">${esc([l.job, l.address || l.town].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><b>${money(l.quote)}</b><div class="muted small">${esc(l.crew || '')}</div></div></div></div>`;
    }
    shell('Jobs', html || '<div class="empty">No booked jobs yet. Book one from a lead.</div>', { tab: 'jobs' });
  }

  function viewLead(id) {
    const isNew = id === 'new';
    const l = isNew ? { id: '', name: '', phone: '', status: 'New', notes: [], links: [], source: 'Added by ' + S.me.name } : lead(id);
    if (!l) return go('#/leads');
    if (!isNew && l.unread) { l.unread = false; api('markRead', { id: l.id }).catch(() => {}); }
    const ph = e164(l.phone);
    const addr = [l.address, l.town].filter(Boolean).join(', ');
    const partnerOpts = '<option value="">— none —</option>' + S.partners.map((p) => `<option value="${p.id}" ${l.partnerId === p.id ? 'selected' : ''}>${esc(p.name || p.company)}${p.company && p.name ? ' (' + esc(p.company) + ')' : ''}</option>`).join('');
    const crewOpts = '<option value="">—</option>' + S.users.map((u) => `<option ${l.crew === u.name ? 'selected' : ''}>${esc(u.name)}</option>`).join('') + (l.crew && !S.users.some((u) => u.name === l.crew) ? `<option selected>${esc(l.crew)}</option>` : '');
    const tpl = (key, label) => `<a class="btn ghost" href="${smsHref(l.phone, T[key](l))}" data-tpl="${key}">${label}</a>`;
    const f = (name, label, type = 'text', extra = '') => `<label class="f">${label}</label><input class="in" name="${name}" type="${type}" value="${esc(l[name] || '')}" ${extra}>`;
    shell(isNew ? 'New lead' : l.name, `
      ${isNew ? '' : `
      <div class="actions">
        <a class="act ${ph ? '' : 'dis'}" href="tel:${ph}"><span class="ic">📞</span>Call</a>
        <a class="act ${ph ? '' : 'dis'}" href="${smsHref(l.phone, '')}"><span class="ic">💬</span>Text</a>
        <a class="act ${ph ? '' : 'dis'}" href="https://wa.me/${ph.replace('+', '')}" target="_blank" rel="noopener"><span class="ic">🟢</span>WhatsApp</a>
        <a class="act ${addr ? '' : 'dis'}" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}" target="_blank" rel="noopener"><span class="ic">🧭</span>Directions</a>
      </div>
      <div class="card"><dl class="kv"><dt>Source</dt><dd>${esc(l.source)}</dd><dt>Came in</dt><dd>${new Date(l.created).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</dd>${l.email ? `<dt>Email</dt><dd><a href="mailto:${esc(l.email)}">${esc(l.email)}</a></dd>` : ''}${l.timing ? `<dt>Timing</dt><dd>${esc(l.timing)}</dd>` : ''}${(l.links || []).map((u, i) => `<dt>${i ? '' : 'Links'}</dt><dd><a href="${esc(u)}" target="_blank" rel="noopener">${esc(/elevenlabs/.test(u) ? 'Call recording & transcript' : 'Open attachment')}</a></dd>`).join('')}</dl></div>`}
      <form id="lf">
        <label class="f">Status</label>
        <div class="seg">${S.statuses.map((s) => `<button type="button" class="${l.status === s ? 'on' : ''}" data-status="${s}">${s}</button>`).join('')}</div>
        <input type="hidden" name="status" value="${esc(l.status)}">
        ${f('name', 'Name', 'text', 'required')}
        <div class="two"><div>${f('phone', 'Phone', 'tel')}</div><div>${f('email', 'Email', 'email')}</div></div>
        ${f('address', 'Address')}
        <div class="two"><div>${f('town', 'Town')}</div><div>${f('job', 'Job')}</div></div>
        <label class="f">Details</label><textarea class="in" name="details">${esc(l.details || '')}</textarea>
        <div class="two"><div>${f('quote', 'Quote ($)', 'text', 'inputmode="decimal"')}</div><div>${f('price', 'Final price ($)', 'text', 'inputmode="decimal"')}</div></div>
        <div class="two"><div>${f('jobDate', 'Job date', 'date')}</div><div>${f('jobTime', 'Job time', 'time')}</div></div>
        <div class="two"><div><label class="f">Crew lead</label><select class="in" name="crew">${crewOpts}</select></div><div>${f('followUp', 'Follow up on', 'date')}</div></div>
        <label class="f">Referred by partner</label><select class="in" name="partnerId">${partnerOpts}</select>
        ${l.status === 'Lost' ? f('lostReason', 'Why lost?') : ''}
        ${isNew ? f('source', 'Source (e.g. Phone call, Referral, Walk-up)') : ''}
        <div class="btns"><button class="btn full" type="submit">${isNew ? 'Add lead' : 'Save'}</button></div>
      </form>
      ${isNew ? '' : `
      <h2>Quick texts</h2>
      <div class="btns">${tpl('reply', 'First reply')}${tpl('quote', 'Send quote')}${tpl('booked', 'Booking confirmed')}${tpl('followup', 'Follow-up')}${tpl('review', '⭐ Ask for review')}</div>
      <div class="muted small" style="margin-top:6px">${l.reviewAsked ? 'Review asked ' + fmtDay(l.reviewAsked) + '.' : 'Ask every customer for a review after the job.'}</div>
      <h2>Notes & history</h2>
      <div class="card"><textarea class="in" id="nt" placeholder="Add a note (what they said, access, items, etc.)"></textarea><div class="btns"><button class="btn dark" id="addnote">Add note</button></div></div>
      ${(l.notes || []).map((n) => `<div class="note ${n.auto ? 'auto' : ''}"><div class="meta">${esc(n.by)} · ${new Date(n.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div><p>${esc(n.text)}</p></div>`).join('')}`}
    `, { tab: 'leads', back: true });

    const form = document.getElementById('lf');
    form.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
      form.status.value = b.dataset.status;
      form.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('on', x === b));
      if (b.dataset.status === 'Quoted' && !form.followUp.value) form.followUp.value = addDays(today(), 2);
      if (b.dataset.status === 'Contacted' && !form.followUp.value) form.followUp.value = addDays(today(), 1);
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (data.status === 'Booked' && !data.jobDate) return toast('Add the job date first');
      if (data.status === 'Done' && !data.price && data.quote) data.price = data.quote;
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { const r = await api('saveLead', { lead: { id: l.id || undefined, ...data } }); upsert(S.leads, r.lead); toast('Saved'); if (isNew) go('#/lead/' + r.lead.id, true); else viewLead(r.lead.id); }
      catch (err) { toast(err.message); btn.disabled = false; }
    });
    if (isNew) return;
    document.getElementById('addnote').addEventListener('click', async () => {
      const t = document.getElementById('nt').value.trim(); if (!t) return;
      try { const r = await api('note', { id: l.id, text: t }); upsert(S.leads, r.record); viewLead(l.id); } catch (err) { toast(err.message); }
    });
    $app.querySelectorAll('[data-tpl]').forEach((a) => a.addEventListener('click', (e) => {
      if (!ph) { e.preventDefault(); return toast('No phone number on this lead'); }
      const key = a.dataset.tpl;
      const patch = key === 'review' ? { reviewAsked: today() } : key === 'quote' && ['New', 'Contacted'].includes(l.status) ? { status: 'Quoted', followUp: addDays(today(), 2) } : key === 'reply' && l.status === 'New' ? { status: 'Contacted', followUp: addDays(today(), 1) } : null;
      if (patch) api('saveLead', { lead: { id: l.id, ...patch } }).then((r) => upsert(S.leads, r.lead)).catch(() => {});
    }));
  }

  function viewPartners() {
    const q = S.pq.toLowerCase();
    const list = S.partners.filter((p) => (S.pfilter === 'All' || p.stage === S.pfilter || p.type === S.pfilter || (S.pfilter === 'Due' && p.nextTouch && p.nextTouch <= today())) && (!q || [p.name, p.company, p.area, p.type, p.phone].join(' ').toLowerCase().includes(q)));
    const refCount = (p) => S.leads.filter((l) => l.partnerId === p.id).length;
    shell('Referral partners', `
      <input class="search" id="pq" placeholder="Search realtors, lawyers, property managers…" value="${esc(S.pq)}">
      <div class="chips">${['All', 'Due', ...S.stages, ...PARTNER_TYPES.slice(0, 3)].map((f) => `<button class="chip ${S.pfilter === f ? 'on' : ''}" data-pfilter="${f}">${f}</button>`).join('')}</div>
      <div class="muted small" style="margin:0 2px 10px">${S.partners.length} partners · ${S.partners.filter((p) => p.stage === 'Referring').length} referring · ${S.leads.filter((l) => l.partnerId).length} referred leads</div>
      <div class="list">${list.map((p) => partnerCard({ ...p, referrals: Math.max(p.referrals || 0, refCount(p)) })).join('') || '<div class="empty">No partners yet. Add the realtors, estate lawyers and property managers you visit.</div>'}</div>
    `, { tab: 'partners', fab: '#/partner/new' });
    const qi = document.getElementById('pq');
    qi.addEventListener('input', () => { S.pq = qi.value; const pos = qi.selectionStart; viewPartners(); const n = document.getElementById('pq'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function viewPartner(id) {
    const isNew = id === 'new';
    const p = isNew ? { stage: 'To visit', type: 'Realtor', notes: [] } : partner(id);
    if (!p) return go('#/partners');
    const ph = e164(p.phone);
    const refs = S.leads.filter((l) => l.partnerId === p.id);
    const f = (name, label, type = 'text') => `<label class="f">${label}</label><input class="in" name="${name}" type="${type}" value="${esc(p[name] || '')}">`;
    const thanks = `Hi ${first(p.name)}, it's ${S.me.name} from ${BIZ}. Thanks again for the referral, we really appreciate it. Anything your clients need cleared out, we're one text away.`;
    shell(isNew ? 'New partner' : (p.name || p.company), `
      ${isNew ? '' : `<div class="actions">
        <a class="act ${ph ? '' : 'dis'}" href="tel:${ph}"><span class="ic">📞</span>Call</a>
        <a class="act ${ph ? '' : 'dis'}" href="${smsHref(p.phone, '')}"><span class="ic">💬</span>Text</a>
        <a class="act ${p.email ? '' : 'dis'}" href="mailto:${esc(p.email || '')}"><span class="ic">✉️</span>Email</a>
        <a class="act ${p.address ? '' : 'dis'}" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.address || '')}" target="_blank" rel="noopener"><span class="ic">🧭</span>Directions</a>
      </div>`}
      <form id="pf">
        <label class="f">Stage</label>
        <div class="seg">${S.stages.map((s) => `<button type="button" class="${p.stage === s ? 'on' : ''}" data-stage="${s}">${s}</button>`).join('')}</div>
        <input type="hidden" name="stage" value="${esc(p.stage)}">
        <label class="f">Type</label><select class="in" name="type">${PARTNER_TYPES.map((t) => `<option ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <div class="two"><div>${f('name', 'Contact name')}</div><div>${f('company', 'Company / office')}</div></div>
        <div class="two"><div>${f('phone', 'Phone', 'tel')}</div><div>${f('email', 'Email', 'email')}</div></div>
        ${f('address', 'Office address')}
        <div class="two"><div>${f('area', 'Area')}</div><div>${f('nextTouch', 'Next visit / call', 'date')}</div></div>
        <div class="btns"><button class="btn full" type="submit">${isNew ? 'Add partner' : 'Save'}</button></div>
      </form>
      ${isNew ? '' : `
      <h2>Log a visit or call</h2>
      <div class="card"><textarea class="in" id="pn" placeholder="e.g. Dropped 10 cards + Rocky flyer, met Sarah at front desk. Has 2 estates listing in spring."></textarea>
        <label class="f">Next touch</label><div class="seg">${[['+7 days', 7], ['+14 days', 14], ['+30 days', 30]].map(([t, n]) => `<button type="button" data-next="${n}">${t}</button>`).join('')}</div>
        <div class="btns"><button class="btn dark" id="logtouch">Save visit/call</button><a class="btn ghost" href="${smsHref(p.phone, thanks)}">Send thank-you text</a></div></div>
      ${refs.length ? `<h2>Referred leads (${refs.length})</h2><div class="list">${refs.map(leadCard).join('')}</div>` : ''}
      <h2>History</h2>
      ${(p.notes || []).map((n) => `<div class="note ${n.auto ? 'auto' : ''}"><div class="meta">${esc(n.by)} · ${new Date(n.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div><p>${esc(n.text)}</p></div>`).join('')}`}
    `, { tab: 'partners', back: true });
    const form = document.getElementById('pf');
    form.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', () => { form.stage.value = b.dataset.stage; form.querySelectorAll('[data-stage]').forEach((x) => x.classList.toggle('on', x === b)); }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (!data.name && !data.company) return toast('Add a name or company');
      try { const r = await api('savePartner', { partner: { id: p.id || undefined, ...data } }); upsert(S.partners, r.partner); toast('Saved'); if (isNew) go('#/partner/' + r.partner.id, true); else viewPartner(p.id); }
      catch (err) { toast(err.message); }
    });
    if (isNew) return;
    let nextDays = 14;
    $app.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => { nextDays = +b.dataset.next; $app.querySelectorAll('[data-next]').forEach((x) => x.classList.toggle('on', x === b)); }));
    document.getElementById('logtouch').addEventListener('click', async () => {
      const t = document.getElementById('pn').value.trim() || 'Visit/call logged.';
      try {
        await api('note', { kind: 'partner', id: p.id, text: t, touch: true });
        const stage = p.stage === 'To visit' ? 'Card dropped' : p.stage;
        const r = await api('savePartner', { partner: { id: p.id, nextTouch: addDays(today(), nextDays), stage } });
        upsert(S.partners, r.partner); toast('Logged'); viewPartner(p.id);
      } catch (err) { toast(err.message); }
    });
  }

  function viewMore() {
    const owner = S.me.role === 'owner';
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    shell('More', `
      <div class="card"><div class="title">${esc(S.me.name)}</div><div class="muted">${owner ? 'Owner' : 'Crew'} · ${S.leads.length} leads · ${S.partners.length} partners</div>
        <div class="btns"><button class="btn ghost" id="refresh">↻ Refresh</button><button class="btn ghost" id="logout">Log out</button></div></div>
      ${standalone ? '' : `<div class="card"><div class="title">📲 Install on your phone</div><p class="muted">iPhone: tap Share → <b>Add to Home Screen</b>. Android: tap ⋮ → <b>Install app</b> (or Add to Home screen). It then opens like a normal app.</p>${S.installEvt ? '<button class="btn" id="install">Install now</button>' : ''}</div>`}
      <h2>Export</h2>
      <div class="btns"><button class="btn ghost" data-csv="leads">Leads (CSV)</button><button class="btn ghost" data-csv="partners">Partners (CSV)</button></div>
      ${owner ? `<h2>Team</h2>
      <div class="card">${S.users.map((u) => `<div class="row" style="padding:6px 0"><div class="grow">${esc(u.name)} <span class="muted small">${u.role}</span></div>${u.name !== S.me.name ? `<button class="btn ghost" data-rm="${esc(u.name)}">Remove</button>` : ''}</div>`).join('')}
        <form id="uf"><div class="two"><div><label class="f">Name</label><input class="in" name="name" required></div><div><label class="f">PIN (4–8 digits)</label><input class="in" name="pin" inputmode="numeric" pattern="\\d{4,8}" required></div></div>
        <label class="f">Role</label><select class="in" name="role"><option value="crew">Crew</option><option value="owner">Owner (can manage team)</option></select>
        <div class="btns"><button class="btn dark" type="submit">Add / reset team member</button></div></form></div>` : ''}
      <h2>Change my PIN</h2>
      <form id="cp" class="card"><div class="two"><div><label class="f">Current PIN</label><input class="in" name="oldPin" type="password" inputmode="numeric" required></div><div><label class="f">New PIN</label><input class="in" name="newPin" type="password" inputmode="numeric" pattern="\\d{4,8}" required></div></div><div class="btns"><button class="btn dark" type="submit">Change PIN</button></div></form>
      <p class="muted small">Leads arrive automatically from the website forms, Rocky, and the AI phone line. Last sync ${ago(new Date(S.loaded).toISOString())}.</p>
    `, { tab: 'more' });
    document.getElementById('refresh').onclick = () => load().then(() => toast('Updated'));
    document.getElementById('logout').onclick = logout;
    const ib = document.getElementById('install'); if (ib) ib.onclick = () => { S.installEvt.prompt(); S.installEvt = null; };
    $app.querySelectorAll('[data-csv]').forEach((b) => b.onclick = () => csv(b.dataset.csv));
    $app.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => { if (!confirm('Remove ' + b.dataset.rm + ' from the CRM?')) return; try { await api('removeUser', { name: b.dataset.rm }); await load(); } catch (e) { toast(e.message); } });
    const uf = document.getElementById('uf');
    if (uf) uf.onsubmit = async (e) => { e.preventDefault(); try { await api('addUser', Object.fromEntries(new FormData(uf))); toast('Team member saved'); await load(true); viewMore(); } catch (err) { toast(err.message); } };
    const cp = document.getElementById('cp');
    cp.onsubmit = async (e) => { e.preventDefault(); try { const r = await api('changePin', Object.fromEntries(new FormData(cp))); S.token = r.token; try { localStorage.setItem('gtjcrm_token', r.token); } catch (x) {} toast('PIN changed'); cp.reset(); } catch (err) { toast(err.message); } };
  }

  function csv(kind) {
    const rows = kind === 'leads' ? S.leads : S.partners;
    const cols = kind === 'leads' ? ['created', 'status', 'name', 'phone', 'email', 'address', 'town', 'job', 'source', 'quote', 'price', 'jobDate', 'jobTime', 'crew', 'followUp', 'reviewAsked', 'details'] : ['created', 'stage', 'type', 'name', 'company', 'phone', 'email', 'address', 'area', 'lastTouch', 'nextTouch', 'referrals'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const text = [cols.join(','), ...rows.map((r) => cols.map((c) => q(r[c])).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = `gtj-${kind}-${today()}.csv`; a.click();
  }

  // ---------- login ----------
  async function renderLogin() {
    let setup = false;
    try { setup = (await api('status')).setupNeeded; } catch (e) {}
    $app.innerHTML = `<div class="login"><img class="logo" src="/crm/icon-192.png" alt=""><h1>GTA Junk CRM</h1><p>${setup ? 'First-time setup' : 'Log in with your name and PIN'}</p>
      <form id="lg">${setup ? '<label class="f">Setup code</label><input class="in" name="code" autocomplete="off" required>' : ''}
      <label class="f">Your name</label><input class="in" name="name" autocomplete="username" required value="${esc((() => { try { return localStorage.getItem('gtjcrm_name') || ''; } catch (e) { return ''; } })())}">
      <label class="f">${setup ? 'Choose a PIN (4–8 digits)' : 'PIN'}</label><input class="in" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required>
      <div class="err" id="err"></div><button class="btn full" type="submit">${setup ? 'Set up' : 'Log in'}</button></form></div>`;
    const f = document.getElementById('lg');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f));
      try {
        const r = await api(setup ? 'setup' : 'login', data);
        S.token = r.token; try { localStorage.setItem('gtjcrm_token', r.token); localStorage.setItem('gtjcrm_name', data.name); } catch (x) {}
        await load(true); go('#/today', true);
      } catch (err) { document.getElementById('err').textContent = err.message; }
    };
  }

  // ---------- router ----------
  function go(hash, replace) { if (replace) history.replaceState(null, '', hash); else location.hash = hash; render(); }
  function render() {
    if (!S.token) return renderLogin();
    if (!S.me) return load();
    const [, view, id] = (location.hash || '#/today').split('/');
    window.scrollTo(0, 0);
    if (view === 'leads') return viewLeads();
    if (view === 'lead') return viewLead(id);
    if (view === 'jobs') return viewJobs();
    if (view === 'partners') return viewPartners();
    if (view === 'partner') return viewPartner(id);
    if (view === 'more') return viewMore();
    return viewToday();
  }
  function softRefresh() {
    // Re-render list views after a background sync; leave forms alone so typing isn't lost.
    const v = (location.hash || '#/today').split('/')[1] || 'today';
    if (['today', 'leads', 'jobs', 'partners'].includes(v) && !document.activeElement.matches('input,textarea,select')) render();
  }
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); return go(g.dataset.go); }
    if (e.target.closest('[data-back]')) return history.length > 1 ? history.back() : go('#/today');
    const fl = e.target.closest('[data-filter]'); if (fl) { S.filter = fl.dataset.filter; return location.hash === '#/leads' ? viewLeads() : go('#/leads'); }
    const pf = e.target.closest('[data-pfilter]'); if (pf) { S.pfilter = pf.dataset.pfilter; return viewPartners(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  setInterval(() => { if (S.me && document.visibilityState === 'visible') load(true).catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => { if (S.me && document.visibilityState === 'visible' && Date.now() - S.loaded > 15000) load(true).catch(() => {}); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/crm/sw.js', { scope: '/crm/' }).catch(() => {});
  render();
})();
