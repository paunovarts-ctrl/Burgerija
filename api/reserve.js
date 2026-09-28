// Receives a table request from the website and pushes it to the owner's
// phone through ntfy (https://ntfy.sh). Configure in Vercel:
//   NTFY_TOPIC   required  unguessable topic name the owner subscribes to
//   NTFY_SERVER  optional  defaults to https://ntfy.sh
//   NTFY_TOKEN   optional  access token if the topic is reserved/protected

const OPEN = '12:00';
const LAST = '22:00';
const MAX_PARTY = 20;
const LANGS = ['en', 'de', 'hr', 'it'];

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function validate(b) {
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const party = Number(b.party);
  const name = clean(b.name, 80);
  const phone = clean(b.phone, 32);
  const email = clean(b.email, 120);
  const note = clean(b.note, 400);
  const lang = LANGS.includes(b.lang) ? b.lang : 'en';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date' };
  const day = new Date(date + 'T12:00:00Z');
  const now = new Date();
  const min = new Date(now); min.setUTCDate(min.getUTCDate() - 1);
  const max = new Date(now); max.setUTCDate(max.getUTCDate() + 120);
  if (isNaN(day) || day < min || day > max) return { error: 'date' };
  if (!/^\d{2}:\d{2}$/.test(time) || time < OPEN || time > LAST) return { error: 'time' };
  if (!Number.isInteger(party) || party < 1 || party > MAX_PARTY) return { error: 'party' };
  if (name.length < 2) return { error: 'name' };
  if ((phone.match(/\d/g) || []).length < 6) return { error: 'phone' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email' };

  return { value: { date, time, party, name, phone, email, note, lang } };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method' });
  }

  const body = typeof req.body === 'string' ? safeJSON(req.body) : (req.body || {});

  // bots fill the hidden field or submit instantly; pretend success so they move on
  if (body.website || (Number(body.elapsed) > 0 && Number(body.elapsed) < 2500)) {
    return res.status(200).json({ ok: true });
  }

  const { value: r, error } = validate(body);
  if (error) return res.status(400).json({ ok: false, error });

  const topic = process.env.NTFY_TOPIC;
  if (!topic) return res.status(500).json({ ok: false, error: 'not-configured' });
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');

  const when = new Date(r.date + 'T12:00:00Z').toLocaleDateString('hr-HR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
  });
  const [, mm, dd] = r.date.split('-');
  const short = new Date(r.date + 'T12:00:00Z').toLocaleDateString('hr-HR', { weekday: 'short', timeZone: 'UTC' }) + ` ${+dd}.${+mm}.`;
  const digits = r.phone.replace(/[^\d+]/g, '');
  const waNumber = digits.replace(/^\+/, '').replace(/^00/, '');

  const lines = [
    `${r.name}, ${osoba(r.party)}`,
    `${when} u ${r.time}`,
    `Tel: ${r.phone}`,
    r.email && `E-mail: ${r.email}`,
    r.note && `Napomena: ${r.note}`,
    `Jezik gosta: ${r.lang.toUpperCase()}`
  ].filter(Boolean);

  const payload = {
    topic,
    title: `Rezervacija: ${short} u ${r.time}, ${osoba(r.party)}`,
    message: lines.join('\n'),
    tags: ['fork_and_knife_with_plate'],
    priority: 4,
    actions: [
      { action: 'view', label: 'Nazovi gosta', url: `tel:${digits}`, clear: false },
      { action: 'view', label: 'WhatsApp', url: `https://wa.me/${waNumber}`, clear: false }
    ]
  };

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;

  try {
    const push = await fetch(server, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!push.ok) {
      console.error('ntfy rejected the push', push.status, await push.text().catch(() => ''));
      return res.status(502).json({ ok: false, error: 'notify' });
    }
  } catch (err) {
    console.error('ntfy unreachable', err);
    return res.status(502).json({ ok: false, error: 'notify' });
  }

  return res.status(200).json({ ok: true });
};

// Croatian counts: 1 osoba, 2-4 osobe, 5+ osoba (but 12-14 osoba)
function osoba(n) {
  const m10 = n % 10, m100 = n % 100;
  return n + (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? ' osobe' : ' osoba');
}

function safeJSON(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
