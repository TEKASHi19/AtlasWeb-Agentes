// Números del equipo del negocio (dueña, ayudante): de la config del negocio o, en el demo, de OWNER_PHONE (separados por coma).
import { getNegocio } from './config.js';
export const normalizarTel = t => (/^521\d{10}$/.test(t || '') ? '52' + t.slice(3) : t);
export const numerosEquipo = () => {
  const lista = getNegocio().equipo?.length ? getNegocio().equipo : (process.env.OWNER_PHONE || '').split(',');
  return lista.map(t => normalizarTel(String(t).trim())).filter(Boolean);
};
export const esDueno = tel => numerosEquipo().includes(normalizarTel(tel));
