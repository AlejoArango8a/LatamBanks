// ============================================================
// PAÍSES — registro único en el frontend.
// Fuente de verdad: /paises.json (el mismo archivo que usan el backend y los loaders).
// Se carga una vez al arrancar con loadPaises(). Si la carga falla, se usa un
// respaldo mínimo que mantiene el comportamiento actual (Chile / Colombia).
// ============================================================

// Respaldo por si /paises.json no cargara (red, caché, etc.).
const FALLBACK = {
  version: 0,
  default: 'chile',
  paises: {
    chile:    { key: 'chile',    iso: 'CL', name: 'Chile',    systemName: 'Chilean Banking System',  currency: 'CLP', locale: 'es-CL', status: 'live', frequency: 'monthly', aliases: ['cl', 'chile'] },
    colombia: { key: 'colombia', iso: 'CO', name: 'Colombia', systemName: 'Colombian Banking System', currency: 'COP', locale: 'es-CO', status: 'live', frequency: 'monthly', aliases: ['co', 'colombia'] },
  },
};

let REGISTRY = FALLBACK;

/** Carga /paises.json una vez. Nunca lanza: ante cualquier fallo, deja el respaldo. */
export async function loadPaises() {
  try {
    const r = await fetch('/paises.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const data = await r.json();
    if (data && data.paises && Object.keys(data.paises).length) REGISTRY = data;
  } catch (e) {
    console.warn('paises.json no cargó; usando respaldo CL/CO:', e.message);
  }
  return REGISTRY;
}

/** Devuelve el objeto de un país por su clave interna (chile, colombia, …). */
export function pais(key) {
  return REGISTRY.paises[key] || REGISTRY.paises[REGISTRY.default];
}

export function paisIso(key)         { return pais(key).iso; }
export function paisCurrency(key)    { return pais(key).currency; }
export function paisLocale(key)      { return pais(key).locale; }
export function paisSystemName(key)  { return pais(key).systemName || 'Banking System'; }
export function paisName(key)        { return pais(key).name; }

/** Resuelve un valor de ?country=… (alias o clave) a la clave interna, o null. */
export function resolveCountryKey(raw) {
  const z = String(raw || '').trim().toLowerCase();
  if (!z) return null;
  for (const [key, p] of Object.entries(REGISTRY.paises)) {
    if (key === z) return key;
    if (Array.isArray(p.aliases) && p.aliases.includes(z)) return key;
  }
  return null;
}

/** Países en producción (status: 'live'). */
export function liveCountries() {
  return Object.values(REGISTRY.paises).filter((p) => p.status === 'live');
}
