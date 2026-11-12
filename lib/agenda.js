// Lógica de citas: horarios libres y agendar. México no tiene horario de verano desde 2022 (UTC-6 fijo).
import { getNegocio } from './config.js';
import { listarEventos, crearEvento, eventosDeCliente, borrarEvento, moverEvento } from './google.js';
import { tramosOcupados, cabe, diaBloqueado } from './capacidad.js';
import { avisarDueno } from './avisos.js';
import { actualizarCliente } from './memoria.js';

const TZ = '-06:00';
const PASO_MIN = () => getNegocio().intervaloMin || 30; // cada cuánto se ofrecen horarios
const ANTICIPACION_MIN = 60; // no agendar con menos de 1 h de anticipación

const aFecha = (fecha, hora) => new Date(`${fecha}T${hora}:00${TZ}`);
const a12 = h => { const [H, M] = h.split(':').map(Number); return `${((H + 11) % 12) + 1}:${String(M).padStart(2, '0')} ${H < 12 ? 'a. m.' : 'p. m.'}`; };
// Junta horarios seguidos en rangos legibles: "de 10:00 a. m. a 12:00 p. m. y de 1:00 p. m. a 7:00 p. m."
function resumenHorarios(horarios, paso) {
  if (!horarios.length) return 'sin horarios libres';
  const min = h => { const [H, M] = h.split(':').map(Number); return H * 60 + M; };
  const rangos = [];
  let ini = horarios[0], prev = horarios[0];
  for (const h of horarios.slice(1)) {
    if (min(h) - min(prev) !== paso) { rangos.push([ini, prev]); ini = h; }
    prev = h;
  }
  rangos.push([ini, prev]);
  const txt = rangos.map(([a, b]) => (a === b ? `a las ${a12(a)}` : `de ${a12(a)} a ${a12(b)}`));
  const cada = paso === 30 ? 'cada media hora' : paso === 60 ? 'cada hora' : `cada ${paso} minutos`;
  return (txt.length > 1 ? txt.slice(0, -1).join(', ') + ' y ' + txt.at(-1) : txt[0]) + ` (hora de inicio, ${cada})`;
}
const hhmm = d => d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false });

function buscarServicio(nombre) {
  const n = (nombre || '').toLowerCase().trim();
  if (!n) return null;
  return getNegocio().servicios.find(s => s.nombre.toLowerCase() === n)
    || getNegocio().servicios.find(s => s.nombre.toLowerCase().includes(n) || n.includes(s.nombre.toLowerCase()));
}

const sumarDia = f => { const d = new Date(`${f}T12:00:00${TZ}`); d.setUTCDate(d.getUTCDate() + 1); return d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); };

// Lee los eventos del día y los clasifica: bloqueo (día u horas cerradas), cita (con sus tramos) o evento manual.
function parsearEvento(e) {
  const todoElDia = Boolean(e.start.date);
  const ini = todoElDia ? new Date(`${e.start.date}T00:00:00${TZ}`).getTime() : new Date(e.start.dateTime).getTime();
  const fin = todoElDia ? new Date(`${e.end.date}T00:00:00${TZ}`).getTime() : new Date(e.end.dateTime).getTime();
  const priv = e.extendedProperties?.private || {};
  const titulo = e.summary || '';
  const esBloqueo = priv.tipo === 'bloqueo' || todoElDia || /cerrad|bloque|vacacion|no hay servicio/i.test(titulo);
  let tramos = null;
  try { if (priv.tramos) tramos = JSON.parse(priv.tramos); } catch { tramos = null; }
  if (!tramos) {
    const srv = buscarServicio(titulo.split(' — ')[0]);
    if (srv?.tramos) tramos = tramosOcupados(srv).ocupados;
  }
  const esCita = priv.telefono !== undefined || titulo.includes(' — ');
  return { id: e.id, ini, fin, tipo: esBloqueo ? 'bloqueo' : (esCita ? 'cita' : 'manual'), tramos };
}

async function eventosDelDia(fecha) {
  const evs = await listarEventos(`${fecha}T00:00:00${TZ}`, `${sumarDia(fecha)}T00:00:00${TZ}`);
  return evs.filter(e => e.transparency !== 'transparent').map(parsearEvento);
}

const servicioMasCorto = () => getNegocio().servicios.filter(x => !x.tramos).reduce((a, b) => (a.minutos <= b.minutos ? a : b));

export async function consultarDisponibilidad({ fecha, servicio }, excluirId = null, { sinAnticipacion = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'Fecha inválida, usa AAAA-MM-DD.' };
  // Sin servicio: revisamos con el servicio más corto para saber si el día está abierto y qué hay libre.
  const s = servicio ? buscarServicio(servicio) : { ...servicioMasCorto(), nombre: null };
  if (!s) return { ok: false, error: 'Servicio no encontrado.', servicios: getNegocio().servicios.map(x => x.nombre) };
  const dia = aFecha(fecha, '12:00').getUTCDay();
  const horario = getNegocio().horarioSemanal[dia];
  if (!horario) return { ok: true, fecha, servicio: s.nombre, cerrado: true, nota: 'Ese día no hay servicio.', horarios: [] };

  const abre = aFecha(fecha, horario[0]).getTime(), cierra = aFecha(fecha, horario[1]).getTime();
  const eventos = (await eventosDelDia(fecha)).filter(e => e.id !== excluirId);
  if (diaBloqueado(eventos, abre, cierra)) return { ok: true, fecha, servicio: s.nombre, cerrado: true, nota: 'Ese día no hay servicio.', horarios: [] };

  const minimo = sinAnticipacion ? Date.now() : Date.now() + ANTICIPACION_MIN * 60_000;
  const opciones = { servicio: s, eventos, capacidad: getNegocio().capacidad || 1, margenMin: getNegocio().margenMin || 0, cierre: cierra };
  const libres = [];
  for (let t = abre; t < cierra; t += PASO_MIN() * 60_000) {
    if (t < minimo) continue;
    if (cabe({ ...opciones, inicio: t })) libres.push(hhmm(new Date(t)));
  }
  return {
    ok: true, fecha, servicio: s.nombre, duracion_min: s.minutos, horarios: libres,
    resumen: resumenHorarios(libres, PASO_MIN()),
    ...(s.nombre ? {} : { nota: 'Horarios aproximados sin saber el servicio; confirma con el servicio antes de agendar.' }),
  };
}

async function crearCita({ fecha, hora, s, nombre, telefono, origen }) {
  const { ocupados, total } = tramosOcupados(s);
  const fin = new Date(aFecha(fecha, hora).getTime() + total * 60_000);
  await crearEvento({
    resumen: `${s.nombre} — ${nombre}`,
    descripcion: `${origen}\nCliente: ${nombre}${telefono ? `\nTeléfono: +${telefono}` : ''}`,
    inicioISO: `${fecha}T${hora}:00${TZ}`,
    finISO: `${fecha}T${hhmm(fin)}:00${TZ}`,
    telefono,
    tramos: s.tramos ? ocupados : null,
  });
}

export async function agendarCita({ fecha, hora, servicio, nombre }, telefono) {
  if (!nombre) return { ok: false, error: 'Falta el nombre del cliente.' };
  const disp = await consultarDisponibilidad({ fecha, servicio });
  if (!disp.ok) return disp;
  if (!disp.horarios.includes(hora)) return { ok: false, error: 'Ese horario ya no está disponible.', horarios: disp.horarios };
  const s = buscarServicio(servicio);
  await crearCita({ fecha, hora, s, nombre, telefono, origen: 'Agendado por el cliente por WhatsApp.' });
  return { ok: true, fecha, hora, servicio: s.nombre, nombre };
}

// ¿Cabe un servicio exactamente a esta hora (cualquier minuto)? Para el equipo.
async function cabeExacto(fecha, hora, s) {
  const dia = aFecha(fecha, '12:00').getUTCDay();
  const horario = getNegocio().horarioSemanal[dia];
  if (!horario) return false;
  const abre = aFecha(fecha, horario[0]).getTime(), cierra = aFecha(fecha, horario[1]).getTime();
  const inicio = aFecha(fecha, hora).getTime();
  if (inicio < abre) return false;
  const eventos = await eventosDelDia(fecha);
  if (diaBloqueado(eventos, abre, cierra)) return false;
  return cabe({ inicio, servicio: s, eventos, capacidad: getNegocio().capacidad || 1, margenMin: getNegocio().margenMin || 0, cierre: cierra });
}

// El equipo (dueña o ayudante) agenda citas que llegaron por llamada o en persona.
export async function agendarPorEquipo({ fecha, hora, servicio, nombre, telefono, forzar = false }) {
  if (!nombre) return { ok: false, error: 'Falta el nombre del cliente.' };
  const s = buscarServicio(servicio);
  if (!s) return { ok: false, error: 'Servicio no encontrado.', servicios: getNegocio().servicios.map(x => x.nombre) };
  if (!/^\d{2}:\d{2}$/.test(hora || '')) return { ok: false, error: 'Hora inválida, usa HH:MM (24 h).' };
  const disp = await consultarDisponibilidad({ fecha, servicio: s.nombre }, null, { sinAnticipacion: true });
  if (!disp.ok) return disp;
  const libre = disp.horarios.includes(hora) || await cabeExacto(fecha, hora, s);
  if (!libre && !forzar) {
    return { ok: false, error: disp.cerrado ? 'Ese día está cerrado.' : 'En ese horario ya no hay lugar.', horarios: disp.horarios, puede_forzar: true };
  }
  const tel = telefono ? String(telefono).replace(/\D/g, '').replace(/^(\d{10})$/, '52$1') : '';
  await crearCita({ fecha, hora, s, nombre, telefono: tel, origen: `Agendado por el equipo${libre ? '' : ' (sobrecupo)'}.` });
  return { ok: true, fecha, hora, servicio: s.nombre, nombre, sobrecupo: !libre };
}


// ---- Consultar, cancelar y cambiar citas del propio cliente ----
const fechaDe = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // AAAA-MM-DD


export async function misCitas(telefono) {
  const desde = new Date().toISOString();
  const hasta = new Date(Date.now() + 90 * 86400000).toISOString();
  const evs = await eventosDeCliente(telefono, desde, hasta);
  return {
    ok: true,
    citas: evs.map(e => {
      const ini = new Date(e.start.dateTime);
      return { id: e.id, servicio: (e.summary || '').split(' — ')[0], fecha: fechaDe(ini), hora: hhmm(ini) };
    }),
  };
}

async function citaDelCliente(id, telefono) {
  const { citas } = await misCitas(telefono);
  return citas.find(c => c.id === id) || null;
}

export async function cancelarCita({ id }, telefono) {
  const cita = await citaDelCliente(id, telefono);
  if (!cita) return { ok: false, error: 'No encontré esa cita entre las citas de este cliente.' };
  await borrarEvento(id);
  return { ok: true, cancelada: cita };
}

export async function cambiarCita({ id, fecha, hora }, telefono) {
  const cita = await citaDelCliente(id, telefono);
  if (!cita) return { ok: false, error: 'No encontré esa cita entre las citas de este cliente.' };
  const s = buscarServicio(cita.servicio);
  if (!s) return { ok: false, error: 'No reconozco el servicio de esa cita.' };
  const disp = await consultarDisponibilidad({ fecha, servicio: s.nombre }, id);
  if (!disp.ok) return disp;
  if (!disp.horarios.includes(hora)) return { ok: false, error: 'Ese horario no está disponible.', horarios: disp.horarios };
  const fin = new Date(aFecha(fecha, hora).getTime() + tramosOcupados(s).total * 60_000);
  await moverEvento(id, `${fecha}T${hora}:00${TZ}`, `${fecha}T${hhmm(fin)}:00${TZ}`);
  return { ok: true, antes: { fecha: cita.fecha, hora: cita.hora }, ahora: { fecha, hora }, servicio: s.nombre };
}

export const herramientas = [
  {
    name: 'consultar_disponibilidad',
    description: 'Regresa si el negocio está abierto en una fecha y los horarios libres. Úsala en cuanto el cliente mencione un día, aunque todavía no sepas el servicio.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato AAAA-MM-DD' },
        servicio: { type: 'string', description: 'Nombre del servicio, tal como aparece en la lista. Opcional: si aún no lo sabes, omítelo para revisar si el día está abierto.' },
      },
      required: ['fecha'],
    },
  },
  {
    name: 'mis_citas',
    description: 'Lista las próximas citas agendadas de este cliente (se identifica por su número de WhatsApp). Úsala antes de cancelar o cambiar.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'cancelar_cita',
    description: 'Cancela una cita del cliente. Úsala solo después de que el cliente confirme explícitamente cuál cita quiere cancelar.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id de la cita, tal como lo regresó mis_citas' } },
      required: ['id'],
    },
  },
  {
    name: 'cambiar_cita',
    description: 'Mueve una cita del cliente a otra fecha y hora. Antes revisa horarios con consultar_disponibilidad y confirma con el cliente.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id de la cita, tal como lo regresó mis_citas' },
        fecha: { type: 'string', description: 'Nueva fecha AAAA-MM-DD' },
        hora: { type: 'string', description: 'Nueva hora HH:MM (24 h)' },
      },
      required: ['id', 'fecha', 'hora'],
    },
  },
  {
    name: 'recordar_cliente',
    description: 'Guarda en la ficha permanente del cliente su propio nombre y/o una preferencia duradera que él dijo. No guardes nombres de otras personas ni datos de una sola cita.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre con el que el cliente se presentó a sí mismo' },
        nota: { type: 'string', description: 'Preferencia duradera, breve' },
      },
    },
  },
  {
    name: 'avisar_humano',
    description: 'Avisa al dueño del negocio que este cliente necesita atención de una persona: preguntas que no puedes responder con la información que tienes, quejas, casos especiales, o si el cliente pide hablar con alguien.',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Resumen breve de lo que necesita el cliente' } },
      required: ['motivo'],
    },
  },
  {
    name: 'agendar_cita',
    description: 'Agenda la cita en el calendario. Solo cuando el cliente ya eligió fecha, hora y servicio y dio su nombre.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'AAAA-MM-DD' },
        hora: { type: 'string', description: 'HH:MM en 24 horas, uno de los horarios que regresó consultar_disponibilidad' },
        servicio: { type: 'string' },
        nombre: { type: 'string', description: 'Nombre del cliente' },
      },
      required: ['fecha', 'hora', 'servicio', 'nombre'],
    },
  },
];

const fechaLegible = (fecha, hora) =>
  new Date(`${fecha}T${hora}:00${TZ}`).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

export async function ejecutarHerramienta(nombre, input, telefono, phoneId) {
  try {
    if (nombre === 'consultar_disponibilidad') return await consultarDisponibilidad(input);
    if (nombre === 'agendar_cita') {
      const res = await agendarCita(input, telefono);
      if (res.ok) {
        await avisarDueno(phoneId, 'cita', {
          nombre: res.nombre, servicio: res.servicio, cuando: fechaLegible(res.fecha, res.hora), telefono,
        });
      }
      return res;
    }
    if (nombre === 'mis_citas') return await misCitas(telefono);
    if (nombre === 'recordar_cliente') {
      const ok = await actualizarCliente({ phoneId, telefono, nombre: input.nombre, nota: input.nota });
      return { ok };
    }
    if (nombre === 'cancelar_cita') {
      const res = await cancelarCita(input, telefono);
      if (res.ok) await avisarDueno(phoneId, 'cancelacion', {
        servicio: res.cancelada.servicio, cuando: fechaLegible(res.cancelada.fecha, res.cancelada.hora), telefono,
      });
      return res;
    }
    if (nombre === 'cambiar_cita') {
      const res = await cambiarCita(input, telefono);
      if (res.ok) await avisarDueno(phoneId, 'cambio', {
        servicio: res.servicio, antes: fechaLegible(res.antes.fecha, res.antes.hora), cuando: fechaLegible(res.ahora.fecha, res.ahora.hora), telefono,
      });
      return res;
    }
    if (nombre === 'avisar_humano') {
      const r = await avisarDueno(phoneId, 'atencion', { telefono, motivo: input.motivo || 'Sin detalle' });
      return r.ok ? { ok: true, mensaje: 'El equipo ya fue avisado.' } : { ok: false, error: 'No se pudo avisar, pide al cliente que espere.' };
    }
    return { ok: false, error: 'Herramienta desconocida' };
  } catch (e) {
    console.error('Error en herramienta', nombre, e);
    return { ok: false, error: 'No pude revisar la agenda en este momento.' };
  }
}
