/* GTA Junk CRM — single-page phone app. Data: POST /api/crm (see netlify/functions/crm.js). */
(function () {
  'use strict';
  const API = '/api/crm';
  const REVIEW_URL = 'https://g.page/r/CWUHyrYovKM_EAI/review';
  const BIZ = 'GTA Junk and Property Cleanout';
  const PARTNER_TYPES = ['Realtor', 'Estate lawyer', 'Property manager', 'Restoration company', 'Senior living / downsizing', 'Contractor / builder', 'Storage facility', 'Other'];
  const S = { token: null, me: null, leads: [], partners: [], users: [], docs: [], settings: {}, statuses: [], stages: [], filter: 'Open', pfilter: 'All', q: '', pq: '', loaded: 0, chat: [], speak: true, busy: false };
  try { S.chat = JSON.parse(sessionStorage.getItem('gtjcrm_chat') || '[]'); } catch (e) {}
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
    Object.assign(S, { me: d.me, leads: d.leads, partners: d.partners, users: d.users, docs: (d.docs || []).sort((a, b) => b.created.localeCompare(a.created)), settings: d.settings || {}, statuses: d.statuses, stages: d.partnerStages, loaded: Date.now() });
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
      <header class="top">${opts.back ? `<button class="back" data-back>‹</button>` : ''}<h1>${esc(title)}</h1>${opts.hbtn || ''}${opts.tab !== 'more' ? '<button class="gear" data-go="#/more" aria-label="Settings">⚙️</button>' : ''}</header>
      <main>${body}</main>
      ${opts.fab ? `<button class="fab" data-go="${opts.fab}" aria-label="Add">+</button>` : ''}
      <nav class="tabs">${tab('today', '☀️', 'Today')}${tab('leads', '📋', 'Leads', newCount)}<button data-go="#/ask" class="mic-tab ${opts.tab === 'ask' ? 'on' : ''}"><span class="mic-ic">🎙️</span>Assistant</button>${tab('calendar', '📅', 'Calendar')}${tab('partners', '🤝', 'Partners')}</nav>`;
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
  // ---------- playbook (crm/playbook.js) ----------
  const PB = window.GTJPlaybook;
  const docsWithUrl = () => S.docs;
  const pbCtx = () => ({ today: today(), settings: S.settings, me: S.me.name, nowMs: Date.now() });
  const allTasks = () => PB.tasks(S.leads, docsWithUrl(), S.partners, pbCtx());
  function pbText(purpose, l) { return PB.message(purpose, l, PB.stateOf(l, docsWithUrl()), pbCtx()); }
  async function setCheck(l, key, value, extra) {
    const r = await api('saveLead', { lead: { id: l.id, checks: { [key]: value === undefined ? today() : value }, ...(extra || {}) } });
    upsert(S.leads, r.lead); return r.lead;
  }
  async function doTask(t) {
    const l = lead(t.leadId); const a = t.action;
    if (a.kind === 'go') return go(a.href);
    if (a.kind === 'sms') { if (!l.phone) { toast('Add a phone number first'); return go('#/lead/' + l.id); } return confirmSend({ to: l.phone, who: l.name, leadId: l.id, purpose: a.purpose, body: pbText(a.purpose, l) }, () => render()); }
    if (a.kind === 'check') {
      if (a.key === 'deposit') return depositPrompt(l);
      if (a.key === 'paid') { const inv = PB.stateOf(l, S.docs).invoice; if (inv) return go('#/doc/' + inv.id); }
      await setCheck(l, a.key); toast('Done ✓'); render();
    }
  }
  async function depositPrompt(l) {
    const q = PB.stateOf(l, S.docs).quote;
    const v = prompt(`Deposit received from ${l.name}? Amount ($):`, q ? q.deposit.toFixed(2) : '');
    if (v === null) return;
    await setCheck(l, 'deposit', today(), { depositPaid: v });
    toast('Deposit recorded ✓'); render();
  }
  const taskCard = (t) => `<div class="card task ${t.pri === 0 || t.overdue ? 'urgent' : ''}"><div class="row"><div class="grow"><div class="title" style="white-space:normal">${esc(t.title)}</div><div class="muted small">${t.overdue ? '<span class="overdue">Overdue · </span>' : ''}${esc(t.why || (t.due ? fmtDay(t.due) : ''))}</div></div>
    <button class="btn small-btn" data-task="${esc(t.id)}">${t.action.kind === 'sms' ? '💬 Text' : t.action.kind === 'check' ? '✓ ' + esc(t.action.label) : esc(t.action.label || 'Open')}</button></div></div>`;

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
        <div class="stat" data-go="#/calendar"><b>${jobsT.length}</b><span>Jobs today</span></div>
        <div class="stat"><b>${money(revenue) || '$0'}</b><span>Done this month (${won.length})</span></div>
      </div>
      <button class="btn full" data-go="#/walk" data-newwalk style="margin-bottom:6px">🎥 New video estimate</button>
      ${(() => { const ts = allTasks(); S.tasks = ts; return ts.length ? `<h2>To do now (${ts.length})</h2><div class="list">${ts.slice(0, 25).map(taskCard).join('')}</div>` : '<div class="empty">Nothing waiting. Every customer is up to date ✓</div>'; })()}
      ${sec('Jobs today', jobsT, leadCard)}
      ${sec('Jobs tomorrow', jobsTm, leadCard)}
      ${sec('Quotes waiting on customer', quoted, leadCard)}
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

  // ---------- calendar ----------
  const gcalLink = (l) => {
    const d = (l.jobDate || '').replace(/-/g, ''); const t = (l.jobTime || '09:00').replace(':', '') + '00';
    const [h, m] = (l.jobTime || '09:00').split(':').map(Number); const end = String((h + 3) % 24).padStart(2, '0') + String(m).padStart(2, '0') + '00';
    const p = new URLSearchParams({ action: 'TEMPLATE', text: `GTJ: ${l.name}${l.job ? ' – ' + l.job : ''}`, dates: `${d}T${t}/${d}T${end}`, ctz: 'America/Toronto', location: [l.address, l.town].filter(Boolean).join(', '), details: `${l.phone || ''}\n${l.details || ''}\nQuote: ${money(l.quote)}` });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  };
  const reminderText = (l) => `Hi ${first(l.name)}, a reminder from ${BIZ}: we're booked for ${fmtDay(l.jobDate).replace('Tomorrow', 'tomorrow').replace('Today', 'today')}${l.jobTime ? ' at ' + l.jobTime : ''}${l.address ? ' at ' + l.address : ''}. Reply here if anything has changed. See you then!`;
  function viewCalendar() {
    const start = S.calStart || today();
    const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
    const overdue = S.leads.filter((l) => l.status === 'Booked' && l.jobDate && l.jobDate < today());
    const undated = S.leads.filter((l) => l.status === 'Booked' && !l.jobDate);
    let html = `<div class="row" style="margin-bottom:10px"><button class="btn ghost" data-cal="-7">‹ Week</button><input class="in grow" type="date" id="calStart" value="${start}"><button class="btn ghost" data-cal="7">Week ›</button></div>`;
    if (overdue.length) html += `<div class="daygrp overdue">Past jobs not marked Done</div><div class="list">${overdue.map(leadCard).join('')}</div>`;
    for (const d of days) {
      const jobs = S.leads.filter((l) => l.status === 'Booked' && l.jobDate === d).sort((a, b) => (a.jobTime || '').localeCompare(b.jobTime || ''));
      const fus = S.leads.filter((l) => isOpen(l) && l.status !== 'Booked' && l.followUp === d);
      const pv = S.partners.filter((p) => p.nextTouch === d);
      if (!jobs.length && !fus.length && !pv.length && d !== today()) continue;
      html += `<div class="daygrp">${fmtDay(d)} <span class="muted small">${d}</span></div>`;
      if (!jobs.length && !fus.length && !pv.length) html += '<div class="muted small" style="margin:0 2px 8px">Nothing booked — free day.</div>';
      for (const l of jobs) html += `<div class="card"><div class="row" data-go="#/lead/${l.id}" style="cursor:pointer"><div class="grow"><div class="title">🚚 ${esc(l.jobTime || 'Any time')} · ${esc(l.name)}</div><div class="muted small">${esc([l.job, l.address || l.town].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><b>${money(l.quote)}</b><div class="muted small">${esc(l.crew || '')}</div></div></div>
        <div class="btns" style="margin-top:8px"><button class="btn ghost small-btn" data-remind="${l.id}">💬 Text reminder</button><a class="btn ghost small-btn" href="${gcalLink(l)}" target="_blank" rel="noopener">📅 Google Calendar</a></div></div>`;
      html += fus.map((l) => `<div class="card" data-go="#/lead/${l.id}" style="cursor:pointer"><div class="title">⏰ Follow up: ${esc(l.name)}</div><div class="muted small">${esc(l.status)} · ${esc(l.job || '')}</div></div>`).join('');
      html += pv.map((p) => `<div class="card" data-go="#/partner/${p.id}" style="cursor:pointer"><div class="title">🤝 Visit: ${esc(p.name || p.company)}</div><div class="muted small">${esc([p.type, p.area].filter(Boolean).join(' · '))}</div></div>`).join('');
    }
    if (undated.length) html += `<div class="daygrp">Booked, no date yet</div><div class="list">${undated.map(leadCard).join('')}</div>`;
    shell('Calendar', html, { tab: 'calendar' });
    $app.querySelectorAll('[data-cal]').forEach((b) => b.onclick = () => { S.calStart = addDays(start, +b.dataset.cal); viewCalendar(); });
    document.getElementById('calStart').onchange = (e) => { S.calStart = e.target.value || today(); viewCalendar(); };
    $app.querySelectorAll('[data-remind]').forEach((b) => b.onclick = () => { const l = lead(b.dataset.remind); confirmSend({ to: l.phone, who: l.name, leadId: l.id, purpose: 'reminder', body: reminderText(l) }); });
  }

  // ---------- send a text from the business number (always confirmed) ----------
  function confirmSend(msg, onSent) {
    const wrap = document.createElement('div'); wrap.className = 'sheet-bg';
    wrap.innerHTML = `<div class="sheet"><div class="title">Text ${esc(msg.who || msg.to)}</div><div class="muted small">From the GTA Junk number to ${esc(msg.to)}</div>
      <textarea class="in" rows="6" id="smsBody">${esc(msg.body)}</textarea><div class="btns"><button class="btn" id="smsSend">Send text</button><button class="btn ghost" id="smsCancel">Cancel</button></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#smsCancel').onclick = () => wrap.remove();
    wrap.querySelector('#smsSend').onclick = async (e) => {
      e.target.disabled = true;
      try { await api('sendSms', { ...msg, body: wrap.querySelector('#smsBody').value }); wrap.remove(); toast('Text sent ✓'); load(true).catch(() => {}); if (onSent) onSent(); }
      catch (err) { toast(err.message); e.target.disabled = false; }
    };
  }

  // ---------- assistant ----------
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  function saveChat() { try { sessionStorage.setItem('gtjcrm_chat', JSON.stringify(S.chat.slice(-30))); } catch (e) {} }
  function say(text) {
    if (!S.speak || !window.speechSynthesis) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/https?:\/\/\S+/g, 'the link')); u.lang = 'en-CA'; u.rate = 1.05; speechSynthesis.speak(u); } catch (e) {}
  }
  function bubble(m, i) {
    if (m.role === 'user') return `<div class="bub me">${esc(m.text)}</div>`;
    const cards = (m.pending || []).map((p, j) => p.done ? `<div class="pcard done">✓ ${p.done === 'sent' ? 'Sent to' : 'Cancelled:'} ${esc(p.who || p.to)}</div>` :
      `<div class="pcard"><div class="small muted">Text to <b>${esc(p.who || p.to)}</b> · ${esc(p.to)}</div><textarea class="in" rows="4" data-pb="${i}-${j}">${esc(p.body)}</textarea>
       <div class="btns"><button class="btn" data-psend="${i}-${j}">Send</button><button class="btn ghost" data-pcancel="${i}-${j}">Cancel</button></div></div>`).join('');
    const docs = (m.docs || []).map((d) => `<a class="btn ghost small-btn" href="${esc(d.link)}" target="_blank" rel="noopener">📄 Open ${d.type} ${esc(d.id)} (${money(d.total)})</a>`).join(' ');
    return `<div class="bub bot">${esc(m.text)}${docs ? '<div class="btns">' + docs + '</div>' : ''}</div>${cards}`;
  }
  function viewAssistant() {
    const tips = ["What's on tomorrow?", 'Book Sarah for Tuesday at 9', 'Quote Sarah $2,400 for the basement and garage', 'Job done for Sarah, send the invoice', 'Text Tom we are 20 minutes away', 'Who do I need to follow up with?'];
    shell('Assistant', `
      <div id="chat" class="chat">${S.chat.length ? S.chat.map(bubble).join('') : `<div class="empty">Tap the mic and talk, like:<br><br>${tips.map((t) => `<button class="chip" data-tip="${esc(t)}">${esc(t)}</button>`).join(' ')}</div>`}
      ${S.busy ? '<div class="bub bot typing">Working on it…</div>' : ''}</div>
      <div class="composer"><button class="btn ghost" data-go="#/walk" data-newwalk title="Video estimate" style="padding:12px">🎥</button><button class="micbtn ${S.listening ? 'on' : ''}" id="mic" aria-label="Talk">${S.listening ? '■' : '🎙️'}</button>
        <textarea class="in grow" id="say" rows="1" placeholder="${Rec ? 'Tap the mic or type…' : 'Type, or use your keyboard mic…'}"></textarea><button class="btn" id="go">➤</button></div>
      <div class="row small muted" style="justify-content:space-between;margin-top:6px"><label><input type="checkbox" id="spk" ${S.speak ? 'checked' : ''}> Read replies out loud</label>${S.chat.length ? '<button class="linkbtn" id="clr">New conversation</button>' : ''}</div>
    `, { tab: 'ask' });
    const box = document.getElementById('say'), chat = document.getElementById('chat');
    chat.scrollTop = chat.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
    document.getElementById('go').onclick = () => ask(box.value);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(box.value); } });
    document.getElementById('spk').onchange = (e) => { S.speak = e.target.checked; if (!S.speak && window.speechSynthesis) speechSynthesis.cancel(); };
    const clr = document.getElementById('clr'); if (clr) clr.onclick = () => { S.chat = []; saveChat(); viewAssistant(); };
    $app.querySelectorAll('[data-tip]').forEach((b) => b.onclick = () => { box.value = b.dataset.tip; box.focus(); });
    document.getElementById('mic').onclick = () => listen(box);
    $app.querySelectorAll('[data-psend]').forEach((b) => b.onclick = async () => {
      const [i, j] = b.dataset.psend.split('-').map(Number); const p = S.chat[i].pending[j];
      b.disabled = true;
      try { await api('sendSms', { ...p, body: $app.querySelector(`[data-pb="${i}-${j}"]`).value }); p.done = 'sent'; saveChat(); toast('Text sent ✓'); load(true).catch(() => {}); viewAssistant(); }
      catch (err) { toast(err.message); b.disabled = false; }
    });
    $app.querySelectorAll('[data-pcancel]').forEach((b) => b.onclick = () => { const [i, j] = b.dataset.pcancel.split('-').map(Number); S.chat[i].pending[j].done = 'cancelled'; saveChat(); viewAssistant(); });
  }
  function listen(box, onDone) {
    if (!Rec) return toast('Use the mic on your keyboard to talk');
    if (S.rec) { S.rec.stop(); return; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    const r = new Rec(); S.rec = r; r.lang = 'en-CA'; r.interimResults = true; r.continuous = false;
    let finalText = '';
    r.onerror = (e) => { if (e.error === 'not-allowed') toast('Allow the microphone for this app'); };
    const base = onDone ? box.value.trim() : '';
    r.onresult = (e) => { let t = ''; for (const res of e.results) { t += res[0].transcript; if (res.isFinal) finalText = t; } box.value = (base ? base + ' ' : '') + t; };
    r.onend = () => { S.rec = null; S.listening = false; const t = (onDone ? box.value : (finalText || box.value)).trim(); if (onDone) { onDone(t); const m = document.getElementById('wmic'); if (m) { m.classList.remove('on'); m.textContent = '🎙️'; } return; } if (t) ask(t, true); else viewAssistant(); };
    S.listening = true; r.start();
    const mic = document.getElementById(onDone ? 'wmic' : 'mic'); if (mic) { mic.classList.add('on'); mic.textContent = '■'; }
  }
  async function ask(text, spoken) {
    text = String(text || '').trim(); if (!text || S.busy) return;
    S.chat.push({ role: 'user', text }); S.busy = true; saveChat(); viewAssistant();
    try {
      const r = await api('assistant', { history: S.chat.map((m) => ({ role: m.role, text: m.text })) });
      S.chat.push({ role: 'assistant', text: r.reply, pending: r.pending || [], docs: r.docs || [] });
      if (spoken || S.speak) say(r.reply);
      if (r.changed && (r.changed.leads || r.changed.partners) || (r.docs || []).length) load(true).catch(() => {});
    } catch (err) { S.chat.push({ role: 'assistant', text: 'Sorry: ' + err.message }); }
    S.busy = false; saveChat(); if ((location.hash || '').startsWith('#/ask')) viewAssistant();
  }

  // ---------- video walkthrough estimate ----------
  const once = (el, ev) => new Promise((res, rej) => { const ok = () => { cleanup(); res(); }; const bad = () => { cleanup(); rej(new Error('This video format could not be read on this phone.')); }; const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); }; el.addEventListener(ev, ok); el.addEventListener('error', bad); });
  function toJpeg(src, w, h) { const max = 1024, k = Math.min(1, max / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.66); }
  async function framesFromVideo(file, n, onStep) {
    const url = URL.createObjectURL(file); const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = url;
    await once(v, 'loadedmetadata');
    try { await v.play(); v.pause(); } catch (e) {}
    const dur = v.duration && isFinite(v.duration) ? v.duration : 30; const out = [];
    for (let i = 0; i < n; i++) {
      v.currentTime = Math.min(dur - 0.1, dur * (i + 0.5) / n);
      await once(v, 'seeked'); await new Promise((r) => setTimeout(r, 60));
      if (v.videoWidth) out.push(toJpeg(v, v.videoWidth, v.videoHeight));
      if (onStep) onStep(i + 1, n);
    }
    URL.revokeObjectURL(url); return { frames: out, seconds: Math.round(dur) };
  }
  async function frameFromPhoto(file) { const img = new Image(); img.src = URL.createObjectURL(file); await once(img, 'load'); const d = toJpeg(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(img.src); return d; }
  const WALK_CHECKS = ['Filmed every room/area, inside closets and corners', 'Customer showed what STAYS (marked or set aside)', 'Stairs, elevator, door widths, carry distance to the truck', 'Where the truck and trailer can park', 'Heavy items: concrete, soil, appliances, pianos, hot tub', 'Asked about paint, chemicals, propane, anything hazardous', 'Timing: when they need it done, deadlines (closing, move-out)', 'Who decides and who will be home on the day'];
  function viewWalk() {
    const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
    const W = S.walk || (S.walk = { leadId: qs.get('lead') || '', frames: [], notes: '', result: null, busy: '' });
    if (qs.get('lead') && W.leadId !== qs.get('lead') && !W.frames.length) W.leadId = qs.get('lead');
    const l = lead(W.leadId);
    const opts = '<option value="">— choose customer —</option><option value="__new">+ New customer</option>' + S.leads.filter((x) => isOpen(x) || x.id === W.leadId).map((x) => `<option value="${x.id}" ${x.id === W.leadId ? 'selected' : ''}>${esc(x.name)}${x.town ? ' · ' + esc(x.town) : ''}</option>`).join('');
    const r = W.result;
    shell('Video estimate', `
      <label class="f">Customer</label><select class="in" id="wlead">${opts}</select>
      <div id="newc" style="display:${W.leadId === '__new' ? 'block' : 'none'}"><div class="two"><div><label class="f">Name</label><input class="in" id="nc_name" data-nc="name" value="${esc((W.nc || {}).name)}"></div><div><label class="f">Phone</label><input class="in" id="nc_phone" data-nc="phone" type="tel" value="${esc((W.nc || {}).phone)}"></div></div><label class="f">Address</label><input class="in" id="nc_addr" data-nc="addr" value="${esc((W.nc || {}).addr)}"></div>
      <h2>1 · Walkthrough</h2>
      <div class="muted small">Meta glasses: open the Meta AI app → import the video to your phone's gallery, then pick it here. Phone videos and photos work too. The video stays on your phone; only still frames are sent.</div>
      <div class="btns"><label class="btn dark">🎥 Choose video<input type="file" accept="video/*" id="wvid" hidden></label><label class="btn ghost">📷 Add photos<input type="file" accept="image/*" multiple id="wpic" hidden></label>${W.frames.length ? '<button class="btn ghost" id="wclear">Clear</button>' : ''}</div>
      ${W.busy ? `<div class="card muted">${esc(W.busy)}</div>` : ''}
      ${W.frames.length ? `<div class="thumbs">${W.frames.map((f) => `<img src="${f}" alt="">`).join('')}</div><div class="muted small">${W.frames.length} frames ready</div>` : ''}
      <h2>2 · Make sure you covered</h2>
      <div class="card checklist">${WALK_CHECKS.map((c, i) => `<label class="ck ${(W.checks || {})[i] ? 'done' : ''}"><input type="checkbox" data-wc="${i}" ${(W.checks || {})[i] ? 'checked' : ''} hidden><span class="box">${(W.checks || {})[i] ? '✓' : ''}</span><span class="grow">${c}</span></label>`).join('')}</div>
      <h2>3 · Notes</h2>
      <div class="composer" style="position:static;padding:0"><button class="micbtn" id="wmic" aria-label="Talk">🎙️</button><textarea class="in grow" id="wnotes" rows="3" placeholder="What the customer said: what goes, what stays, stairs, parking, timing, anything the camera missed">${esc(W.notes)}</textarea></div>
      <div class="btns"><button class="btn full" id="wgo" ${W.frames.length < 2 || W.busy ? 'disabled' : ''}>⚡ Get estimate</button></div>
      ${r ? walkResult(r, l) : ''}
    `, { tab: 'leads', back: true });
    const sel = document.getElementById('wlead');
    sel.onchange = () => { W.leadId = sel.value; W.result = null; viewWalk(); };
    const notes = document.getElementById('wnotes'); notes.oninput = () => { W.notes = notes.value; };
    $app.querySelectorAll('[data-wc]').forEach((cb) => cb.onchange = () => { W.checks = W.checks || {}; W.checks[cb.dataset.wc] = cb.checked; const row = cb.closest('.ck'); row.classList.toggle('done', cb.checked); row.querySelector('.box').textContent = cb.checked ? '✓' : ''; });
    $app.querySelectorAll('[data-nc]').forEach((i) => i.oninput = () => { W.nc = W.nc || {}; W.nc[i.dataset.nc] = i.value; });
    document.getElementById('wmic').onclick = () => listen(notes, (t) => { W.notes = t; });
    const clr = document.getElementById('wclear'); if (clr) clr.onclick = () => { W.frames = []; W.result = null; viewWalk(); };
    document.getElementById('wvid').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      W.busy = 'Reading video… 0%'; viewWalk();
      try { const out = await framesFromVideo(f, 16, (i, n) => { W.busy = `Reading video… ${Math.round(i / n * 100)}%`; const c = $app.querySelector('.card.muted'); if (c) c.textContent = W.busy; }); W.frames = W.frames.concat(out.frames).slice(-16); W.notes = W.notes || ''; }
      catch (err) { toast(err.message); }
      W.busy = ''; W.result = null; viewWalk();
    };
    document.getElementById('wpic').onchange = async (e) => {
      W.busy = 'Adding photos…'; viewWalk();
      for (const f of [...e.target.files].slice(0, 10)) { try { W.frames.push(await frameFromPhoto(f)); } catch (err) {} }
      W.frames = W.frames.slice(-16); W.busy = ''; W.result = null; viewWalk();
    };
    document.getElementById('wgo').onclick = async () => {
      W.notes = notes.value;
      try {
        if (W.leadId === '__new') {
          const name = document.getElementById('nc_name').value.trim(); if (!name) return toast('Add the customer name');
          const x = await api('saveLead', { lead: { name, phone: document.getElementById('nc_phone').value, address: document.getElementById('nc_addr').value, source: 'Site visit / walkthrough', status: 'Contacted' } });
          upsert(S.leads, x.lead); W.leadId = x.lead.id;
        }
        const missed = WALK_CHECKS.filter((c, i) => !(W.checks || {})[i]);
        if (missed.length && !confirm(`Not covered yet:\n• ${missed.join('\n• ')}\n\nGet the estimate anyway?`)) return;
        W.busy = 'Looking at the job… (about 20 seconds)'; viewWalk();
        const out = await api('walkthrough', { leadId: W.leadId, frames: W.frames, notes: W.notes, checklist: WALK_CHECKS.map((c, i) => ((W.checks || {})[i] ? '✓ ' : '✗ ') + c).join('; ') });
        W.result = out.walk; W.busy = ''; load(true).catch(() => {}); viewWalk();
        say(`About ${Math.round(out.walk.read.cubic_yards)} cubic yards. Suggested price ${out.walk.price.subtotal} dollars before HST.`);
      } catch (err) { W.busy = ''; toast(err.message); viewWalk(); }
    };
    if (r) bindWalkResult(r, l);
  }
  function walkResult(w, l) {
    const rd = w.read, p = w.price;
    const list = (arr) => (arr || []).map((x) => `<li>${esc(typeof x === 'string' ? x : `${x.quantity > 1 ? x.quantity + ' × ' : ''}${x.label}`)}</li>`).join('');
    return `<h2>4 · Estimate</h2>
      <div class="card"><div class="title">$${p.subtotal.toLocaleString('en-CA')} <span class="muted small">before HST · ${esc(p.confidence)} confidence</span></div>
        <p class="small" style="margin:6px 0">${esc(rd.summary_for_owner || '')}</p>
        <dl class="kv"><dt>Job</dt><dd>${esc(rd.job_type || '')}</dd><dt>Volume</dt><dd>~${Math.round(rd.cubic_yards)} cu yd${rd.heavy_tonnes ? ' + ' + rd.heavy_tonnes + ' t heavy' : ''}</dd><dt>Crew</dt><dd>${esc(rd.crew_size)} people · ~${esc(rd.onsite_hours)} h on site</dd><dt>Access</dt><dd>${rd.stairs_flights ? rd.stairs_flights + ' flight(s) of stairs' : 'No stairs'}${rd.long_carry ? ', long carry' : ''}</dd></dl>
        ${(rd.hazards || []).length ? `<div class="overdue small" style="margin-top:8px">⚠️ ${esc(rd.hazards.join(', '))}</div>` : ''}
        ${(rd.missing || []).length ? `<details class="more"><summary>Confirm before sending (${rd.missing.length})</summary><ul class="small">${list(rd.missing)}</ul></details>` : ''}
        <details class="more"><summary>Items seen (${(rd.items || []).length})</summary><ul class="small">${list(rd.items)}</ul></details></div>
      <label class="f">Quote lines (before HST) — change anything</label>
      <div id="wrows">${p.lines.map((it, i) => `<div class="itemrow" data-row="${i}"><input class="in" data-k="desc" value="${esc(it.desc)}"><input class="in qty" data-k="qty" inputmode="decimal" value="${esc(it.qty)}"><input class="in price" data-k="price" inputmode="decimal" value="${esc(it.price)}"><span></span></div>`).join('')}</div>
      <div class="muted small" id="wtot"></div>
      <label class="f">Scope on the quote</label><textarea class="in" id="wscope" rows="5">${esc(rd.scope_for_quote || '')}</textarea>
      <div class="btns"><button class="btn full" id="wsend" ${l ? '' : 'disabled'}>📄 Create quote & text ${esc(l ? first(l.name) : 'customer')}</button>
        <button class="btn ghost" id="wask">🎙️ Talk it over with the assistant</button>
        ${l ? `<button class="btn ghost" data-go="#/lead/${l.id}">Open lead</button>` : ''}</div>
      <div class="muted small">Suggested from your estimating rates (⚙️ → Estimating rates). Check the price before sending.</div>`;
  }
  function bindWalkResult(w, l) {
    const n = (v) => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
    const rows = () => [...$app.querySelectorAll('#wrows .itemrow')].map((r) => ({ desc: r.querySelector('[data-k=desc]').value, qty: n(r.querySelector('[data-k=qty]').value) || 1, price: n(r.querySelector('[data-k=price]').value) }));
    const tot = () => { const s = rows().reduce((a, it) => a + it.qty * it.price, 0); const h = S.settings.hstNumber ? +S.settings.hstRate || 13 : 0; document.getElementById('wtot').textContent = `Subtotal ${money(s)}${h ? ` · with HST $${(s * (1 + h / 100)).toFixed(2)}` : ''} · deposit ${S.settings.depositPct || 30}% = ${money(s * (1 + h / 100) * (S.settings.depositPct || 30) / 100)}`; };
    tot(); $app.querySelector('#wrows').addEventListener('input', tot);
    document.getElementById('wask').onclick = () => {
      S.chat.push({ role: 'user', text: `I just did a video walkthrough${l ? ' for ' + l.name + ' (lead ' + l.id + ')' : ''}. The read: ${w.read.summary_for_owner} About ${Math.round(w.read.cubic_yards)} cu yd, ${w.read.crew_size} crew, ${w.read.onsite_hours} h. Suggested lines: ${rows().map((r) => r.desc + ' $' + r.qty * r.price).join('; ')}. Help me finalize the price and quote.` });
      saveChat(); go('#/ask'); ask(S.chat.pop().text);
    };
    const btn = document.getElementById('wsend');
    if (btn && l) btn.onclick = async () => {
      const items = rows().filter((it) => it.desc && it.price);
      if (!items.length) return toast('Add a price');
      btn.disabled = true;
      try {
        const r = await api('saveDoc', { doc: { type: 'quote', leadId: l.id, items, notes: document.getElementById('wscope').value } });
        upsert(S.docs, r.doc);
        api('saveLead', { lead: { id: l.id, quote: String(r.doc.subtotal), ...(['New', 'Contacted'].includes(l.status) ? { status: 'Quoted', followUp: addDays(today(), 1) } : {}) } }).then((x) => upsert(S.leads, x.lead)).catch(() => {});
        confirmSend({ to: l.phone, who: l.name, leadId: l.id, purpose: 'quote', body: `Hi ${first(l.name)}, thanks for walking us through the job. Your fixed price is ${money(r.doc.total)}${r.doc.tax ? ' including HST' : ' plus HST'}, all-in: labour, loading, haul-away and disposal. A ${S.settings.depositPct || 30}% deposit locks in your date. Review and accept here: ${r.doc.url}` }, () => { S.walk = null; go('#/doc/' + r.doc.id); });
      } catch (err) { toast(err.message); }
      btn.disabled = false;
    };
  }

  // ---------- quotes & invoices ----------
  function docsFor(l) { return S.docs.filter((d) => d.leadId === l.id); }
  function viewDoc(id) {
    const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
    const isNew = id && id.startsWith('new');
    const l0 = isNew ? lead(qs.get('lead')) : null;
    let d = isNew ? { type: qs.get('type') === 'invoice' ? 'invoice' : 'quote', leadId: l0 ? l0.id : '', items: [], discount: 0, paid: 0, notes: '' } : S.docs.find((x) => x.id === id);
    if (!d) return go('#/leads');
    if (isNew && d.type === 'invoice' && l0) {
      const q = S.docs.find((x) => x.leadId === l0.id && x.type === 'quote' && x.status !== 'Void');
      if (q) { d.items = q.items.map((x) => ({ ...x })); d.discount = q.discount || 0; d.notes = q.notes || ''; }
      if (l0.depositPaid) d.paid = l0.depositPaid;
      else if (l0.price || l0.quote) d.items = [{ desc: l0.job || 'Junk removal and cleanout', qty: 1, price: parseFloat(String(l0.price || l0.quote).replace(/[^0-9.]/g, '')) || 0 }];
    }
    if (isNew && d.type === 'quote' && l0 && !d.items.length) d.items = [{ desc: l0.job || 'Junk removal and cleanout', qty: 1, price: parseFloat(String(l0.quote).replace(/[^0-9.]/g, '')) || '' }];
    if (!d.items.length) d.items = [{ desc: '', qty: 1, price: '' }];
    const l = lead(d.leadId) || l0 || {};
    const hst = S.settings.hstNumber ? +S.settings.hstRate || 13 : 0;
    const rowHtml = (it, i) => `<div class="itemrow" data-row="${i}"><input class="in" placeholder="Description" value="${esc(it.desc)}" data-k="desc"><input class="in qty" inputmode="decimal" value="${esc(it.qty)}" data-k="qty"><input class="in price" inputmode="decimal" placeholder="$" value="${esc(it.price)}" data-k="price"><button class="linkbtn" data-delrow="${i}">✕</button></div>`;
    shell(`${d.type === 'quote' ? 'Quote' : 'Invoice'} ${isNew ? '' : d.id}`, `
      <div class="card"><div class="title">${esc(l.name || d.customerName || '')}</div><div class="muted small">${esc([l.phone, l.address, l.town].filter(Boolean).join(' · '))}</div>${isNew ? '' : `<div class="small" style="margin-top:6px"><span class="pill">${esc(d.status)}</span> ${d.viewedAt ? '· viewed by customer' : ''} ${d.acceptedAt ? '· accepted ' + fmtDay(d.acceptedAt.slice(0, 10)) : ''}</div>`}</div>
      <label class="f">Line items (before HST)</label><div id="rows">${d.items.map(rowHtml).join('')}</div>
      <button class="linkbtn" id="addrow">+ Add line</button>
      <div class="two"><div><label class="f">Discount ($)</label><input class="in" id="disc" inputmode="decimal" value="${esc(d.discount || '')}"></div>${d.type === 'invoice' ? `<div><label class="f">Already paid / deposit ($)</label><input class="in" id="paid" inputmode="decimal" value="${esc(d.paid || '')}"></div>` : '<div></div>'}</div>
      <label class="f">${d.type === 'quote' ? 'Scope — what\'s included, access, exclusions' : 'Notes'}</label><textarea class="in" id="dnotes">${esc(d.notes || '')}</textarea>
      <div class="card totals" id="tot"></div>
      ${!S.settings.hstNumber ? '<div class="muted small">No HST number in Settings, so HST is not added. Add it under ⚙️ → Business settings once you are registered.</div>' : ''}
      <div class="btns"><button class="btn full" id="dsave">${isNew ? 'Create ' + d.type : 'Save changes'}</button></div>
      ${isNew ? '' : `<h2>Send</h2><div class="btns">
        <button class="btn dark" id="dtext">💬 Text link to customer</button>
        <a class="btn ghost" href="${esc(d.url)}" target="_blank" rel="noopener">👁 Open</a>
        <button class="btn ghost" id="dcopy">🔗 Copy link</button>
        ${l.email ? `<a class="btn ghost" href="mailto:${esc(l.email)}?subject=${encodeURIComponent((d.type === 'quote' ? 'Your quote ' : 'Invoice ') + d.id + ' – ' + BIZ)}&body=${encodeURIComponent('Hi ' + first(l.name) + ',\n\n' + (d.type === 'quote' ? 'Here is your written quote' : 'Thank you for choosing us. Here is your invoice') + ': ' + d.url + '\n\n' + S.me.name + '\n' + BIZ + '\n(416) 659-5401')}">✉️ Email</a>` : ''}
        ${d.type === 'invoice' && d.status !== 'Paid' ? '<button class="btn ghost" id="dpaid">💵 Mark paid in full</button>' : ''}
        ${d.type === 'quote' && l.id ? `<button class="btn ghost" data-go="#/doc/new?lead=${l.id}&type=invoice">🧾 Make invoice from this</button>` : ''}
        <button class="btn ghost" id="dvoid">Void</button></div>`}
    `, { tab: 'leads', back: true });
    const readItems = () => [...$app.querySelectorAll('.itemrow')].map((r) => ({ desc: r.querySelector('[data-k=desc]').value, qty: r.querySelector('[data-k=qty]').value, price: r.querySelector('[data-k=price]').value }));
    const n = (v) => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
    const calc = () => {
      const items = readItems(); const sub = items.reduce((s, it) => s + (n(it.qty) || 1) * n(it.price), 0);
      const disc = n(document.getElementById('disc').value); const tax = Math.round((sub - disc) * hst) / 100; const tot = sub - disc + tax;
      const paid = d.type === 'invoice' ? n((document.getElementById('paid') || {}).value) : 0;
      const dep = d.type === 'quote' ? tot * (+S.settings.depositPct || 30) / 100 : 0;
      document.getElementById('tot').innerHTML = `<dl class="kv"><dt>Subtotal</dt><dd>${money(sub)}</dd>${disc ? `<dt>Discount</dt><dd>−${money(disc)}</dd>` : ''}${hst ? `<dt>HST ${hst}%</dt><dd>$${tax.toFixed(2)}</dd>` : ''}<dt><b>Total</b></dt><dd><b>$${tot.toFixed(2)}</b></dd>${d.type === 'quote' ? `<dt>Deposit ${S.settings.depositPct || 30}%</dt><dd>$${dep.toFixed(2)}</dd>` : ''}${paid ? `<dt>Paid</dt><dd>−$${paid.toFixed(2)}</dd><dt><b>Balance</b></dt><dd><b>$${(tot - paid).toFixed(2)}</b></dd>` : ''}</dl>`;
    };
    const main = $app.querySelector('main'); calc(); main.addEventListener('input', calc);
    document.getElementById('addrow').onclick = () => { const items = readItems(); items.push({ desc: '', qty: 1, price: '' }); document.getElementById('rows').innerHTML = items.map(rowHtml).join(''); calc(); };
    main.addEventListener('click', (e) => { const b = e.target.closest('[data-delrow]'); if (!b) return; const items = readItems(); items.splice(+b.dataset.delrow, 1); if (!items.length) items.push({ desc: '', qty: 1, price: '' }); document.getElementById('rows').innerHTML = items.map(rowHtml).join(''); calc(); });
    const save = async (extra = {}) => {
      const items = readItems().filter((it) => it.desc || n(it.price)).map((it) => ({ desc: it.desc, qty: n(it.qty) || 1, price: n(it.price) }));
      if (!items.length) { toast('Add at least one line with a price'); return null; }
      const r = await api('saveDoc', { doc: { id: isNew ? undefined : d.id, type: d.type, leadId: d.leadId, items, discount: n(document.getElementById('disc').value), paid: d.type === 'invoice' ? n((document.getElementById('paid') || {}).value) : 0, notes: document.getElementById('dnotes').value, ...extra } });
      upsert(S.docs, r.doc);
      if (l.id) {
        const patch = d.type === 'quote' ? { quote: String(r.doc.subtotal - (r.doc.discount || 0)), ...(['New', 'Contacted'].includes(l.status) ? { status: 'Quoted', followUp: l.followUp || addDays(today(), 2) } : {}) } : { price: String(r.doc.subtotal - (r.doc.discount || 0)), ...(l.status !== 'Done' ? { status: 'Done' } : {}) };
        api('saveLead', { lead: { id: l.id, ...patch } }).then((x) => upsert(S.leads, x.lead)).catch(() => {});
      }
      return r.doc;
    };
    document.getElementById('dsave').onclick = async (e) => { e.target.disabled = true; try { const doc = await save(); if (doc) { toast('Saved'); go('#/doc/' + doc.id, isNew); } } catch (err) { toast(err.message); } e.target.disabled = false; };
    if (isNew) return;
    document.getElementById('dtext').onclick = () => confirmSend({ to: l.phone || d.customerPhone, who: l.name || d.customerName, leadId: l.id, purpose: d.type,
      body: d.type === 'quote' ? `Hi ${first(l.name)}, here's your written quote from ${BIZ}: ${money(d.total)}${d.tax ? ' including HST' : ''}. You can review and accept it here: ${d.url}` : `Hi ${first(l.name)}, thank you for choosing ${BIZ}! Here's your invoice for ${money(d.balance)}: ${d.url}` }, () => load(true).then(() => viewDoc(d.id)).catch(() => {}));
    document.getElementById('dcopy').onclick = () => { navigator.clipboard.writeText(d.url).then(() => toast('Link copied')).catch(() => toast(d.url)); };
    const dp = document.getElementById('dpaid'); if (dp) dp.onclick = async () => { if (!confirm(`Mark ${d.id} paid in full (${money(d.total)})?`)) return; const doc = await save({ paid: d.total, status: 'Paid' }); if (doc) { toast('Marked paid'); viewDoc(doc.id); } };
    document.getElementById('dvoid').onclick = async () => { if (!confirm('Void this ' + d.type + '? The customer link will stop working.')) return; const doc = await save({ status: 'Void' }); if (doc) { toast('Voided'); viewDoc(doc.id); } };
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
      ${(() => { const mine = (S.tasks || allTasks()).filter((t) => t.leadId === l.id); return mine.length ? `<h2>Next step</h2><div class="list">${mine.map(taskCard).join('')}</div>` : ''; })()}
      <h2>Job checklist</h2>
      <div class="card checklist">${(() => { const st = PB.stateOf(l, S.docs); let stage = ''; return PB.STEPS.map(([k, sg, label]) => { const done = st.c[k]; const h = sg !== stage ? `<div class="stage">${sg}</div>` : ''; stage = sg; return `${h}<div class="ck ${done ? 'done' : ''}" data-ck="${k}"><span class="box">${done ? '✓' : ''}</span><span class="grow">${label}${k === 'deposit' && l.depositPaid ? ' ($' + l.depositPaid + ')' : ''}</span><span class="muted small">${done ? fmtDay(done) : ''}</span></div>`; }).join(''); })()}</div>
      <div class="muted small">Tap a step to tick it off (or untick it). Texts, quotes and invoices tick themselves.</div>
      <h2>Photos</h2>
      <div class="btns"><label class="btn ghost">📷 Before<input type="file" accept="image/*" capture="environment" multiple data-photo="before" hidden></label><label class="btn ghost">📷 After<input type="file" accept="image/*" capture="environment" multiple data-photo="after" hidden></label><label class="btn ghost">📎 Other<input type="file" accept="image/*" multiple data-photo="other" hidden></label></div>
      <div class="thumbs" id="pthumbs">${(l.photos || []).slice(-16).map((p) => `<div class="pth" data-key="${esc(p.key)}"><span>${esc(p.kind)}</span></div>`).join('')}</div>
      <h2>Text ${esc(first(l.name))} from the business number</h2>
      <div class="btns">${[['reply', 'First reply'], ['quote', 'Quote'], ['deposit', 'Deposit'], ['booking', 'Booking'], ['reminder', 'Reminder'], ['onway', 'On the way'], ['invoice', 'Invoice'], ['payReminder', 'Payment reminder'], ['review', '⭐ Review'], ['thanks', 'Thanks + referral']].filter(([k]) => pbText(k, l)).map(([k, t]) => `<button class="btn ghost small-btn" data-pb="${k}">${t}</button>`).join('')}<button class="btn ghost small-btn" data-pb="">✏️ Write your own</button></div>
      ${(l.checks || {}).optOut ? '<div class="overdue small">This customer replied STOP. Don\'t text them again.</div>' : ''}
      <h2>Quotes & invoices</h2>
      <div class="list">${docsFor(l).map((d) => `<div class="card" data-go="#/doc/${d.id}"><div class="row"><div class="grow"><div class="title">${d.type === 'quote' ? '📄 Quote' : '🧾 Invoice'} ${esc(d.id)}</div><div class="muted small">${fmtDay(d.created.slice(0, 10))}${d.viewedAt ? ' · viewed' : ''}</div></div><div style="text-align:right"><b>${money(d.total)}</b><div><span class="pill">${esc(d.status)}</span></div></div></div></div>`).join('')}</div>
      <div class="btns"><button class="btn" data-go="#/walk?lead=${l.id}" data-newwalk>🎥 Video estimate</button><button class="btn dark" data-go="#/doc/new?lead=${l.id}&type=quote">📄 New quote</button><button class="btn dark" data-go="#/doc/new?lead=${l.id}&type=invoice">🧾 New invoice</button></div>
      <h2>Notes & history</h2>
      <div class="card"><textarea class="in" id="nt" placeholder="Add a note (what they said, access, items, etc.)"></textarea><div class="btns"><button class="btn dark" id="addnote">Add note</button></div></div>
      ${(l.notes || []).map((n) => `<div class="note ${n.auto ? 'auto' : ''} ${n.in ? 'msg-in' : ''} ${n.out ? 'msg-out' : ''}"><div class="meta">${n.in ? '📩 ' : n.out ? '📤 ' : ''}${esc(n.by)} · ${new Date(n.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div><p>${esc(n.text)}</p></div>`).join('')}`}
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
    $app.querySelectorAll('[data-pb]').forEach((b) => b.onclick = () => {
      if (!ph) return toast('Add a phone number first');
      if ((l.checks || {}).optOut && !confirm(l.name + ' opted out of texts. Send anyway?')) return;
      confirmSend({ to: l.phone, who: l.name, leadId: l.id, purpose: b.dataset.pb || 'other', body: b.dataset.pb ? pbText(b.dataset.pb, l) : '' }, () => viewLead(l.id));
    });
    $app.querySelectorAll('[data-ck]').forEach((row) => row.onclick = async () => {
      const k = row.dataset.ck, st = PB.stateOf(l, S.docs);
      if (k === 'deposit' && !st.c.deposit) return depositPrompt(l).then(() => viewLead(l.id));
      if (['quoteSent', 'accepted', 'invoiceSent', 'paid'].includes(k) && !(l.checks || {})[k] && st.c[k]) return toast('Set by the quote/invoice');
      try { await setCheck(l, k, st.c[k] ? '' : today()); viewLead(l.id); } catch (err) { toast(err.message); }
    });
    $app.querySelectorAll('[data-photo]').forEach((inp) => inp.onchange = async () => {
      const files = [...inp.files].slice(0, 12); if (!files.length) return;
      toast(`Saving ${files.length} photo${files.length > 1 ? 's' : ''}…`);
      for (const f of files) { try { const data = await frameFromPhoto(f); const r = await api('addPhoto', { leadId: l.id, kind: inp.dataset.photo, data }); upsert(S.leads, r.lead); } catch (err) { toast(err.message); } }
      toast('Photos saved ✓'); viewLead(l.id);
    });
    const thumbs = [...$app.querySelectorAll('.pth')];
    (async () => { for (const t of thumbs) { try { const r = (S.mediaCache && S.mediaCache[t.dataset.key]) || (await api('media', { key: t.dataset.key })).src; (S.mediaCache = S.mediaCache || {})[t.dataset.key] = r; t.style.backgroundImage = `url(${r})`; t.onclick = () => { const w = window.open(); if (w) w.document.write(`<img src="${r}" style="max-width:100%">`); }; } catch (e) {} } })();
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
      ${owner ? `<h2>Business settings (quotes & invoices)</h2>
      <form id="bs" class="card">
        ${[['businessName', 'Business name'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address on documents'], ['hstNumber', 'HST number (leave blank if not registered)']].map(([k, t]) => `<label class="f">${t}</label><input class="in" name="${k}" value="${esc(S.settings[k] || '')}">`).join('')}
        <div class="two"><div><label class="f">HST %</label><input class="in" name="hstRate" inputmode="decimal" value="${esc(S.settings.hstRate)}"></div><div><label class="f">Deposit %</label><input class="in" name="depositPct" inputmode="decimal" value="${esc(S.settings.depositPct)}"></div></div>
        <label class="f">Quote valid for (days)</label><input class="in" name="quoteValidDays" inputmode="numeric" value="${esc(S.settings.quoteValidDays)}">
        <label class="f">How customers pay (shown on invoices)</label><textarea class="in" name="paymentInstructions">${esc(S.settings.paymentInstructions || '')}</textarea>
        <label class="f">Quote terms</label><textarea class="in" name="quoteTerms">${esc(S.settings.quoteTerms || '')}</textarea>
        <label class="f">Invoice terms</label><textarea class="in" name="invoiceTerms">${esc(S.settings.invoiceTerms || '')}</textarea>
        <div class="two"><div><label class="f">Your cell (replies forwarded + morning brief)</label><input class="in" name="ownerMobile" type="tel" value="${esc(S.settings.ownerMobile || '')}"></div><div><label class="f">Morning to-do text</label><select class="in" name="dailyBrief"><option value="on" ${S.settings.dailyBrief === 'on' ? 'selected' : ''}>On (7:30 AM)</option><option value="off" ${S.settings.dailyBrief !== 'on' ? 'selected' : ''}>Off</option></select></div></div>
        <label class="f">Google review link</label><input class="in" name="reviewUrl" value="${esc(S.settings.reviewUrl || '')}">
        <div class="btns"><button class="btn dark" type="submit">Save business settings</button></div></form>
      <h2>Estimating rates (video estimates)</h2>
      <form id="er" class="card"><div class="two">${[['minimum', 'Project minimum $'], ['perYard', '$ per cubic yard'], ['stairsPerFlight', 'Stairs $ per flight'], ['longCarry', 'Long carry $'], ['dismantlePerHour', 'Dismantle/demo $ per crew-hour'], ['heavyPerTonne', 'Heavy materials $ per tonne'], ['trailerYards', 'Trailer size (cu yd)']].map(([k, t]) => `<div><label class="f">${t}</label><input class="in" name="${k}" inputmode="decimal" value="${esc((S.settings.estimator || {})[k])}"></div>`).join('')}</div>
        <div class="muted small">The AI measures the job; these rates turn it into a price. Starting values are placeholders, so set them to your real numbers.</div>
        <div class="btns"><button class="btn dark" type="submit">Save rates</button></div></form>` : ''}
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
    const bs = document.getElementById('bs');
    if (bs) bs.onsubmit = async (e) => { e.preventDefault(); try { const r = await api('saveSettings', { settings: Object.fromEntries(new FormData(bs)) }); S.settings = r.settings; toast('Settings saved'); } catch (err) { toast(err.message); } };
    const er = document.getElementById('er');
    if (er) er.onsubmit = async (e) => { e.preventDefault(); try { const r = await api('saveSettings', { settings: { estimator: Object.fromEntries(new FormData(er)) } }); S.settings = { ...S.settings, ...r.settings, estimator: { ...S.settings.estimator, ...(r.settings.estimator || {}) } }; toast('Rates saved'); } catch (err) { toast(err.message); } };
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
    if (view === 'jobs' || view === 'calendar') return viewCalendar();
    if (view === 'ask') return viewAssistant();
    if (view === 'doc') return viewDoc(id);
    if ((view || '').startsWith('walk')) return viewWalk();
    if (view === 'partners') return viewPartners();
    if (view === 'partner') return viewPartner(id);
    if (view === 'more') return viewMore();
    return viewToday();
  }
  function softRefresh() {
    // Re-render list views after a background sync; leave forms alone so typing isn't lost.
    const v = (location.hash || '#/today').split('/')[1] || 'today';
    if (['today', 'leads', 'calendar', 'partners'].includes(v) && !document.activeElement.matches('input,textarea,select')) render();
  }
  window.addEventListener('hashchange', render);
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); if (g.hasAttribute('data-newwalk')) S.walk = null; return go(g.dataset.go); }
    if (e.target.closest('[data-back]')) return history.length > 1 ? history.back() : go('#/today');
    const fl = e.target.closest('[data-filter]'); if (fl) { S.filter = fl.dataset.filter; return location.hash === '#/leads' ? viewLeads() : go('#/leads'); }
    const tk = e.target.closest('[data-task]'); if (tk) { const t = (S.tasks || allTasks()).find((x) => x.id === tk.dataset.task); if (t) doTask(t).catch((err) => toast(err.message)); return; }
    const pf = e.target.closest('[data-pfilter]'); if (pf) { S.pfilter = pf.dataset.pfilter; return viewPartners(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
  setInterval(() => { if (S.me && document.visibilityState === 'visible') load(true).catch(() => {}); }, 60000);
  document.addEventListener('visibilitychange', () => { if (S.me && document.visibilityState === 'visible' && Date.now() - S.loaded > 15000) load(true).catch(() => {}); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/crm/sw.js', { scope: '/crm/' }).catch(() => {});
  render();
})();
