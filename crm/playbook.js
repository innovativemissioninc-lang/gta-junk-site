/* GTA Junk CRM — job playbook.
 * One source of truth for "what needs doing for each customer, and when",
 * used by the phone app (Today / lead checklist) and by the daily brief text.
 * Loaded in the browser (window.GTJPlaybook) and in Netlify functions (require).
 *
 * lead.checks = { key: 'YYYY-MM-DD' } records steps already done. Some steps
 * are also read from quotes/invoices (sent, accepted, paid).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTJPlaybook = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const BIZ = 'GTA Junk and Property Cleanout';

  const STEPS = [
    // [key, stage, label]
    ['replied', 'Lead', 'Replied to the enquiry'],
    ['walkthrough', 'Estimate', 'Walkthrough / photos documented'],
    ['quoteSent', 'Estimate', 'Written quote sent'],
    ['accepted', 'Estimate', 'Quote accepted'],
    ['deposit', 'Booking', 'Deposit received'],
    ['bookingSent', 'Booking', 'Booking confirmation texted'],
    ['reminderSent', 'Job day', 'Day-before reminder sent'],
    ['onWaySent', 'Job day', '"On the way" text sent'],
    ['beforePhotos', 'Job day', 'Before photos taken'],
    ['afterPhotos', 'Job day', 'After photos taken'],
    ['signoff', 'Job day', 'Walked the site with the customer'],
    ['invoiceSent', 'Payment', 'Invoice sent'],
    ['paid', 'Payment', 'Paid in full'],
    ['reviewAsked', 'After', 'Review requested'],
    ['thanksSent', 'After', 'Thank-you + referral ask'],
    ['nurture30', 'After', '30-day check-in'],
    ['nurture180', 'After', '6-month check-in']
  ];

  const first = (n) => { const f = String(n || '').trim().split(/\s+/)[0]; return f && !/^\(/.test(f) ? f : 'there'; };
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dayName = (d, today) => { if (!d) return 'your booked day'; if (d === today) return 'today'; if (d === addDays(today, 1)) return 'tomorrow'; return new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }); };

  /** Merge stored checks with what the documents show. */
  function stateOf(l, docs) {
    const c = Object.assign({}, l.checks || {});
    const mine = (docs || []).filter((d) => d.leadId === l.id && d.status !== 'Void');
    const q = mine.filter((d) => d.type === 'quote').sort((a, b) => b.created.localeCompare(a.created))[0];
    const inv = mine.filter((d) => d.type === 'invoice').sort((a, b) => b.created.localeCompare(a.created))[0];
    if (q && q.sentAt && !c.quoteSent) c.quoteSent = q.sentAt.slice(0, 10);
    if (q && q.acceptedAt && !c.accepted) c.accepted = q.acceptedAt.slice(0, 10);
    if (inv && inv.sentAt && !c.invoiceSent) c.invoiceSent = inv.sentAt.slice(0, 10);
    if (inv && inv.status === 'Paid' && !c.paid) c.paid = (inv.updated || inv.created).slice(0, 10);
    if (l.reviewAsked && !c.reviewAsked) c.reviewAsked = l.reviewAsked;
    if (!c.replied && ['Contacted', 'Quoted', 'Booked', 'Done'].includes(l.status)) c.replied = (l.updated || l.created || '').slice(0, 10);
    if (!c.accepted && ['Booked', 'Done'].includes(l.status) && c.quoteSent) c.accepted = c.quoteSent;
    return { c, quote: q, invoice: inv };
  }

  /** Professional message templates. ctx: { me, settings, today } */
  function message(kind, l, st, ctx) {
    const s = ctx.settings || {}, me = ctx.me || 'the team', n = first(l.name);
    const q = st.quote, inv = st.invoice;
    const sign = `\n– ${me}, ${BIZ}`;
    const when = `${dayName(l.jobDate, ctx.today)}${l.jobTime ? ' at ' + l.jobTime : ''}`;
    const pay = s.paymentInstructions || 'Interac e-Transfer or cash on completion.';
    const T = {
      reply: `Hi ${n}, thanks for reaching out to ${BIZ}${l.job ? ' about ' + String(l.job).toLowerCase() : ''}. To give you a fixed price fast, could you text a few photos or a short video of everything that's going and where it is? If it's a bigger job, we're happy to come by for a free walkthrough.${sign}`,
      photos: `Hi ${n}, just following up from ${BIZ}. When you have a minute, send a few photos or a quick video and your address, and we'll have a fixed written price back to you the same day. Or pick a time and we'll come take a look.${sign}`,
      quote: q ? `Hi ${n}, thank you for walking us through the job. Your fixed price is ${money(q.total)}${q.tax ? ' including HST' : ' plus HST'}, all-in: labour, loading, haul-away and disposal. You can review and accept it here: ${q.url || ''}${sign}` : '',
      followup1: `Hi ${n}, just checking you received your quote from ${BIZ}${q ? ' (' + money(q.total) + ')' : ''}. Happy to answer any questions or adjust the scope. ${q && q.url ? 'You can accept it here: ' + q.url : ''}${sign}`,
      followup2: `Hi ${n}, our schedule for the next couple of weeks is filling up. If you'd like to lock in a date for your job, just reply here or accept the quote${q && q.url ? ': ' + q.url : ''} and we'll get you booked.${sign}`,
      followup3: `Hi ${n}, last check-in from ${BIZ} about your quote. If the timing isn't right or plans changed, no problem at all, just let us know. We're here whenever you need us.${sign}`,
      deposit: `Hi ${n}, thank you for choosing ${BIZ}! To lock in your date, the ${s.depositPct || 30}% deposit is ${q ? money(q.deposit) : '$___'}. ${pay} Once it's in, we'll confirm your booking right away.${sign}`,
      booking: `Hi ${n}, you're booked with ${BIZ} for ${when}${l.address ? ' at ' + l.address : ''}. Our crew will text when we're on the way. If anything changes, just reply here.${sign}`,
      reminder: `Hi ${n}, a friendly reminder that ${BIZ} is booked for ${when}. Please make sure we can park close by and that anything staying is set aside or marked. See you then!${sign}`,
      onway: `Hi ${n}, the ${BIZ} crew is on the way and should arrive in about 30 minutes.${sign}`,
      invoice: inv ? `Hi ${n}, thank you for having us! Your invoice for ${money(inv.balance)} is here: ${inv.url || ''}. ${pay}${sign}` : '',
      payReminder: inv ? `Hi ${n}, a friendly reminder that invoice ${inv.id} for ${money(inv.balance)} is still open. You can view it here: ${inv.url || ''}. ${pay} Thank you!${sign}` : '',
      review: `Hi ${n}, thank you again for choosing ${BIZ}. If you were happy with the job, a quick Google review helps our small local team a lot: ${s.reviewUrl || ''}${sign}`,
      thanks: `Hi ${n}, hope you're enjoying the extra space! If a friend, neighbour or family member ever needs a cleanout, we'd be grateful for the referral, and we'll look after them the same way.${sign}`,
      nurture30: `Hi ${n}, ${me} from ${BIZ} here. Just checking in a month after your job. If anything else needs to go (garage, shed, yard waste), we're one text away. Reply STOP to opt out.`,
      nurture180: `Hi ${n}, it's ${BIZ}. Spring/fall cleanouts are a great time to clear the garage, basement or yard. If you need a hand, just reply and we'll get you a quick price. Reply STOP to opt out.`
    };
    return T[kind] || '';
  }

  /** All open to-dos, most urgent first. */
  function tasks(leads, docs, partners, ctx) {
    const today = ctx.today, now = ctx.nowMs || Date.now();
    const out = [];
    const add = (l, key, title, due, pri, action, why) => (l && (l.checks || {}).optOut && action.kind === 'sms') ? null : out.push({ id: l ? l.id + ':' + key : key, leadId: l ? l.id : '', name: l ? l.name : '', key, title, due, overdue: due && due < today, pri, action, why: why || '' });
    for (const l of leads || []) {
      if (l.status === 'Lost') continue;
      const st = stateOf(l, docs), c = st.c;
      const ageMin = (now - Date.parse(l.created || now)) / 6e4;
      const days = (d) => d ? Math.round((Date.parse(today) - Date.parse(d)) / 864e5) : 0;
      if (l.unreadReply) add(l, 'replyIn', `${l.name} texted back`, today, -1, { kind: 'go', href: `#/lead/${l.id}`, label: 'Read & reply' });
      if (l.status === 'New' && !c.replied) { add(l, 'replied', `Reply to ${l.name}`, today, ageMin > 15 ? 0 : 1, { kind: 'sms', purpose: 'reply' }, ageMin > 15 ? `Waiting ${ageMin > 90 ? Math.round(ageMin / 60) + ' h' : Math.round(ageMin) + ' min'} — reply within 15 minutes wins jobs` : 'New lead'); continue; }
      if (['New', 'Contacted'].includes(l.status) && !c.walkthrough && !c.quoteSent && !st.quote) {
        const due = addDays(c.replied || today, 1);
        if (due <= today && !c.photosAsked) add(l, 'photosAsked', `Get photos or book a walkthrough: ${l.name}`, due, 2, { kind: 'sms', purpose: 'photos' });
        continue;
      }
      if (!['Booked', 'Done'].includes(l.status) && (c.walkthrough || st.quote) && !c.quoteSent) {
        add(l, 'quoteSent', `Send the quote to ${l.name}`, c.walkthrough || today, 0, st.quote ? { kind: 'sms', purpose: 'quote' } : { kind: 'go', href: `#/doc/new?lead=${l.id}&type=quote`, label: 'Write quote' }, 'Quotes sent the same day win far more jobs');
        continue;
      }
      if (c.quoteSent && !c.accepted && !['Booked', 'Done'].includes(l.status)) {
        const d = days(c.quoteSent);
        if (d >= 14) add(l, 'close', `No answer on ${l.name}'s quote for ${d} days`, today, 3, { kind: 'go', href: `#/lead/${l.id}`, label: 'Call or mark Lost' });
        else if (d >= 10 && !c.followup3) add(l, 'followup3', `Last follow-up: ${l.name}`, addDays(c.quoteSent, 10), 2, { kind: 'sms', purpose: 'followup3' });
        else if (d >= 5 && !c.followup2) add(l, 'followup2', `Follow up on quote: ${l.name}`, addDays(c.quoteSent, 5), 2, { kind: 'sms', purpose: 'followup2' });
        else if (d >= 2 && !c.followup1) add(l, 'followup1', `Follow up on quote: ${l.name}`, addDays(c.quoteSent, 2), 1, { kind: 'sms', purpose: 'followup1' });
        continue;
      }
      if (c.accepted && !c.deposit && l.status !== 'Done') {
        if (!c.depositAsked) add(l, 'depositAsked', `Request the deposit from ${l.name}`, c.accepted, 0, { kind: 'sms', purpose: 'deposit' }, 'Quote accepted');
        else add(l, 'deposit', `Deposit from ${l.name}: received?`, addDays(c.depositAsked, 1), 1, { kind: 'check', key: 'deposit', label: 'Deposit received' });
      }
      if (c.accepted && l.status !== 'Booked' && l.status !== 'Done') { add(l, 'book', `Book a date for ${l.name}`, c.accepted, 1, { kind: 'go', href: `#/lead/${l.id}`, label: 'Set date' }); continue; }
      if (l.status === 'Booked') {
        if (!l.jobDate) { add(l, 'book', `Set the job date for ${l.name}`, today, 1, { kind: 'go', href: `#/lead/${l.id}`, label: 'Set date' }); continue; }
        if (!c.bookingSent) add(l, 'bookingSent', `Confirm the booking with ${l.name}`, today, 1, { kind: 'sms', purpose: 'booking' });
        if (l.jobDate === addDays(today, 1) && !c.reminderSent) add(l, 'reminderSent', `Day-before reminder: ${l.name}`, today, 1, { kind: 'sms', purpose: 'reminder' });
        if (l.jobDate === today) {
          if (!c.onWaySent) add(l, 'onWaySent', `Text ${l.name} when you're on the way`, today, 1, { kind: 'sms', purpose: 'onway' });
          if (!c.beforePhotos) add(l, 'beforePhotos', `Before photos at ${l.name}'s`, today, 1, { kind: 'go', href: `#/lead/${l.id}`, label: 'Add photos' });
        }
        if (l.jobDate <= today) add(l, 'finish', `Finish ${l.name}'s job: after photos, walk the site, mark Done`, l.jobDate, 1, { kind: 'go', href: `#/lead/${l.id}`, label: 'Open job' });
        continue;
      }
      if (l.status === 'Done') {
        const doneDay = c.signoff || (l.updated || '').slice(0, 10) || today;
        if (!st.invoice) add(l, 'invoice', `Send ${l.name}'s invoice`, doneDay, 0, { kind: 'go', href: `#/doc/new?lead=${l.id}&type=invoice`, label: 'Make invoice' }, 'Invoice the same day the job is done');
        else if (!c.invoiceSent) add(l, 'invoiceSent', `Text ${l.name} the invoice`, doneDay, 0, { kind: 'sms', purpose: 'invoice' });
        else if (!c.paid) {
          const d = days(c.invoiceSent), n = (c.payReminders || '').split(',').filter(Boolean).length;
          const next = [3, 7, 14][n];
          if (next !== undefined && d >= next) add(l, 'payReminder', `Payment reminder #${n + 1}: ${l.name} (${money(st.invoice.balance)})`, addDays(c.invoiceSent, next), n ? 0 : 1, { kind: 'sms', purpose: 'payReminder' });
          else if (next === undefined && d >= 21) add(l, 'payCall', `Call ${l.name} about the overdue invoice (${d} days)`, today, 0, { kind: 'go', href: `#/lead/${l.id}`, label: 'Call' });
          add(l, 'paid', `${l.name}: payment received?`, addDays(c.invoiceSent, 1), 2, { kind: 'check', key: 'paid', label: 'Mark paid' });
        }
        if (!c.reviewAsked) add(l, 'reviewAsked', `Ask ${l.name} for a Google review`, doneDay, 1, { kind: 'sms', purpose: 'review' });
        else if (!c.thanksSent && days(c.reviewAsked) >= 3) add(l, 'thanksSent', `Thank-you + referral ask: ${l.name}`, addDays(c.reviewAsked, 3), 2, { kind: 'sms', purpose: 'thanks' });
        else if (c.thanksSent && !c.nurture30 && days(doneDay) >= 30) add(l, 'nurture30', `30-day check-in: ${l.name}`, addDays(doneDay, 30), 3, { kind: 'sms', purpose: 'nurture30' });
        else if (c.nurture30 && !c.nurture180 && days(doneDay) >= 180) add(l, 'nurture180', `6-month check-in: ${l.name}`, addDays(doneDay, 180), 3, { kind: 'sms', purpose: 'nurture180' });
      }
    }
    for (const p of partners || []) {
      const nm = p.name || p.company;
      if (p.unreadReferral) out.push({ id: p.id + ':refThanks', partnerId: p.id, name: nm, key: 'refThanks', title: `${nm} sent you a referral. Say thank you`, due: today, overdue: false, pri: 0, action: { kind: 'go', href: `#/partner/${p.id}`, label: 'Thank them' } });
      if (p.metAt && !p.thanked) out.push({ id: p.id + ':thanks', partnerId: p.id, name: nm, key: 'partnerThanks', title: `Send ${nm} a thank-you for meeting`, due: p.metAt, overdue: p.metAt < today, pri: 1, action: { kind: 'go', href: `#/partner/${p.id}?email=1`, label: 'Email' } });
    }
    for (const p of partners || []) if (p.nextTouch && p.nextTouch <= today && !p.unreadReferral) out.push({ id: p.id + ':visit', partnerId: p.id, name: p.name || p.company, key: 'visit', title: `Visit or call ${p.name || p.company}`, due: p.nextTouch, overdue: p.nextTouch < today, pri: 3, action: { kind: 'go', href: `#/partner/${p.id}`, label: 'Log visit' } });
    return out.sort((a, b) => (a.pri - b.pri) || String(a.due).localeCompare(String(b.due)));
  }

  /** Which check a text with this purpose completes. */
  const PURPOSE_CHECK = { reply: 'replied', photos: 'photosAsked', quote: 'quoteSent', followup1: 'followup1', followup2: 'followup2', followup3: 'followup3', deposit: 'depositAsked', booking: 'bookingSent', reminder: 'reminderSent', onway: 'onWaySent', invoice: 'invoiceSent', review: 'reviewAsked', thanks: 'thanksSent', nurture30: 'nurture30', nurture180: 'nurture180' };

  return { STEPS, stateOf, message, tasks, PURPOSE_CHECK, addDays };
});
