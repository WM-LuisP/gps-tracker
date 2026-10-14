/**
 * ============================================================
 *  PUNTO CERCA — mapa.js
 * ============================================================
 *  Lógica de datos del mapa (sin React). Exporta lo que usa App.jsx:
 *
 *    CATEGORIAS          → lista de filtros (id, nombre, icono)
 *    cargarLugares()     → busca POI cercanos en OpenStreetMap (Overpass API)
 *    calcularRuta()      → calcula la ruta en auto (OSRM)
 *    formatearDistancia()→ "850 m" o "2.4 km"
 *
 *  Servicios usados (gratuitos, sin API key):
 *    - Overpass API: https://overpass-api.de
 *    - OSRM demo:    https://router.project-osrm.org
 * ============================================================
 */

// ---------- 1. Configuración ----------

/** Radio de búsqueda alrededor del usuario, en metros (App.jsx muestra "1.8 km"). */
const RADIO_METROS = 1800

/** Servidores Overpass: si el primero falla o está saturado, se prueba el siguiente. */
const SERVIDORES_OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

/** Servidor de rutas OSRM. */
const URL_OSRM = 'https://router.project-osrm.org/route/v1/driving'

// ---------- 2. Categorías ----------

/**
 * Categorías disponibles.
 *  - id:      se guarda en cada lugar (lugar.categoria) y se usa como clase CSS.
 *  - etiqueta: valor de OpenStreetMap con el que se detecta la categoría.
 *  - sinNombre: texto usado cuando el lugar no tiene nombre en OSM.
 */
export const CATEGORIAS = [
  { id: 'todos', nombre: 'Todos', icono: '◎' },
  { id: 'restaurante', nombre: 'Restaurantes', icono: '🍽️', sinNombre: 'Restaurante sin nombre' },
  { id: 'iglesia', nombre: 'Iglesias', icono: '⛪', sinNombre: 'Iglesia sin nombre' },
  { id: 'ferreteria', nombre: 'Ferreterías', icono: '🔧', sinNombre: 'Ferretería sin nombre' },
  { id: 'parque', nombre: 'Parques', icono: '🌳', sinNombre: 'Parque sin nombre' },
]

/**
 * Dado el conjunto de tags de OSM de un elemento, devuelve su categoría
 * (o null si no es de ninguna que nos interese).
 */
function detectarCategoria(tags = {}) {
  if (tags.amenity === 'restaurant') return 'restaurante'
  if (tags.amenity === 'place_of_worship') return 'iglesia'
  if (tags.shop === 'hardware') return 'ferreteria'
  if (tags.leisure === 'park') return 'parque'
  return null
}

// ---------- 3. Lugares (POI) ----------

/** Arma la consulta Overpass: todo lo de nuestras categorías dentro del radio. */
function construirConsulta([lat, lon]) {
  const zona = `(around:${RADIO_METROS},${lat},${lon})`
  return `
    [out:json][timeout:25];
    (
      nwr["amenity"="restaurant"]${zona};
      nwr["amenity"="place_of_worship"]${zona};
      nwr["shop"="hardware"]${zona};
      nwr["leisure"="park"]${zona};
    );
    out center tags;
  `
}

/**
 * Convierte un elemento crudo de Overpass en un lugar para la app.
 * Devuelve null si no tiene coordenadas o no es de nuestras categorías.
 *
 * Forma del resultado: { id, nombre, tipo, categoria, lat, lon }
 */
function normalizarElemento(elemento) {
  const categoria = detectarCategoria(elemento.tags)
  // Los nodos traen lat/lon; las áreas (parques, iglesias grandes) traen "center".
  const lat = elemento.lat ?? elemento.center?.lat
  const lon = elemento.lon ?? elemento.center?.lon
  if (!categoria || lat == null || lon == null) return null

  const datosCategoria = CATEGORIAS.find((item) => item.id === categoria)
  return {
    id: `${elemento.type}/${elemento.id}`,
    nombre: elemento.tags.name || datosCategoria.sinNombre,
    tipo: datosCategoria.nombre.replace(/s$/, ''), // "Restaurantes" → "Restaurante"
    categoria,
    lat,
    lon,
  }
}

/**
 * Busca los lugares cercanos a [lat, lon].
 * Prueba cada servidor Overpass hasta que uno responda.
 * Si la consulta se cancela (signal), lanza AbortError.
 */
export async function cargarLugares(coordenadas, signal) {
  const cuerpo = new URLSearchParams({ data: construirConsulta(coordenadas) })
  let ultimoError = new Error('Overpass no respondió')

  for (const servidor of SERVIDORES_OVERPASS) {
    try {
      const respuesta = await fetch(servidor, { method: 'POST', body: cuerpo, signal })
      if (!respuesta.ok) throw new Error(`Overpass respondió ${respuesta.status}`)
      const datos = await respuesta.json()

      return (datos.elements ?? [])
        .map(normalizarElemento)
        .filter(Boolean)
        // Quita duplicados por id y ordena alfabéticamente.
        .filter((lugar, indice, todos) => todos.findIndex((otro) => otro.id === lugar.id) === indice)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    } catch (fallo) {
      if (fallo.name === 'AbortError') throw fallo // Cancelada a propósito: no probar otro servidor
      ultimoError = fallo
    }
  }
  throw ultimoError
}

// ---------- 4. Rutas ----------

/**
 * Calcula la ruta en auto de `origen` a `destino` (ambos [lat, lon]).
 *
 * Devuelve: { coordenadas, distancia (m), duracion (s) }
 *
 * IMPORTANTE: OSRM usa el orden [lon, lat], pero Leaflet usa [lat, lon].
 * Por eso se invierte aquí; si no, la línea se dibujaría en otra parte del mundo.
 */
export async function calcularRuta(origen, destino, signal) {
  const [latOrigen, lonOrigen] = origen
  const [latDestino, lonDestino] = destino
  const url = `${URL_OSRM}/${lonOrigen},${latOrigen};${lonDestino},${latDestino}?overview=full&geometries=geojson`

  const respuesta = await fetch(url, { signal })
  if (!respuesta.ok) throw new Error(`OSRM respondió ${respuesta.status}`)
  const datos = await respuesta.json()

  const mejor = datos.routes?.[0]
  if (datos.code !== 'Ok' || !mejor) throw new Error('No hay ruta disponible')

  return {
    coordenadas: mejor.geometry.coordinates.map(([lon, lat]) => [lat, lon]), // ← inversión
    distancia: mejor.distance,
    duracion: mejor.duration,
  }
}

// ---------- 5. Utilidades ----------

/** 850 → "850 m" · 2430 → "2.4 km" */
export function formatearDistancia(metros) {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`
}
