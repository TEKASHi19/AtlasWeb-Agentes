// Números del equipo del negocio (dueña, ayudante). OWNER_PHONE admite varios separados por coma.
export const normalizarTel = t => (/^521\d{10}$/.test(t || '') ? '52' + t.slice(3) : t);
export const numerosEquipo = () => (process.env.OWNER_PHONE || '').split(',').map(t => normalizarTel(t.trim())).filter(Boolean);
export const esDueno = tel => numerosEquipo().includes(normalizarTel(tel));
