// Alta de un negocio nuevo (Embedded Signup de Meta, con coexistencia).
// GET  -> datos públicos para la página de alta (App ID y Config ID).
// POST -> recibe el código de Meta, lo canjea por el token del negocio, suscribe la app a su cuenta de WhatsApp,
//         sincroniza la app (coexistencia) y guarda las credenciales. El negocio queda inactivo hasta configurarlo.
import { GRAPH } from '../lib/whatsapp.js';
import { alertar } from '../lib/alertas.js';

const SB = () => ({ url: process.env.SUPABASE_URL?.replace(/\/$/, ''), key: process.env.SUPABASE_SECRET_KEY });
const sbHeaders = (extra = {}) => ({ apikey: SB().key, Authorization: `Bearer ${SB().key}`, 'Content-Type': 'application/json', ...extra });

export async function GET() {
  return Response.json({
    appId: process.env.META_APP_ID || null,
    configId: process.env.META_CONFIG_ID || null,
    graphVersion: 'v24.0',
  });
}

export async function POST(request) {
  let datos;
  try { datos = await request.json(); } catch { return Response.json({ ok: false, error: 'Datos inválidos' }, { status: 400 }); }
  const { invitacion, code, waba_id, phone_number_id, nombre } = datos || {};

  // Solo con código de invitación (lo das tú a cada cliente), para que nadie más se dé de alta.
  const validos = (process.env.ALTA_CODIGOS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!invitacion || !validos.includes(invitacion)) return Response.json({ ok: false, error: 'Código de invitación inválido' }, { status: 403 });
  if (!code || !/^\d+$/.test(waba_id || '') || !/^\d+$/.test(phone_number_id || '')) {
    return Response.json({ ok: false, error: 'Faltan datos del alta' }, { status: 400 });
  }

  const pasos = {};
  try {
    // 1) Canjear el código por el token del negocio.
    const q = new URLSearchParams({ client_id: process.env.META_APP_ID, client_secret: process.env.APP_SECRET, code });
    const rt = await fetch(`${GRAPH}/oauth/access_token?${q}`);
    const tok = await rt.json();
    if (!rt.ok || !tok.access_token) throw new Error('No se pudo canjear el código: ' + JSON.stringify(tok.error || tok).slice(0, 200));
    const token = tok.access_token;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    pasos.token = 'ok';

    // 2) Suscribir nuestra app a su cuenta de WhatsApp (para recibir sus mensajes en el webhook).
    const rs = await fetch(`${GRAPH}/${waba_id}/subscribed_apps`, { method: 'POST', headers: H });
    pasos.suscripcion = rs.ok ? 'ok' : `error ${rs.status}`;

    // 3) Coexistencia: sincronizar contactos e historial de la app (Meta lo pide en las primeras 24 h).
    for (const sync_type of ['smb_app_state_sync', 'history']) {
      const r = await fetch(`${GRAPH}/${phone_number_id}/smb_app_data`, {
        method: 'POST', headers: H, body: JSON.stringify({ messaging_product: 'whatsapp', sync_type }),
      });
      pasos[sync_type] = r.ok ? 'ok' : `error ${r.status}`;
    }

    // 4) Guardar credenciales y crear el negocio (inactivo hasta cargar servicios, horario y calendario).
    const { url } = SB();
    const rc = await fetch(`${url}/rest/v1/negocios_credenciales?on_conflict=phone_number_id`, {
      method: 'POST', headers: sbHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ phone_number_id, waba_id, token }),
    });
    if (!rc.ok) throw new Error('No se pudieron guardar las credenciales: ' + (await rc.text()).slice(0, 200));
    await fetch(`${url}/rest/v1/negocios?on_conflict=phone_number_id`, {
      method: 'POST', headers: sbHeaders({ Prefer: 'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify({ phone_number_id, activo: false, config: { nombre: nombre || 'Negocio nuevo', servicios: [], equipo: [] } }),
    });
    pasos.guardado = 'ok';

    await alertar(phone_number_id, 'Alta de negocio nuevo', `${nombre || 'sin nombre'} (${phone_number_id}) ${JSON.stringify(pasos)}`);
    return Response.json({ ok: true, pasos });
  } catch (e) {
    await alertar(phone_number_id, 'Falla en un alta', `${nombre || ''}: ${e.message}`);
    return Response.json({ ok: false, error: 'No se pudo completar el alta. Ya nos llegó el aviso y te contactamos.', pasos }, { status: 500 });
  }
}
