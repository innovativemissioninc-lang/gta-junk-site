/**
 * GTA Junk CRM API core (wrapped by netlify/functions/crm.mjs) — POST /api/crm  { action, ... }  with  Authorization: Bearer <token>
 *
 * First-time setup: the owner enters the one-time setup code Claude gave
 * Fabian (only its SHA-256 is stored here) plus his name and a PIN. After that
 * the owner adds Marlon, Jerome, etc. from Settings. PINs are stored as scrypt
 * hashes. Five wrong PINs lock that user for 15 minutes.
 * Data lives in Netlify Blobs (store "crm"); see netlify/lib/crm-lib.js.
 */
const crypto = require('crypto');
const { STATUSES, newId, clean, prettyPhone, listRecords } = require('./crm-lib');

const SETUP_HASH = 'c3851e25789d1e0f7c66a6cca6c814805c8d54da71111caf6dbcaaa7c6e9d69b';
const TOKEN_DAYS = 60;

const LEAD_FIELDS = ['name', 'phone', 'email', 'address', 'town', 'job', 'details', 'timing', 'source', 'status',
  'quote', 'price', 'jobDate', 'jobTime', 'crew', 'followUp', 'partnerId', 'reviewAsked', 'lostReason'];
const PARTNER_FIELDS = ['type', 'name', 'company', 'phone', 'email', 'address', 'area', 'stage', 'lastTouch', 'nextTouch', 'referrals'];
const PARTNER_STAGES = ['To visit', 'Card dropped', 'Talked', 'Interested', 'Referring', 'Not a fit'];

const json = (status, obj) => ({ statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pin), salt, 32).toString('hex') };
}
function pinOk(pin, user) {
  const h = crypto.scryptSync(String(pin), user.salt, 32);
  const b = Buffer.from(user.hash, 'hex');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
}
const userKey = (name) => `user/${String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

async function secret(store) {
  let s = await store.get('config/secret', { consistency: 'strong' });
  if (!s) {
    await store.set('config/secret', crypto.randomBytes(32).toString('hex'), { onlyIfNew: true });
    s = await store.get('config/secret', { consistency: 'strong' });
  }
  return s;
}
async function sign(store, user) {
  const payload = Buffer.from(JSON.stringify({ n: user.name, r: user.role, e: Date.now() + TOKEN_DAYS * 864e5, v: user.ver || 1 })).toString('base64url');
  const mac = crypto.createHmac('sha256', await secret(store)).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
async function verify(store, token) {
  if (!token || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const want = crypto.createHmac('sha256', await secret(store)).update(payload).digest('base64url');
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (p.e < Date.now()) return null;
  const user = await store.get(userKey(p.n), { type: 'json', consistency: 'strong' });
  if (!user || (user.ver || 1) !== p.v) return null; // removed user or PIN changed
  return user;
}
const publicUser = (u) => ({ name: u.name, role: u.role });

exports.handle = async (event, store) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  const a = body.action;

  try {
    // ---------- no-auth actions ----------
    if (a === 'status') {
      const { blobs: users } = await store.list({ prefix: 'user/' });
      return json(200, { setupNeeded: users.length === 0 });
    }
    if (a === 'setup') {
      const { blobs: users } = await store.list({ prefix: 'user/' });
      if (users.length) return json(403, { error: 'Already set up. Log in instead.' });
      const code = String(body.code || '').trim().toUpperCase();
      if (crypto.createHash('sha256').update(code).digest('hex') !== SETUP_HASH) return json(403, { error: 'Setup code is wrong.' });
      const name = clean(body.name, 40);
      if (!name || !/^\d{4,8}$/.test(String(body.pin || ''))) return json(400, { error: 'Enter your name and a 4–8 digit PIN.' });
      const user = { name, role: 'owner', ver: 1, ...hashPin(body.pin), fails: 0, lockUntil: 0, created: new Date().toISOString() };
      await store.setJSON(userKey(name), user, { onlyIfNew: true });
      return json(200, { token: await sign(store, user), user: publicUser(user) });
    }
    if (a === 'login') {
      const user = await store.get(userKey(body.name || ''), { type: 'json', consistency: 'strong' });
      if (!user) return json(401, { error: 'Name or PIN is wrong.' });
      if (user.lockUntil > Date.now()) return json(429, { error: 'Too many tries. Wait 15 minutes.' });
      if (!pinOk(body.pin || '', user)) {
        user.fails = (user.fails || 0) + 1;
        if (user.fails >= 5) { user.lockUntil = Date.now() + 15 * 6e4; user.fails = 0; }
        await store.setJSON(userKey(user.name), user);
        return json(401, { error: 'Name or PIN is wrong.' });
      }
      if (user.fails) { user.fails = 0; await store.setJSON(userKey(user.name), user); }
      return json(200, { token: await sign(store, user), user: publicUser(user) });
    }

    // ---------- signed-in actions ----------
    const auth = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const me = await verify(store, auth);
    if (!me) return json(401, { error: 'Please log in again.' });
    const now = new Date().toISOString();

    if (a === 'load') {
      const [leads, partners, users] = await Promise.all([listRecords(store, 'lead/'), listRecords(store, 'partner/'), listRecords(store, 'user/')]);
      return json(200, { me: publicUser(me), leads, partners, users: users.map(publicUser), statuses: STATUSES, partnerStages: PARTNER_STAGES });
    }

    if (a === 'saveLead') {
      const input = body.lead || {};
      let lead = input.id ? await store.get(`lead/${input.id}`, { type: 'json' }) : null;
      const isNew = !lead;
      if (isNew) lead = { id: newId('L'), created: now, status: 'New', notes: [], links: [], source: 'Added by ' + me.name };
      const changes = [];
      for (const f of LEAD_FIELDS) {
        if (!(f in input)) continue;
        let v = clean(input[f], f === 'details' ? 6000 : 300);
        if (f === 'phone') v = prettyPhone(v);
        if (f === 'status' && !STATUSES.includes(v)) continue;
        if (!isNew && (lead[f] || '') !== v && ['status', 'quote', 'price', 'jobDate', 'crew'].includes(f)) changes.push(`${f}: ${lead[f] || '—'} → ${v || '—'}`);
        lead[f] = v;
      }
      lead.unread = false;
      lead.updated = now;
      if (changes.length) lead.notes.unshift({ at: now, by: me.name, text: changes.join(' · '), auto: true });
      if (isNew) lead.notes.unshift({ at: now, by: me.name, text: 'Lead added.', auto: true });
      await store.setJSON(`lead/${lead.id}`, lead);
      return json(200, { lead });
    }
    if (a === 'note') {
      const key = `${body.kind === 'partner' ? 'partner' : 'lead'}/${body.id}`;
      const rec = await store.get(key, { type: 'json' });
      if (!rec) return json(404, { error: 'Not found' });
      const text = clean(body.text, 3000);
      if (text) rec.notes = [{ at: now, by: me.name, text }, ...(rec.notes || [])];
      if (body.kind === 'partner' && body.touch) rec.lastTouch = now.slice(0, 10);
      rec.unread = false; rec.updated = now;
      await store.setJSON(key, rec);
      return json(200, { record: rec });
    }
    if (a === 'markRead') {
      const rec = await store.get(`lead/${body.id}`, { type: 'json' });
      if (rec && rec.unread) { rec.unread = false; await store.setJSON(`lead/${body.id}`, rec); }
      return json(200, { ok: true });
    }
    if (a === 'savePartner') {
      const input = body.partner || {};
      let p = input.id ? await store.get(`partner/${input.id}`, { type: 'json' }) : null;
      if (!p) p = { id: newId('P'), created: now, notes: [{ at: now, by: me.name, text: 'Partner added.', auto: true }], referrals: 0 };
      for (const f of PARTNER_FIELDS) {
        if (!(f in input)) continue;
        let v = f === 'referrals' ? Math.max(0, parseInt(input[f], 10) || 0) : clean(input[f], 300);
        if (f === 'phone') v = prettyPhone(v);
        if (f === 'stage' && !PARTNER_STAGES.includes(v)) continue;
        p[f] = v;
      }
      p.updated = now;
      await store.setJSON(`partner/${p.id}`, p);
      return json(200, { partner: p });
    }

    // ---------- team management (owner) ----------
    if (a === 'changePin') {
      if (!pinOk(body.oldPin || '', me)) return json(401, { error: 'Current PIN is wrong.' });
      if (!/^\d{4,8}$/.test(String(body.newPin || ''))) return json(400, { error: 'New PIN must be 4–8 digits.' });
      Object.assign(me, hashPin(body.newPin), { ver: (me.ver || 1) + 1 });
      await store.setJSON(userKey(me.name), me);
      return json(200, { token: await sign(store, me) });
    }
    if (a === 'addUser' || a === 'removeUser') {
      if (me.role !== 'owner') return json(403, { error: 'Only the owner can manage the team.' });
      if (a === 'addUser') {
        const name = clean(body.name, 40);
        if (!name || !/^\d{4,8}$/.test(String(body.pin || ''))) return json(400, { error: 'Enter a name and a 4–8 digit PIN.' });
        const role = body.role === 'owner' ? 'owner' : 'crew';
        const prev = await store.get(userKey(name), { type: 'json' });
        const user = { name, role, ver: ((prev && prev.ver) || 0) + 1, ...hashPin(body.pin), fails: 0, lockUntil: 0, created: now };
        await store.setJSON(userKey(name), user);
        return json(200, { user: publicUser(user) });
      }
      if (userKey(body.name) === userKey(me.name)) return json(400, { error: "You can't remove yourself." });
      await store.delete(userKey(body.name));
      return json(200, { ok: true });
    }
    return json(400, { error: 'Unknown action' });
  } catch (e) {
    console.error('crm error', a, e && e.message);
    return json(500, { error: 'Server error. Try again.' });
  }
};
