// CPS Hot Tub Movers texting number (365) 517-6300 -> Fabian's 647-204-0632.
// Twilio calls this when someone calls or texts the CPS Twilio number.
//   Voice:  forwards the call to 647-204-0632.
//   SMS:    forwards the text to 647-204-0632 as "CPS reply from <number>: <text>".
// Customers only ever deal with 647-204-0632; this number exists only because
// carriers let Twilio text from numbers it owns.
const crypto = require('crypto');

const FABIAN = '+16472040632';

const xml = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/xml' },
  body: `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
});

const esc = (s) =>
  String(s || '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function validSignature(event, params) {
  const token = process.env.TWILIO_AUTH_TOKEN || process.env.TwilioAUTHToken;
  const sig = event.headers['x-twilio-signature'];
  if (!token || !sig) return false;
  const url = 'https://' + event.headers.host + event.path + (event.rawQuery ? '?' + event.rawQuery : '');
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '';
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!validSignature(event, params)) {
    console.log('cps-forward: bad or missing Twilio signature');
    return { statusCode: 403, body: 'Forbidden' };
  }

  if (params.MessageSid || params.SmsSid) {
    const from = params.From || 'unknown number';
    let text = `CPS reply from ${from}: ${params.Body || ''}`.trim();
    const media = Number(params.NumMedia || 0);
    if (media > 0) text += ` [${media} photo${media > 1 ? 's' : ''}: ${[...Array(media)].map((_, i) => params['MediaUrl' + i]).join(' ')}]`;
    return xml(`<Message to="${FABIAN}">${esc(text.slice(0, 1500))}</Message>`);
  }

  // Voice call: ring Fabian; caller ID stays the customer's own number.
  return xml(`<Dial timeout="30">${FABIAN}</Dial>`);
};
