// Avisos al dueño del negocio (OWNER_PHONE, formato 52XXXXXXXXXX).
// Usa la plantilla aprobada (llega aunque la ventana de 24 h esté cerrada).
// Si la plantilla todavía no existe o no está aprobada, Meta lo rechaza al momento y mandamos texto normal.
// (Un texto fuera de la ventana NO falla al momento: Meta lo acepta y luego no lo entrega; por eso va primero la plantilla.)
import { enviarTexto, enviarPlantilla } from './whatsapp.js';
import { numerosEquipo } from './equipo.js';

const PLANTILLAS = {
  cita: 'nueva_cita_agendada',      // {{1}} nombre, {{2}} servicio, {{3}} fecha y hora, {{4}} teléfono
  atencion: 'cliente_necesita_atencion', // {{1}} teléfono, {{2}} motivo
};

export async function avisarDueno(phoneId, tipo, datos) {
  const equipo = numerosEquipo();
  if (!equipo.length) return { ok: false, motivo: 'Sin OWNER_PHONE' };
  const resultados = await Promise.all(equipo.map(n => avisarA(phoneId, n, tipo, datos)));
  return { ok: resultados.some(r => r.ok), resultados };
}

async function avisarA(phoneId, dueno, tipo, datos) {

  const textos = {
    cita: `📅 Nueva cita agendada por WhatsApp\n${datos.nombre} reservó ${datos.servicio}\n${datos.cuando}\nTel: +${datos.telefono}`,
    atencion: `🙋 Un cliente necesita atención\nTel: +${datos.telefono}\nMotivo: ${datos.motivo}`,
    cancelacion: `❌ Cita cancelada por el cliente\n${datos.servicio}, ${datos.cuando}\nTel: +${datos.telefono}`,
    cambio: `🔁 Cita cambiada por el cliente\n${datos.servicio}\nAntes: ${datos.antes}\nAhora: ${datos.cuando}\nTel: +${datos.telefono}`,
  };
  const texto = textos[tipo];
  const params = tipo === 'cita'
    ? [datos.nombre, datos.servicio, datos.cuando, '+' + datos.telefono]
    : ['+' + datos.telefono, datos.motivo];

  if (!PLANTILLAS[tipo]) {
    // Sin plantilla para este tipo: solo texto (llega si el dueño escribió al número en las últimas 24 h).
    try { await enviarTexto(phoneId, dueno, texto); return { ok: true, via: 'texto' }; }
    catch (e) { console.error('No se pudo avisar al dueño:', e.message.slice(0, 300)); return { ok: false }; }
  }
  try {
    await enviarPlantilla(phoneId, dueno, PLANTILLAS[tipo], params);
    return { ok: true, via: 'plantilla' };
  } catch (e) {
    console.log('Plantilla no disponible, mando texto:', e.message.slice(0, 200));
    try {
      await enviarTexto(phoneId, dueno, texto);
      return { ok: true, via: 'texto' };
    } catch (e2) {
      console.error('No se pudo avisar al dueño:', e2.message.slice(0, 300));
      return { ok: false };
    }
  }
}
