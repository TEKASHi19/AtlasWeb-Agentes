// Recordatorios automáticos: Vercel lo ejecuta una vez al día (ver vercel.json) y avisa a cada cliente
// que tiene cita mañana. Usa la plantilla aprobada "recordatorio_cita"; marca el evento para no repetir.
import { listarNegocios, conNegocio, getNegocio } from '../lib/config.js';
import { listarEventos, marcarEvento, googleActivo } from '../lib/google.js';
import { enviarPlantilla, enviarTexto } from '../lib/whatsapp.js';
import { guardarMensaje } from '../lib/memoria.js';
import { alertar } from '../lib/alertas.js';

const TZ = '-06:00';
const fechaDe = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const hora12 = d => d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit', hour12: true });

export async function GET(request) {
  const url = new URL(request.url);
  const auth = request.headers.get('authorization');
  const autorizado = (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`)
    || (process.env.VERIFY_TOKEN && url.searchParams.get('k') === process.env.VERIFY_TOKEN);
  if (!autorizado) return new Response('Forbidden', { status: 403 });

  const prueba = url.searchParams.get('prueba') === '1'; // solo lista, no envía
  const negocios = await listarNegocios();
  const resumen = [];
  for (const { phoneId, negocio } of negocios) {
    resumen.push(await conNegocio(negocio, phoneId, () => recordarNegocio(phoneId, prueba)));
  }
  return Response.json({ ok: true, prueba, resumen });
}

async function recordarNegocio(phoneId, prueba) {
  const n = getNegocio();
  if (!googleActivo()) return { negocio: n.nombre, error: 'sin calendario' };
  const manana = fechaDe(new Date(Date.now() + 86400000));
  const siguiente = fechaDe(new Date(Date.now() + 2 * 86400000));
  const eventos = await listarEventos(`${manana}T00:00:00${TZ}`, `${siguiente}T00:00:00${TZ}`);
  const resultado = { negocio: n.nombre, fecha: manana, enviados: 0, omitidos: 0, fallidos: 0 };

  for (const e of eventos) {
    const priv = e.extendedProperties?.private || {};
    const telefono = priv.telefono;
    if (!telefono || priv.recordatorio === '1' || !e.start?.dateTime) { resultado.omitidos++; continue; }
    const [servicio, nombre = ''] = (e.summary || '').split(' — ');
    const cuando = `a las ${hora12(new Date(e.start.dateTime))}`;
    if (prueba) { resultado.enviados++; continue; }
    try {
      try {
        await enviarPlantilla(phoneId, telefono, 'recordatorio_cita', [nombre || 'tu cita', servicio, cuando, n.nombre]);
      } catch {
        // Plantilla aún no aprobada: texto normal (solo llega si el cliente escribió en las últimas 24 h).
        await enviarTexto(phoneId, telefono, `Hola, te recordamos la cita de ${nombre} (${servicio}) mañana ${cuando} en ${n.nombre}. Si necesitas cambiarla o cancelarla, responde a este mensaje.`);
      }
      await marcarEvento(e.id, { recordatorio: '1' });
      await guardarMensaje({ phoneId, cliente: telefono, rol: 'assistant', contenido: `(Recordatorio automático) Cita de ${nombre} (${servicio}) mañana ${cuando}` });
      resultado.enviados++;
    } catch (err) {
      resultado.fallidos++;
      console.error('Recordatorio fallido', err.message?.slice(0, 200));
    }
  }
  if (resultado.fallidos) await alertar(phoneId, 'Recordatorios con fallas', JSON.stringify(resultado));
  return resultado;
}
