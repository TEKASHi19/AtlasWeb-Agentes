// Negocio de prueba. Los negocios reales viven en la tabla public.negocios (ver lib/config.js).
// Información del negocio de prueba. En clientes reales esto vendrá de la base de datos.
export const negocioDemo = {
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
  ],
  pagos: 'Efectivo, tarjeta y transferencia.',
  avisoPrivacidadUrl: 'https://atlasweb.com.mx/privacidad',
  extra: 'Hay estacionamiento en la calle. Se recomienda agendar cita.',
};

