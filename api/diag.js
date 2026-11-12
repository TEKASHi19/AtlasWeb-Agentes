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
  if (url.searchParams.get('plantillas') === '1') {
    const crear = body => fetch(`${GRAPH}/${waba}/message_templates`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(j);
    out.plantilla_cita = await crear({
      name: 'nueva_cita_agendada', language: 'es_MX', category: 'UTILITY',
      components: [{ type: 'BODY',
        text: 'Nueva cita agendada por WhatsApp: {{1}} reservó {{2}} para el {{3}}. Teléfono del cliente: {{4}}. Revisa tu calendario para ver los detalles.',
        example: { body_text: [['Alex', 'Corte de cabello', 'martes 17 de noviembre, 12:00', '+524441234567']] } }],
    });
    out.plantilla_atencion = await crear({
      name: 'cliente_necesita_atencion', language: 'es_MX', category: 'UTILITY',
      components: [{ type: 'BODY',
        text: 'Un cliente necesita atención en WhatsApp. Teléfono: {{1}}. Motivo: {{2}}. Respóndele lo antes posible.',
        example: { body_text: [['+524441234567', 'Pregunta por un servicio que no está en la lista']] } }],
    });
  }
  if (url.searchParams.get('estado_plantillas') === '1') {
    out.plantillas = await j(await fetch(`${GRAPH}/${waba}/message_templates?fields=name,status,category,rejected_reason`, { headers: H }));
  }
  if (url.searchParams.get('cal') === '1') {
    out.google_activo = googleActivo();
    const f = url.searchParams.get('fecha') || new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    try { out.agenda = await consultarDisponibilidad({ fecha: f, servicio: 'Corte de cabello' }); }
    catch (e) { out.agenda_error = String(e.message || e).slice(0, 500); }
  }
  return Response.json(out);
}
