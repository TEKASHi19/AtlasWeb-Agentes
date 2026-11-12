// Modo dueño: el dueño administra su agenda escribiéndole al bot.
import { negocio } from './negocio.js';
import { crearBloqueo, listarEventos, borrarEvento } from './google.js';
import { consultarDisponibilidad, agendarPorEquipo } from './agenda.js';

const TZ = '-06:00';
const hhmm = d => d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false });
const fechaDe = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
const sumarDia = f => { const d = new Date(`${f}T12:00:00${TZ}`); d.setUTCDate(d.getUTCDate() + 1); return fechaDe(d); };
const restarDia = f => { const d = new Date(`${f}T12:00:00${TZ}`); d.setUTCDate(d.getUTCDate() - 1); return fechaDe(d); };
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(f || '');

export { normalizarTel, numerosEquipo, esDueno } from './equipo.js';

function describir(e) {
  const bloqueo = e.extendedProperties?.private?.tipo === 'bloqueo';
  const todoElDia = Boolean(e.start.date);
  const ini = todoElDia ? null : new Date(e.start.dateTime);
  const fin = todoElDia ? null : new Date(e.end.dateTime);
  const tel = e.extendedProperties?.private?.telefono || ((e.description || '').match(/\+(\d{10,15})/) || [])[1] || null;
  // Cita = la creó el bot (tiene teléfono del cliente). Lo demás lo agregó el dueño a mano en su calendario.
  return {
    id: e.id,
    tipo: bloqueo ? 'bloqueo' : (tel || (e.summary || '').includes(' — ') ? 'cita' : 'evento_manual'),
    titulo: e.summary || '(sin título)',
    fecha: todoElDia ? e.start.date : fechaDe(ini),
    hasta_fecha: todoElDia ? restarDia(e.end.date) : undefined, // inclusiva
    hora: todoElDia ? 'todo el día' : `${hhmm(ini)}-${hhmm(fin)}`,
    telefono_cliente: tel && !bloqueo ? '+' + tel : undefined,
  };
}

async function eventosEntre(desde, hastaInclusive) {
  return (await listarEventos(`${desde}T00:00:00${TZ}`, `${sumarDia(hastaInclusive)}T00:00:00${TZ}`)).map(describir);
}

export async function verAgenda({ desde, hasta }) {
  if (!esFecha(desde)) return { ok: false, error: 'Fecha inválida, usa AAAA-MM-DD.' };
  const h = esFecha(hasta) ? hasta : desde;
  return { ok: true, desde, hasta: h, eventos: await eventosEntre(desde, h) };
}

export async function bloquear({ desde, hasta, hora_inicio, hora_fin, motivo }) {
  if (!esFecha(desde)) return { ok: false, error: 'Fecha inválida, usa AAAA-MM-DD.' };
  const h = esFecha(hasta) ? hasta : desde;
  if (h < desde) return { ok: false, error: 'La fecha final es antes que la inicial.' };
  const porHoras = hora_inicio || hora_fin;
  if (porHoras && h !== desde) return { ok: false, error: 'Los bloqueos por horas son de un solo día.' };

  let rango;
  if (porHoras) {
    const dia = new Date(`${desde}T12:00:00${TZ}`).getUTCDay();
    const horario = negocio.horarioSemanal[dia] || ['00:00', '23:59'];
    const ini = hora_inicio || horario[0], fin = hora_fin || horario[1];
    if (fin <= ini) return { ok: false, error: 'La hora final debe ser después de la inicial.' };
    await crearBloqueo({ motivo, inicioISO: `${desde}T${ini}:00${TZ}`, finISO: `${desde}T${fin}:00${TZ}` });
    rango = { desde: `${desde}T${ini}:00${TZ}`, hasta: `${desde}T${fin}:00${TZ}` };
  } else {
    await crearBloqueo({ motivo, fechaInicio: desde, fechaFinExclusiva: sumarDia(h) });
    rango = { desde: `${desde}T00:00:00${TZ}`, hasta: `${sumarDia(h)}T00:00:00${TZ}` };
  }
  // Citas que ya estaban en ese rango: el dueño tiene que saberlo.
  const afectadas = (await listarEventos(rango.desde, rango.hasta))
    .map(describir)
    .filter(e => e.tipo === 'cita');
  return { ok: true, bloqueado: { desde, hasta: h, hora_inicio: hora_inicio || null, hora_fin: hora_fin || null }, citas_afectadas: afectadas };
}

export async function quitarBloqueo({ id }) {
  const hoy = fechaDe(new Date());
  const lejos = fechaDe(new Date(Date.now() + 365 * 86400000));
  const ev = (await eventosEntre(hoy, lejos)).find(e => e.id === id);
  if (!ev || ev.tipo !== 'bloqueo') return { ok: false, error: 'No encontré ese bloqueo.' };
  await borrarEvento(id);
  return { ok: true, quitado: ev };
}

export const herramientasDueno = [
  {
    name: 'ver_agenda',
    description: 'Muestra las citas y bloqueos entre dos fechas (incluye el teléfono de cada cliente).',
    input_schema: {
      type: 'object',
      properties: { desde: { type: 'string', description: 'AAAA-MM-DD' }, hasta: { type: 'string', description: 'AAAA-MM-DD (opcional, inclusiva)' } },
      required: ['desde'],
    },
  },
  {
    name: 'bloquear',
    description: 'Marca días u horas como no disponibles (el dueño no va a trabajar). Sin horas bloquea días completos; con horas bloquea solo ese rango de un día. Regresa las citas que ya estaban agendadas en ese rango.',
    input_schema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'AAAA-MM-DD' },
        hasta: { type: 'string', description: 'AAAA-MM-DD inclusiva (para varios días)' },
        hora_inicio: { type: 'string', description: 'HH:MM, solo si es por horas (vacío = desde que abre)' },
        hora_fin: { type: 'string', description: 'HH:MM, solo si es por horas (vacío = hasta que cierra)' },
        motivo: { type: 'string', description: 'Opcional, interno' },
      },
      required: ['desde'],
    },
  },
  {
    name: 'consultar_disponibilidad',
    description: 'Horarios libres para un servicio en una fecha (considera capacidad, tiempos de proceso y margen).',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'AAAA-MM-DD' }, servicio: { type: 'string' } },
      required: ['fecha'],
    },
  },
  {
    name: 'agendar_cita',
    description: 'Agenda una cita que llegó por llamada, en persona o por otro medio. Si el horario está lleno, regresa error con puede_forzar; solo usa forzar=true si el equipo lo pide explícitamente.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        hora: { type: 'string', description: 'HH:MM en 24 horas' },
        servicio: { type: 'string' },
        nombre: { type: 'string', description: 'Nombre de la clienta o cliente' },
        telefono: { type: 'string', description: 'Opcional, a 10 dígitos o con lada' },
        forzar: { type: 'boolean', description: 'Agendar aunque no haya lugar (sobrecupo)' },
      },
      required: ['fecha', 'hora', 'servicio', 'nombre'],
    },
  },
  {
    name: 'quitar_bloqueo',
    description: 'Elimina un bloqueo para que esos horarios vuelvan a estar disponibles. Usa antes ver_agenda para obtener el id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

export async function ejecutarHerramientaDueno(nombre, input) {
  try {
    if (nombre === 'ver_agenda') return await verAgenda(input);
    if (nombre === 'bloquear') return await bloquear(input);
    if (nombre === 'quitar_bloqueo') return await quitarBloqueo(input);
    if (nombre === 'consultar_disponibilidad') return await consultarDisponibilidad(input, null, { sinAnticipacion: true });
    if (nombre === 'agendar_cita') return await agendarPorEquipo(input);
    return { ok: false, error: 'Herramienta desconocida' };
  } catch (e) {
    console.error('Error en herramienta del dueño', nombre, e);
    return { ok: false, error: 'No pude acceder a la agenda en este momento.' };
  }
}

export function promptDueno(n = negocio) {
  const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });
  return `Eres el asistente interno de ${n.nombre}. Estás hablando con alguien del EQUIPO del negocio (la dueña o su ayudante), no con un cliente.
Fecha y hora actual: ${ahora} (hora de San Luis Potosí).
Horario normal: ${n.horario}
Servicios: ${n.servicios.map(s => `${s.nombre} (${s.minutos} min${s.tramos ? ', con tiempo de proceso en el que se puede atender a alguien más' : ''})`).join('; ')}.
Pueden atender hasta ${n.capacidad || 1} personas a la vez; se deja un margen de ${n.margenMin || 0} min después de cada cita.

Puedes ayudarle a:
- Ver su agenda con ver_agenda: 'cita' = la agendó un cliente por WhatsApp; 'bloqueo' = días u horas cerrados; 'evento_manual' = algo que el dueño puso a mano en su calendario (también ocupa ese horario).
- Bloquear días u horas en que no va a trabajar con bloquear. Interpreta fechas relativas ("el viernes", "del 20 al 23", "mañana después de las 2") usando la fecha actual.
- Quitar bloqueos con quitar_bloqueo (primero ver_agenda para encontrarlo).
- Agendar citas que llegaron por llamada o en persona con agendar_cita (ej. "agéndame a Lupita mañana a las 4, tinte"). Si no hay lugar, dilo y ofrece los horarios libres; agenda con sobrecupo solo si te lo piden explícitamente.
- Revisar horarios libres con consultar_disponibilidad.

Reglas:
- Antes de bloquear, confirma en una frase las fechas exactas con día de la semana (ej. "¿Bloqueo el viernes 20 de noviembre todo el día?"), salvo que el dueño ya haya sido totalmente claro y explícito.
- Si al bloquear hay citas afectadas, díselas claramente (servicio, hora y teléfono) y recuérdale que esas citas siguen en pie hasta que él contacte a los clientes.
- Responde breve, como en WhatsApp, sin markdown. No menciones ids.`;
}
