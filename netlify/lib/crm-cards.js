/**
 * Business-card reader for the GTA Junk CRM. The phone sends 1–2 photos
 * (front/back); Claude returns the contact fields for the user to check.
 * Nothing is saved here.
 */
const { clean } = require('./crm-lib');

const MODEL = 'claude-sonnet-5-5';
const TYPES = ['Realtor', 'Estate lawyer', 'Property manager', 'Restoration company', 'Senior living / downsizing', 'Contractor / builder', 'Storage facility', 'Other'];

const PROMPT = `Read this business card (one or two photos: front and back). Return ONLY one JSON object, no markdown:
{"name":"person's full name or empty","title":"job title or empty","company":"company / firm / facility name","phone":"main direct or office phone","mobile":"cell if separately listed, else empty","email":"","website":"","address":"street, city, province/state, postal code as printed","type":"one of: ${TYPES.join(' | ')}","notes":"anything else useful printed on the card (fax, second phone, licence/brokerage, services listed), short","confidence":"high|medium|low"}
Rules: copy exactly what is printed (fix only obvious OCR-style spacing); never invent a field; lower-case emails and websites; pick "type" from the company and title (e.g. self-storage → Storage facility, law office/estates/wills → Estate lawyer, brokerage/REALTOR® → Realtor, property management/condo management → Property manager, restoration/remediation/insurance claims → Restoration company, retirement residence/senior move manager → Senior living / downsizing).`;

async function readCard(images) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: 'The Anthropic API key is missing on Netlify.' };
  const imgs = (images || []).filter((d) => typeof d === 'string' && d.startsWith('data:image/jpeg;base64,')).slice(0, 2);
  if (!imgs.length) return { error: 'Take a photo of the card first.' };
  const content = imgs.map((d) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.split(',')[1] } }));
  content.push({ type: 'text', text: 'Read the card.' });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 800, system: PROMPT, messages: [{ role: 'user', content }] })
  });
  if (!res.ok) { console.error('card api', res.status, (await res.text()).slice(0, 300)); return { error: 'Could not read the card right now. Try again or type it in.' }; }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  let card;
  try { card = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) { return { error: 'Could not read the card. Try a closer, sharper photo.' }; }
  const out = {};
  for (const k of ['name', 'title', 'company', 'phone', 'mobile', 'email', 'website', 'address', 'notes', 'confidence']) out[k] = clean(card[k], 300);
  out.type = TYPES.includes(card.type) ? card.type : 'Other';
  return { card: out };
}

module.exports = { readCard, TYPES };
