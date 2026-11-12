// Lógica de citas: horarios libres y agendar. México no tiene horario de verano desde 2022 (UTC-6 fijo).
import { negocio } from './negocio.js';
import { ocupados, crearEvento, eventosDeCliente, borrarEvento, moverEvento } from './google.js';
import { avisarDueno } from './avisos.js';
import { actualizarCliente } from './memoria.js';

const TZ = '-06:00';
const PASO_MIN = 30;        // cada cuánto se ofrecen horarios
const ANTICIPACION_MIN = 60; // no agendar con menos de 1 h de anticipación

const aFecha = (fecha, hora) => new Date(`${fecha}T${hora}:00${TZ}`);
const hhmm = d => d.toLocaleTimeString('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false });

function buscarServicio(nombre) {
  const n = (nombre || '').toLowerCase();
  return negocio.servicios.find(s => s.nombre.toLowerCase() === n)
    || negocio.servicios.find(s => s.nombre.toLowerCase().includes(n) || n.includes(s.nombre.toLowerCase()));
}

export async function consultarDisponibilidad({ fecha, servicio }, excluir = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'Fecha inválida, usa AAAA-MM-DD.' };
  // Sin servicio: revisamos con la duración más corta para saber si el día está abierto y qué hay libre.
  const s = servicio
    ? buscarServicio(servicio)
    : { nombre: null, minutos: Math.min(...negocio.servicios.map(x => x.minutos)) };
  if (!s) return { ok: false, error: 'Servicio no encontrado.', servicios: negocio.servicios.map(x => x.nombre) };
  const dia = aFecha(fecha, '12:00').getUTCDay();
  const horario = negocio.horarioSemanal[dia];
  if (!horario) return { ok: true, fecha, servicio: s.nombre, cerrado: true, horarios: [] };

  const abre = aFecha(fecha, horario[0]), cierra = aFecha(fecha, horario[1]);
  let busy = await ocupados(abre.toISOString(), cierra.toISOString());
  if (excluir) busy = busy.filter(b => !(b.inicio.getTime() === excluir.inicio && b.fin.getTime() === excluir.fin));
  const minimo = Date.now() + ANTICIPACION_MIN * 60_000;
  const libres = [];
  for (let t = abre.getTime(); t + s.minutos * 60_000 <= cierra.getTime(); t += PASO_MIN * 60_000) {
    const ini = t, fin = t + s.minutos * 60_000;
    if (ini < minimo) continue;
    if (busy.some(b => ini < b.fin.getTime() && fin > b.inicio.getTime())) continue;
    libres.push(hhmm(new Date(ini)));
  }
  const diaBloqueado = busy.some(b => b.inicio.getTime() <= abre.getTime() && b.fin.getTime() >= cierra.getTime());
  if (diaBloqueado) return { ok: true, fecha, servicio: s.nombre, cerrado: true, nota: 'Ese día no hay servicio.', horarios: [] };
  return {
    ok: true, fecha, servicio: s.nombre, duracion_min: s.minutos, horarios: libres,
    ...(s.nombre ? {} : { nota: 'Horarios aproximados sin saber el servicio; confirma con el servicio antes de agendar.' }),
  };
}

export async function agendarCita({ fecha, hora, servicio, nombre }, telefono) {
  if (!nombre) return { ok: false, error: 'Falta el nombre del cliente.' };
  const disp = await consultarDisponibilidad({ fecha, servicio });
  if (!disp.ok) return disp;
  if (!disp.horarios.includes(hora)) return { ok: false, error: 'Ese horario ya no está disponible.', horarios: disp.horarios };
  const s = buscarServicio(servicio);
  const inicio = aFecha(fecha, hora), fin = new Date(inicio.getTime() + s.minutos * 60_000);
  await crearEvento({
    resumen: `${s.nombre} — ${nombre}`,
    descripcion: `Agendado por WhatsApp.\nCliente: ${nombre}\nTeléfono: +${telefono}`,
    inicioISO: `${fecha}T${hora}:00${TZ}`,
    finISO: `${fecha}T${hhmm(fin)}:00${TZ}`,
    telefono,
  });
  return { ok: true, fecha, hora, servicio: s.nombre, nombre };
}


// ---- Consultar, cancelar y cambiar citas del propio cliente ----
const fechaDe = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // AAAA-MM-DD

function servicioDeEvento(e) {
  const nombre = (e.summary || '').split(' — ')[0];
  return buscarServicio(nombre);
}

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
  const iniActual = aFecha(cita.fecha, cita.hora).getTime();
  const disp = await consultarDisponibilidad({ fecha, servicio: s.nombre }, { inicio: iniActual, fin: iniActual + s.minutos * 60_000 });
  if (!disp.ok) return disp;
  if (!disp.horarios.includes(hora)) return { ok: false, error: 'Ese horario no está disponible.', horarios: disp.horarios };
  const fin = new Date(aFecha(fecha, hora).getTime() + s.minutos * 60_000);
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
