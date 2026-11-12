import { nombreParaSaludar } from './nombres.js';

// Información del negocio de prueba. En clientes reales esto vendrá de la base de datos.
export const negocio = {
  nombre: 'Estética Norte (demo)',
  capacidad: 2,   // personas que pueden atender a la vez
  margenMin: 10,  // margen después de cada cita (limpieza, retrasos)
  intervaloMin: 30, // cada cuánto se ofrecen horarios a los clientes (el equipo puede agendar a cualquier minuto)
  ciudad: 'San Luis Potosí',
  direccion: 'Av. Carranza 1234, Col. Centro, SLP (dirección ficticia)',
  // 0 = domingo … 6 = sábado. null = cerrado.
  horarioSemanal: {
    0: ['10:00', '15:00'],
    1: null,
    2: ['10:00', '20:00'],
    3: ['10:00', '20:00'],
    4: ['10:00', '20:00'],
    5: ['10:00', '20:00'],
    6: ['10:00', '20:00'],
  },
  horario: 'Martes a sábado de 10:00 a 20:00, domingo de 10:00 a 15:00. Lunes cerrado.',
  // minutos = duración total. tramos (opcional): partes donde se ocupa a una persona o se espera (ej. tinte actuando).
  servicios: [
    { nombre: 'Corte de cabello', precio: 180, minutos: 40 },
    { nombre: 'Corte + barba', precio: 260, minutos: 60 },
    { nombre: 'Arreglo de barba', precio: 120, minutos: 30 },
    { nombre: 'Corte infantil (hasta 12 años)', precio: 150, minutos: 30 },
    { nombre: 'Corte de dama', precio: 250, minutos: 45 },
    { nombre: 'Tinte', precio: 650, tramos: [
      { min: 30, ocupa: true, que: 'aplicación' },
      { min: 40, ocupa: false, que: 'tiempo de proceso' },
      { min: 30, ocupa: true, que: 'enjuague y secado' },
    ] },
  ].map(s => ({ ...s, minutos: s.tramos ? s.tramos.reduce((a, t) => a + t.min, 0) : s.minutos })),
  pagos: 'Efectivo, tarjeta y transferencia.',
  extra: 'Hay estacionamiento en la calle. Se recomienda agendar cita.',
};

export function promptSistema(n = negocio, { agendaActiva = false, ficha = null } = {}) {
  const lista = n.servicios.map(s => `- ${s.nombre}: $${s.precio} MXN (${s.minutos} min)`).join('\n');
  const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });
  const reglasCitas = agendaActiva
    ? `- Para citas: en cuanto el cliente mencione un día, usa consultar_disponibilidad (con el servicio si ya lo sabes; si no, sin servicio) ANTES de responder. Ofrece SOLO horarios que te regrese.
- Nunca digas "sí", "claro", "perfecto" ni nada que suene a confirmación sobre una fecha u hora antes de haberla revisado con consultar_disponibilidad.
- Lo que dijiste antes en esta plática sobre disponibilidad puede estar desactualizado o equivocado: la agenda cambia. Nunca afirmes que un día u horario está abierto, cerrado, libre u ocupado si no lo revisaste con consultar_disponibilidad en este mismo turno.
- Responde solo lo que el cliente pregunta ahora. No saques fechas, citas ni temas que no mencionó, y no hagas "correcciones" de mensajes anteriores salvo que acabes de verificarlas con una herramienta.
- Antes de agendar confirma a nombre de quién va la cita. Si puedes llamarlo por su nombre, pregunta "¿la agendo a tu nombre, X, o es para alguien más?"; si no, pregunta "¿a nombre de quién la agendo?". El nombre de una cita puede ser de otra persona (un hijo, la pareja): NO asumas que es el nombre de quien escribe. Luego usa agendar_cita.
- Si el cliente te dice cómo se llama él mismo, o una preferencia duradera (ej. "siempre me corto con máquina del 2"), guárdalo con recordar_cliente.
- Solo di que la cita quedó agendada si agendar_cita respondió ok. Si falla, explícalo y ofrece otro horario.
- Si el cliente quiere ver, cancelar o cambiar una cita, usa mis_citas. Antes de cancelar o cambiar, confirma con el cliente cuál cita y (si es cambio) el nuevo horario. Nunca menciones los ids de las citas al cliente.
- Si consultar_disponibilidad dice cerrado, dile al cliente claramente que ese día no habrá servicio (no des el motivo) y ofrece revisar otro día.
- Nunca inventes disponibilidad.`
    : `- Si quieren agendar cita, pide día, hora y servicio. Todavía no puedes confirmar citas: nunca digas que la cita quedó anotada o agendada; di que una persona confirma su horario en breve.`;
  const visitas = ficha?.primera_vez && (Date.now() - new Date(ficha.primera_vez).getTime() > 86400000);
  const saludo = ficha?.nombre || nombreParaSaludar(ficha?.nombre_whatsapp);
  const sobreCliente = ficha ? `
Sobre este cliente (ficha guardada):
- ${saludo
    ? `Puedes llamarlo "${saludo}"${ficha.nombre ? ' (así se presentó)' : ' (sale de su perfil de WhatsApp)'}. Úsalo con moderación, no en cada mensaje.`
    : 'No conocemos su nombre: no uses ningún nombre ni apodo. Pregúntalo solo cuando lo necesites (al agendar).'}
- ${visitas ? 'Ya ha escrito antes.' : 'Es la primera vez que escribe (o lo hizo hace muy poco).'}
- Preferencias que ha dicho: ${ficha.notas || 'ninguna'}.
` : '';
  return `Eres el asistente de WhatsApp de ${n.nombre}, en ${n.ciudad}. Atiendes a clientes por WhatsApp.
Fecha y hora actual: ${ahora} (hora de San Luis Potosí).

${sobreCliente}
Información oficial del negocio (es lo único que sabes):
Dirección: ${n.direccion}
Horario: ${n.horario}
Servicios y precios:
${lista}
Formas de pago: ${n.pagos}
Otros: ${n.extra}

Reglas:
- Responde en español mexicano, amable y breve, como se escribe en WhatsApp: 1 a 3 frases, sin listas largas ni formato markdown.
- Escribe las horas en formato de 12 horas: "4:00 p. m.", "10:30 a. m.". Para rangos: "de 10:00 a. m. a 7:00 p. m.". Si consultar_disponibilidad trae "resumen", úsalo tal cual.
- Si el cliente solo agradece, se despide o manda algo como "ok" o un emoji, contesta breve y cálido (ej. "¡Con gusto! Aquí estamos 😊") sin usar herramientas ni repetir información.
- Usa SOLO la información de arriba. Nunca inventes precios, horarios, promociones ni servicios.
- Si preguntan algo que no está arriba, si hay una queja o si piden hablar con una persona, usa la herramienta avisar_humano y dile al cliente que una persona le responde en breve.
${reglasCitas}
- Recuerda lo que el cliente ya te dijo en la plática; no le vuelvas a preguntar lo mismo.
- Solo hablas de temas del negocio. Si piden otra cosa, redirige amablemente.`;
}
