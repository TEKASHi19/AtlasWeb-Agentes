// Diagnóstico temporal. Protegido con VERIFY_TOKEN. Se borra cuando todo funcione.
import { googleActivo } from '../lib/google.js';
import { consultarDisponibilidad } from '../lib/agenda.js';
const GRAPH = 'https://graph.facebook.com/v24.0';

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('k') !== process.env.VERIFY_TOKEN) return new Response('Forbidden', { status: 403 });
  const H = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const waba = process.env.WABA_ID, phone = process.env.PHONE_NUMBER_ID;
  const out = {};
  const j = async r => ({ status: r.status, body: await r.json().catch(() => null) });
  out.numero = await j(await fetch(`${GRAPH}/${phone}?fields=display_phone_number,verified_name,quality_rating`, { headers: H }));
  if (url.searchParams.get('subscribe') === '1') {
    out.suscribir = await j(await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: 'POST', headers: H }));
  }
  out.apps_suscritas = await j(await fetch(`${GRAPH}/${waba}/subscribed_apps`, { headers: H }));
  if (url.searchParams.get('cal') === '1') {
    out.google_activo = googleActivo();
    const f = url.searchParams.get('fecha') || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    try { out.agenda = await consultarDisponibilidad({ fecha: f, servicio: 'Corte de cabello' }); }
    catch (e) { out.agenda_error = String(e.message || e).slice(0, 500); }
  }
  return Response.json(out);
}
