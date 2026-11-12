import crypto from 'node:crypto';
import { promptSistema } from '../lib/negocio.js';

const GRAPH = 'https://graph.facebook.com/v24.0';
const MODELO = 'claude-haiku-5-5';

// GET: Meta llama aquí una sola vez para verificar que el webhook es nuestro.
export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  console.log('GET webhook', { mode, tokenOk: token === process.env.VERIFY_TOKEN });
  if (mode === 'subscribe' && token && token === process.env.VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('Forbidden', { status: 403 });
}

// POST: Meta manda aquí cada mensaje que recibe el número.
export async function POST(request) {
  const raw = await request.text();
  console.log('POST webhook recibido:', raw.slice(0, 800));

  // Verifica que el aviso de verdad venga de Meta (firma con el App Secret).
  if (process.env.APP_SECRET) {
    const firma = request.headers.get('x-hub-signature-256') || '';
    const esperada = 'sha256=' + crypto.createHmac('sha256', process.env.APP_SECRET).update(raw).digest('hex');
    const a = Buffer.from(firma), b = Buffer.from(esperada);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.error('Firma inválida: revisa APP_SECRET');
      return new Response('Firma inválida', { status: 401 });
    }
  }

  let body;
  try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }

  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  // Avisos de estado (entregado, leído) no llevan mensaje: los ignoramos.
  if (!msg) return new Response('ok', { status: 200 });

  const phoneId = value.metadata?.phone_number_id || process.env.PHONE_NUMBER_ID;
  // México: WhatsApp manda los números como 521XXXXXXXXXX, pero hay que responder a 52XXXXXXXXXX.
  const de = /^521\d{10}$/.test(msg.from) ? '52' + msg.from.slice(3) : msg.from;

  try {
    await marcarLeido(phoneId, msg.id);
    let respuesta;
    if (msg.type === 'text') {
      respuesta = await preguntarAClaude(msg.text.body);
    } else {
      respuesta = 'Por ahora solo puedo leer mensajes de texto. ¿Me lo escribes, porfa?';
    }
    await enviarTexto(phoneId, de, respuesta);
    console.log('Respondido a', de);
  } catch (err) {
    console.error('Error procesando mensaje:', err);
  }
  // Siempre 200 para que Meta no reintente el mismo mensaje.
  return new Response('ok', { status: 200 });
}

async function preguntarAClaude(texto) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 400,
      system: promptSistema(),
      messages: [{ role: 'user', content: texto }],
    }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.content?.filter(c => c.type === 'text').map(c => c.text).join('').trim()
    || 'Perdón, tuve un problema. En breve te contesta una persona.';
}

async function enviarTexto(phoneId, para, texto) {
  const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto } }),
  });
  if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
}

async function marcarLeido(phoneId, messageId) {
  await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {});
}
