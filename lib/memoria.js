// Memoria de las pláticas en Supabase (tabla public.mensajes), vía la API REST.
// Si no hay SUPABASE_URL / SUPABASE_SECRET_KEY, el bot funciona sin memoria.

const URL_BASE = () => process.env.SUPABASE_URL?.replace(/\/$/, '');
const KEY = () => process.env.SUPABASE_SECRET_KEY;
export const memoriaActiva = () => Boolean(URL_BASE() && KEY());

function headers(extra = {}) {
  return { apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', ...extra };
}

// Guarda un mensaje. Regresa false si ya existía (Meta a veces manda el mismo mensaje dos veces).
export async function guardarMensaje({ phoneId, cliente, rol, contenido, waId = null }) {
  if (!memoriaActiva()) return true;
  const r = await fetch(`${URL_BASE()}/rest/v1/mensajes`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ negocio_phone_id: phoneId, cliente, rol, contenido, wa_message_id: waId }),
  });
  if (r.status === 409) return false; // duplicado
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return true;
}

// Últimos mensajes de las últimas 24 h con ese cliente, en orden cronológico.
export async function historial({ phoneId, cliente, limite = 20 }) {
  if (!memoriaActiva()) return [];
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const q = new URLSearchParams({
    select: 'rol,contenido',
    negocio_phone_id: `eq.${phoneId}`,
    cliente: `eq.${cliente}`,
    creado: `gte.${desde}`,
    order: 'creado.desc',
    limit: String(limite),
  });
  const r = await fetch(`${URL_BASE()}/rest/v1/mensajes?${q}`, { headers: headers() });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return (await r.json()).reverse();
}

// Convierte el historial al formato de Claude: roles alternados y empezando por el cliente.
export function aMensajesClaude(filas) {
  const out = [];
  for (const f of filas) {
    const role = f.rol === 'assistant' ? 'assistant' : 'user';
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + f.contenido;
    else out.push({ role, content: f.contenido });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
