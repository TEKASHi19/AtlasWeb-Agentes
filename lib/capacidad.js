// Cálculo de disponibilidad con capacidad (varias personas atendiendo a la vez),
// servicios por tramos (ocupada / espera, ej. un tinte mientras actúa) y margen entre citas.
// Módulo puro: no habla con Google, recibe los eventos ya leídos. Tiempos en milisegundos.

const MIN = 60_000;

// Tramos en los que el servicio ocupa a una persona, como [inicioMin, finMin] desde el arranque.
export function tramosOcupados(servicio) {
  if (!servicio.tramos?.length) return { ocupados: [[0, servicio.minutos]], total: servicio.minutos };
  const ocupados = [];
  let t = 0;
  for (const tr of servicio.tramos) {
    if (tr.ocupa) ocupados.push([t, t + tr.min]);
    t += tr.min;
  }
  return { ocupados, total: t };
}

// Convierte un evento del calendario en bloqueo o en segmentos que ocupan a una persona cada uno.
// ev: { id, ini, fin, tipo: 'bloqueo' | 'cita' | 'manual', tramos?: [[a, b], ...] en minutos }
export function segmentosDeEvento(ev, margenMin = 0) {
  if (ev.tipo === 'bloqueo') return { bloqueo: [ev.ini, ev.fin], segmentos: [] };
  const tramos = ev.tramos?.length ? ev.tramos : [[0, (ev.fin - ev.ini) / MIN]];
  const segmentos = tramos.map(([a, b], i) => [
    ev.ini + a * MIN,
    ev.ini + b * MIN + (i === tramos.length - 1 ? margenMin * MIN : 0), // margen al final (limpieza, retrasos)
  ]);
  return { bloqueo: null, segmentos };
}

// Cuántas personas están ocupadas como máximo en algún momento de [s, e).
export function maxCarga(segmentos, s, e) {
  const puntos = [s, ...segmentos.map(([a]) => a).filter(a => a > s && a < e)];
  let max = 0;
  for (const p of puntos) {
    let n = 0;
    for (const [a, b] of segmentos) if (a <= p && p < b) n++;
    if (n > max) max = n;
  }
  return max;
}

// ¿Cabe un servicio que empieza en `inicio`?
export function cabe({ inicio, servicio, eventos, capacidad = 1, margenMin = 0, cierre }) {
  const { ocupados, total } = tramosOcupados(servicio);
  const fin = inicio + total * MIN;
  if (cierre && fin > cierre) return false;
  const parsed = eventos.map(e => segmentosDeEvento(e, margenMin));
  // Un bloqueo (día u horas cerradas) que toque cualquier parte del servicio lo impide.
  if (parsed.some(p => p.bloqueo && inicio < p.bloqueo[1] && fin > p.bloqueo[0])) return false;
  const segs = parsed.flatMap(p => p.segmentos);
  // Cada tramo ocupado del nuevo servicio (con su margen al final) necesita a una persona libre.
  return ocupados.every(([a, b], i) => {
    const s = inicio + a * MIN;
    const e = inicio + b * MIN + (i === ocupados.length - 1 ? margenMin * MIN : 0);
    return maxCarga(segs, s, e) + 1 <= capacidad;
  });
}

// ¿Hay un bloqueo que cubre todo el horario de apertura?
export function diaBloqueado(eventos, abre, cierra) {
  return eventos.some(e => e.tipo === 'bloqueo' && e.ini <= abre && e.fin >= cierra);
}
