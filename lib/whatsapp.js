// Envío de mensajes por la WhatsApp Cloud API.
export const GRAPH = 'https://graph.facebook.com/v24.0';
const headers = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' });

async function enviar(phoneId, payload) {
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  if (!r.ok) {
    const err = new Error(`WhatsApp ${r.status}: ${await r.text()}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

export const enviarTexto = (phoneId, para, texto) =>
  enviar(phoneId, { to: para, type: 'text', text: { body: texto } });

export const enviarPlantilla = (phoneId, para, nombre, parametros, idioma = 'es_MX') =>
  enviar(phoneId, {
    to: para,
    type: 'template',
    template: {
      name: nombre,
      language: { code: idioma },
      components: [{ type: 'body', parameters: parametros.map(t => ({ type: 'text', text: String(t).slice(0, 200) })) }],
    },
  });

export async function marcarLeido(phoneId, messageId) {
  await enviar(phoneId, { status: 'read', message_id: messageId }).catch(() => {});
}
