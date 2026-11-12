// Alertas para el administrador (Alex) cuando algo falla. ALERT_PHONE = su número (52XXXXXXXXXX).
// Se limita a una alerta cada 10 minutos por tipo, para no inundar el WhatsApp si algo se cae.
import { enviarTexto } from './whatsapp.js';

const ultima = new Map();

export async function alertar(phoneId, tipo, detalle) {
  console.error(`[ALERTA] ${tipo}:`, detalle);
  const admin = process.env.ALERT_PHONE;
  if (!admin || !phoneId) return;
  const ahora = Date.now();
  if (ahora - (ultima.get(tipo) || 0) < 10 * 60_000) return;
  ultima.set(tipo, ahora);
  try {
    await enviarTexto(phoneId, admin, `⚠️ Atlas Agentes: ${tipo}\n${String(detalle).slice(0, 300)}`);
  } catch (e) {
    console.error('No se pudo enviar la alerta:', e.message.slice(0, 200));
  }
}
