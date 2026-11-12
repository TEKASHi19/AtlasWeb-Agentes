// Acceso a Google Calendar con una cuenta de servicio (sin dependencias).
import crypto from 'node:crypto';

const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
let cache = { token: null, exp: 0 };

export const googleActivo = () =>
  Boolean(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY && process.env.GOOGLE_CALENDAR_ID);

async function token() {
  if (cache.token && Date.now() < cache.exp - 60_000) return cache.token;
  const ahora = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: process.env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
  }));
  // La llave puede venir con "\n" escritos como texto (al pegarla en Vercel).
  const key = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const firma = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${firma}`,
    }),
  });
  if (!r.ok) throw new Error(`Google token ${r.status}: ${await r.text()}`);
  const d = await r.json();
  cache = { token: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return cache.token;
}

async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Google Calendar ${r.status}: ${await r.text()}`);
  return r.json();
}

// Bloques ocupados entre dos fechas ISO.
export async function ocupados(desdeISO, hastaISO) {
  const id = process.env.GOOGLE_CALENDAR_ID;
  const d = await api('/freeBusy', {
    method: 'POST',
    body: { timeMin: desdeISO, timeMax: hastaISO, timeZone: 'America/Mexico_City', items: [{ id }] },
  });
  const cal = d.calendars?.[id];
  if (cal?.errors?.length) throw new Error('Sin acceso al calendario: ' + JSON.stringify(cal.errors));
  return (cal?.busy || []).map(b => ({ inicio: new Date(b.start), fin: new Date(b.end) }));
}

export async function crearEvento({ resumen, descripcion, inicioISO, finISO, telefono }) {
  const id = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);
  return api(`/calendars/${id}/events`, {
    method: 'POST',
    body: {
      summary: resumen,
      description: descripcion,
      start: { dateTime: inicioISO, timeZone: 'America/Mexico_City' },
      end: { dateTime: finISO, timeZone: 'America/Mexico_City' },
      extendedProperties: { private: { telefono: String(telefono || '') } },
    },
  });
}

const calId = () => encodeURIComponent(process.env.GOOGLE_CALENDAR_ID);

// Citas futuras de un cliente: por el dato oculto "telefono" y, para citas viejas, por texto en la descripción.
export async function eventosDeCliente(telefono, desdeISO, hastaISO) {
  const base = { timeMin: desdeISO, timeMax: hastaISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '20' };
  const [a, b] = await Promise.all([
    api(`/calendars/${calId()}/events?${new URLSearchParams({ ...base, privateExtendedProperty: `telefono=${telefono}` })}`),
    api(`/calendars/${calId()}/events?${new URLSearchParams({ ...base, q: telefono })}`),
  ]);
  const vistos = new Map();
  for (const e of [...(a.items || []), ...(b.items || [])]) {
    const tel = e.extendedProperties?.private?.telefono;
    const enDescripcion = (e.description || '').includes(`+${telefono}`);
    if ((tel === telefono || enDescripcion) && e.status !== 'cancelled') vistos.set(e.id, e);
  }
  return [...vistos.values()].sort((x, y) => new Date(x.start.dateTime) - new Date(y.start.dateTime));
}

export async function borrarEvento(id) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calId()}/events/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!r.ok && r.status !== 410) throw new Error(`Google Calendar ${r.status}: ${await r.text()}`);
}

export async function moverEvento(id, inicioISO, finISO) {
  return api(`/calendars/${calId()}/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      start: { dateTime: inicioISO, timeZone: 'America/Mexico_City' },
      end: { dateTime: finISO, timeZone: 'America/Mexico_City' },
    },
  });
}

// Evento de bloqueo: todo el día (fechaFin exclusiva) o por horas.
export async function crearBloqueo({ motivo, fechaInicio, fechaFinExclusiva, inicioISO, finISO }) {
  const cuando = inicioISO
    ? { start: { dateTime: inicioISO, timeZone: 'America/Mexico_City' }, end: { dateTime: finISO, timeZone: 'America/Mexico_City' } }
    : { start: { date: fechaInicio }, end: { date: fechaFinExclusiva } };
  return api(`/calendars/${calId()}/events`, {
    method: 'POST',
    body: {
      summary: `🚫 Cerrado${motivo ? ': ' + motivo : ''}`,
      description: 'Bloqueo creado por el dueño desde WhatsApp.',
      transparency: 'opaque',
      extendedProperties: { private: { tipo: 'bloqueo' } },
      ...cuando,
    },
  });
}

export async function listarEventos(desdeISO, hastaISO) {
  const q = new URLSearchParams({ timeMin: desdeISO, timeMax: hastaISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
  const d = await api(`/calendars/${calId()}/events?${q}`);
  return (d.items || []).filter(e => e.status !== 'cancelled');
}
