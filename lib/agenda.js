// Lógica de citas: horarios libres y agendar. México no tiene horario de verano desde 2022 (UTC-6 fijo).
import { negocio } from './negocio.js';
import { ocupados, crearEvento } from './google.js';

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

export async function consultarDisponibilidad({ fecha, servicio }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return { ok: false, error: 'Fecha inválida, usa AAAA-MM-DD.' };
  const s = buscarServicio(servicio);
  if (!s) return { ok: false, error: 'Servicio no encontrado.', servicios: negocio.servicios.map(x => x.nombre) };
  const dia = aFecha(fecha, '12:00').getUTCDay();
  const horario = negocio.horarioSemanal[dia];
  if (!horario) return { ok: true, fecha, servicio: s.nombre, cerrado: true, horarios: [] };

  const abre = aFecha(fecha, horario[0]), cierra = aFecha(fecha, horario[1]);
  const busy = await ocupados(abre.toISOString(), cierra.toISOString());
  const minimo = Date.now() + ANTICIPACION_MIN * 60_000;
  const libres = [];
  for (let t = abre.getTime(); t + s.minutos * 60_000 <= cierra.getTime(); t += PASO_MIN * 60_000) {
    const ini = t, fin = t + s.minutos * 60_000;
    if (ini < minimo) continue;
    if (busy.some(b => ini < b.fin.getTime() && fin > b.inicio.getTime())) continue;
    libres.push(hhmm(new Date(ini)));
  }
  return { ok: true, fecha, servicio: s.nombre, duracion_min: s.minutos, horarios: libres };
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
  });
  return { ok: true, fecha, hora, servicio: s.nombre, nombre };
}

export const herramientas = [
  {
    name: 'consultar_disponibilidad',
    description: 'Regresa los horarios libres para un servicio en una fecha. Úsala antes de ofrecer horarios.',
    input_schema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha en formato AAAA-MM-DD' },
        servicio: { type: 'string', description: 'Nombre del servicio, tal como aparece en la lista' },
      },
      required: ['fecha', 'servicio'],
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

export async function ejecutarHerramienta(nombre, input, telefono) {
  try {
    if (nombre === 'consultar_disponibilidad') return await consultarDisponibilidad(input);
    if (nombre === 'agendar_cita') return await agendarCita(input, telefono);
    return { ok: false, error: 'Herramienta desconocida' };
  } catch (e) {
    console.error('Error en herramienta', nombre, e);
    return { ok: false, error: 'No pude revisar la agenda en este momento.' };
  }
}
