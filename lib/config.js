// Configuración por negocio. Cada número de WhatsApp (phone_number_id) tiene su fila en public.negocios
// con servicios, horario, capacidad, calendario y números del equipo. Durante cada mensaje la config
// vive en un contexto (AsyncLocalStorage) para que todo el código lea la del negocio correcto.
import { AsyncLocalStorage } from 'node:async_hooks';
import { negocioDemo } from './negocio-demo.js';

const contexto = new AsyncLocalStorage();
const cache = new Map(); // phoneId -> { cfg, exp }
const TTL = 60_000;

export function normalizarConfig(c) {
  const servicios = (c.servicios || []).map(s => ({
    ...s,
    minutos: s.tramos?.length ? s.tramos.reduce((a, t) => a + Number(t.min || 0), 0) : Number(s.minutos || 0),
  }));
  return { capacidad: 1, margenMin: 0, intervaloMin: 30, equipo: [], ...c, servicios };
}

const DEMO = normalizarConfig(negocioDemo);

export const getNegocio = () => contexto.getStore()?.negocio || DEMO;
// Token de WhatsApp del negocio actual (del alta); si no tiene, el del demo en variables de entorno.
export const getToken = () => getNegocio()._token || process.env.WHATSAPP_TOKEN;
export const getPhoneId = () => contexto.getStore()?.phoneId || process.env.PHONE_NUMBER_ID;
export const conNegocio = (negocio, phoneId, fn) => contexto.run({ negocio, phoneId }, fn);

export async function cargarNegocio(phoneId) {
  const c = cache.get(phoneId);
  if (c && c.exp > Date.now()) return c.cfg;
  const url = process.env.SUPABASE_URL?.replace(/\/$/, ''), key = process.env.SUPABASE_SECRET_KEY;
  let cfg = null;
  if (url && key && phoneId) {
    try {
      const r = await fetch(`${url}/rest/v1/negocios?select=config,activo&phone_number_id=eq.${encodeURIComponent(phoneId)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const fila = r.ok ? (await r.json())[0] : null;
      if (fila?.activo && fila.config) cfg = normalizarConfig(fila.config);
      const rc = await fetch(`${url}/rest/v1/negocios_credenciales?select=token&phone_number_id=eq.${encodeURIComponent(phoneId)}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      const cred = rc.ok ? (await rc.json())[0] : null;
      if (cfg && cred?.token) Object.defineProperty(cfg, '_token', { value: cred.token, enumerable: false });
    } catch (e) {
      console.error('No se pudo leer la config del negocio:', e.message);
    }
  }
  // Sin fila en la base: el demo, con calendario y equipo de las variables de entorno.
  if (!cfg) cfg = { ...DEMO };
  cache.set(phoneId, { cfg, exp: Date.now() + TTL });
  return cfg;
}

// Todos los negocios activos (para tareas programadas como los recordatorios).
export async function listarNegocios() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, ''), key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return [];
  const r = await fetch(`${url}/rest/v1/negocios?select=phone_number_id,config&activo=eq.true`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return [];
  return (await r.json()).map(f => ({ phoneId: f.phone_number_id, negocio: normalizarConfig(f.config) }));
}
