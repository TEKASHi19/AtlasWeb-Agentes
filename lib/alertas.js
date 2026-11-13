// Alertas para el administrador (Alex) cuando algo falla. ALERT_PHONE = su número (52XXXXXXXXXX).
// Siempre salen desde el número propio de Atlas (PHONE_NUMBER_ID / WHATSAPP_TOKEN), no del negocio.
// Se limita a una alerta cada 10 minutos por tipo, para no inundar el WhatsApp si algo se cae.
const ultima = new Map();

export async function alertar(_phoneId, tipo, detalle) {
  console.error(`[ALERTA] ${tipo}:`, String(detalle).slice(0, 300));
  const admin = process.env.ALERT_PHONE, phoneId = process.env.PHONE_NUMBER_ID, token = process.env.WHATSAPP_TOKEN;
  if (!admin || !phoneId || !token) return;
  const ahora = Date.now();
  if (ahora - (ultima.get(tipo) || 0) < 10 * 60_000) return;
  ultima.set(tipo, ahora);
  try {
    await fetch(`https://graph.facebook.com/v24.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: admin, type: 'text', text: { body: `⚠️ Atlas Agentes: ${tipo}\n${String(detalle).slice(0, 300)}` } }),
    });
  } catch (e) {
    console.error('No se pudo enviar la alerta:', e.message);
  }
}
