// Decide si el nombre de perfil de WhatsApp sirve para saludar al cliente.
// Títulos: se saltan ("Lic. Roberto" -> Roberto).
const TITULOS = new Set(['sr', 'sra', 'srta', 'senor', 'senora', 'don', 'dona', 'lic', 'ing', 'arq', 'dr', 'dra', 'mtro', 'mtra', 'prof', 'profe', 'c']);
// Si el perfil empieza con estas, es apodo, parentesco o negocio: no se usa.
const NO_SON_NOMBRES = new Set([
  'mama', 'mami', 'papa', 'papi', 'amor', 'bebe', 'baby', 'vida', 'cielo', 'jefe', 'jefa', 'patron', 'patrona',
  'tio', 'tia', 'abuelo', 'abuela', 'compa', 'carnal', 'primo', 'prima', 'flaco', 'flaca', 'gordo', 'gorda', 'guero', 'guera',
  'barberia', 'salon', 'estetica', 'spa', 'taller', 'restaurante', 'cafe', 'cafeteria', 'consultorio', 'clinica', 'farmacia',
  'iphone', 'android', 'samsung',
  'user', 'usuario', 'cliente', 'whatsapp', 'business', 'negocio', 'tienda', 'ventas', 'oficina', 'casa', 'trabajo',
  'yo', 'me', 'hola', 'ok', 'null', 'unknown', 'desconocido', 'el', 'la', 'los', 'las', 'de', 'del',
]);

const sinAcentos = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function nombreParaSaludar(perfil) {
  if (!perfil) return null;
  // Solo letras (cualquier idioma), espacios, apóstrofo y guion.
  const limpio = perfil.replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  const clave = p => sinAcentos(p).toLowerCase();
  const palabras = limpio.split(' ').filter(p => p.length >= 2 && !TITULOS.has(clave(p)));
  if (!palabras.length || NO_SON_NOMBRES.has(clave(palabras[0]))) return null;
  const candidata = palabras[0];
  if (!candidata) return null;
  if (candidata.length < 3 || candidata.length > 20) return null;
  // Si el perfil era mayormente símbolos/emojis, no confiamos (los números no cuentan en contra).
  const letras = (perfil.match(/[\p{L}\d]/gu) || []).length;
  if (letras / perfil.replace(/[\s.]/g, '').length < 0.6) return null;
  return candidata.charAt(0).toUpperCase() + candidata.slice(1).toLowerCase();
}
