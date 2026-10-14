/**
 * ============================================================================
 *  PUNTO CERCA — mapa.js
 * ============================================================================
 *  Lógica de datos del mapa. Este archivo NO usa React: sólo consulta servicios
 *  públicos y convierte sus respuestas en datos que la interfaz pueda pintar.
 *
 *  ---------------------------------------------------------------------------
 *  ÍNDICE
 *  ---------------------------------------------------------------------------
 *    1. Configuración (radio, servidores y tiempos de espera)
 *    2. Categorías: qué se busca y cómo se reconoce en OpenStreetMap
 *    3. Distancias entre dos puntos
 *    4. Lugares cercanos (Overpass API)
 *    5. Rutas en auto (OSRM)
 *    6. Formato de datos para la interfaz
 *
 *  ---------------------------------------------------------------------------
 *  SERVICIOS EXTERNOS (gratuitos y sin clave de API)
 *  ---------------------------------------------------------------------------
 *    · Overpass API → https://overpass-api.de          (lugares de OpenStreetMap)
 *    · OSRM demo    → https://router.project-osrm.org  (rutas en auto)
 *
 *  ---------------------------------------------------------------------------
 *  CAMBIOS DE ESTA VERSIÓN (refactor)
 *  ---------------------------------------------------------------------------
 *    · Nombres de funciones explícitos y en español.
 *    · `construirConsultaOverpass` y `convertirElementoEnLugar` están exportadas
 *      para poder probarlas sin abrir el navegador.
 *    · Se revisa el campo "remark" de Overpass: el servidor puede responder 200
 *      (correcto) con un error dentro y la lista vacía; antes eso se veía en la
 *      interfaz como "no hay lugares cerca" en lugar de un fallo de consulta.
 *    · El tiempo máximo de espera por servidor sube de 12 s a 25 s: una consulta
 *      en frío puede tardar más y se estaba descartando una respuesta válida.
 *    · Se distingue "la app canceló la consulta" de "el servidor no respondió a
 *      tiempo". Antes los dos casos llegaban igual a App.jsx, que los tomaba por
 *      una cancelación intencional y no avisaba de nada al usuario.
 *    · Si un servidor falla se prueba el siguiente y, si fallan todos, el error
 *      final explica qué le pasó a cada uno.
 * ============================================================================
 */

// ===========================================================================
// 1. Configuración
// ===========================================================================

/** Radio de búsqueda alrededor del usuario, en metros (la interfaz muestra «1.8 km»). */
export const RADIO_BUSQUEDA_METROS = 1800

/** Cuántos metros mide un grado de latitud (aproximado, suficiente para este uso). */
const METROS_POR_GRADO_DE_LATITUD = 111320

/** Segundos que le concedemos a Overpass para resolver la consulta. */
const SEGUNDOS_MAXIMOS_DE_ESPERA = 25

/** El mismo tiempo en milisegundos, que es lo que espera el temporizador. */
const ESPERA_MAXIMA_MS = SEGUNDOS_MAXIMOS_DE_ESPERA * 1000

/**
 * Servidores de Overpass, en orden de preferencia.
 * Si uno falla o está ocupado se prueba el siguiente.
 */
const SERVIDORES_OVERPASS = [
  { nombre: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter' },
  { nombre: 'overpass.kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter' },
  { nombre: 'overpass.private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
]

/** Servidor de rutas OSRM. El perfil «driving» calcula la ruta en auto. */
const SERVIDOR_OSRM = 'https://router.project-osrm.org/route/v1/driving'

// ===========================================================================
// 2. Categorías
// ===========================================================================

/** Identificador de la categoría «sin filtro»: deja ver todas las demás. */
export const CATEGORIA_TODOS = 'todos'

/**
 * Categorías que ofrece la interfaz.
 *   id        → se guarda en cada lugar y se usa como clase CSS.
 *   nombre    → texto del botón (en plural).
 *   singular  → cómo se nombra un lugar de esa categoría en la lista.
 *   icono     → símbolo que aparece en el botón y en el marcador del mapa.
 *   sinNombre → texto de reemplazo cuando el lugar no tiene nombre en OSM.
 *
 * La categoría «todos» no busca nada, sólo quita el filtro; por eso no tiene
 * «singular» ni «sinNombre».
 */
export const CATEGORIAS = [
  { id: CATEGORIA_TODOS, nombre: 'Todos', icono: '◎' },
  { id: 'restaurante', nombre: 'Restaurantes', singular: 'Restaurante', icono: '🍽️', sinNombre: 'Restaurante sin nombre' },
  { id: 'iglesia', nombre: 'Iglesias', singular: 'Iglesia', icono: '⛪', sinNombre: 'Iglesia sin nombre' },
  { id: 'ferreteria', nombre: 'Ferreterías', singular: 'Ferretería', icono: '🔧', sinNombre: 'Ferretería sin nombre' },
  { id: 'parque', nombre: 'Parques', singular: 'Parque', icono: '🌳', sinNombre: 'Parque sin nombre' },
]

/**
 * Reglas que traducen una etiqueta de OpenStreetMap a una de nuestras categorías.
 *
 * Es la única fuente de verdad de las categorías: con esta tabla se arma la
 * consulta que se envía a Overpass y también se decide a qué categoría pertenece
 * cada resultado, así que las dos cosas no pueden quedar desincronizadas.
 */
const REGLAS_DE_CATEGORIA = [
  { categoria: 'restaurante', etiquetaOsm: 'amenity', valorOsm: 'restaurant' },
  { categoria: 'iglesia', etiquetaOsm: 'amenity', valorOsm: 'place_of_worship' },
  { categoria: 'ferreteria', etiquetaOsm: 'shop', valorOsm: 'hardware' },
  { categoria: 'parque', etiquetaOsm: 'leisure', valorOsm: 'park' },
]

/**
 * Averigua a qué categoría pertenece un elemento de OpenStreetMap.
 * Devuelve el id de la categoría, o null si no es de ninguna que nos interese.
 */
function detectarCategoriaOsm(etiquetas = {}) {
  const regla = REGLAS_DE_CATEGORIA.find(({ etiquetaOsm, valorOsm }) => etiquetas[etiquetaOsm] === valorOsm)
  return regla?.categoria ?? null
}

/** Busca una categoría por su id: sirve para conocer su nombre, icono o singular. */
export function buscarCategoria(id) {
  return CATEGORIAS.find((categoria) => categoria.id === id) ?? null
}

// ===========================================================================
// 3. Distancias
// ===========================================================================

/**
 * Distancia en metros entre dos puntos [latitud, longitud].
 *
 * Usa la fórmula de Haversine, que tiene en cuenta la curvatura de la Tierra.
 * Es la que decide si un lugar entra en el radio de búsqueda, porque la consulta
 * a Overpass se hace por rectángulo y aquí se recorta al círculo exacto.
 */
export function distanciaEntrePuntos([latitudA, longitudA], [latitudB, longitudB]) {
  const radianesPorGrado = Math.PI / 180
  const diferenciaDeLatitud = (latitudB - latitudA) * radianesPorGrado
  const diferenciaDeLongitud = (longitudB - longitudA) * radianesPorGrado
  const parteCentral =
    Math.sin(diferenciaDeLatitud / 2) ** 2 +
    Math.cos(latitudA * radianesPorGrado) * Math.cos(latitudB * radianesPorGrado) * Math.sin(diferenciaDeLongitud / 2) ** 2
  const anguloCentral = 2 * Math.atan2(Math.sqrt(parteCentral), Math.sqrt(1 - parteCentral))
  return 6371000 * anguloCentral
}

// ===========================================================================
// 4. Lugares cercanos (Overpass API)
// ===========================================================================

/**
 * Calcula el rectángulo «(sur,oeste,norte,este)» que contiene el círculo de
 * búsqueda. Es la forma de acotar la zona que Overpass resuelve más rápido.
 */
function calcularCajaDeBusqueda(latitud, longitud, radioMetros) {
  const gradosDeLatitud = radioMetros / METROS_POR_GRADO_DE_LATITUD
  // Un grado de longitud mide menos cuanto más lejos del ecuador: de ahí el coseno.
  const cosenoDeLatitud = Math.max(Math.cos((latitud * Math.PI) / 180), 0.01)
  const gradosDeLongitud = radioMetros / (METROS_POR_GRADO_DE_LATITUD * cosenoDeLatitud)

  const sur = Math.max(-90, latitud - gradosDeLatitud)
  const norte = Math.min(90, latitud + gradosDeLatitud)
  const oeste = Math.max(-180, longitud - gradosDeLongitud)
  const este = Math.min(180, longitud + gradosDeLongitud)

  return `(${sur},${oeste},${norte},${este})`
}

/**
 * Arma la consulta que se envía a Overpass para un punto y un radio.
 *
 * Se pide por caja (rectángulo) y no por «around» (círculo) porque Overpass
 * responde antes; después, al recibir los datos, se descarta lo que cae fuera
 * del círculo. Los filtros se generan desde REGLAS_DE_CATEGORIA.
 *
 * Devuelve un texto en Overpass QL, el lenguaje de consulta de Overpass.
 */
export function construirConsultaOverpass([latitud, longitud], radioMetros = RADIO_BUSQUEDA_METROS) {
  const caja = calcularCajaDeBusqueda(latitud, longitud, radioMetros)
  const filtros = REGLAS_DE_CATEGORIA
    .map(({ etiquetaOsm, valorOsm }) => `      nwr${caja}["${etiquetaOsm}"="${valorOsm}"];`)
    .join('\n')

  return `[out:json][timeout:${SEGUNDOS_MAXIMOS_DE_ESPERA}];
(
${filtros}
);
out center tags;`
}

/**
 * Convierte un elemento crudo de Overpass en un lugar para la app.
 * Devuelve null si no tiene coordenadas o no es de nuestras categorías.
 *
 * Forma del resultado: { id, nombre, tipo, categoria, lat, lon }
 */
export function convertirElementoEnLugar(elemento) {
  const categoria = detectarCategoriaOsm(elemento.tags)
  // Los nodos traen lat/lon; las áreas (parques, iglesias grandes) traen «center».
  const lat = elemento.lat ?? elemento.center?.lat
  const lon = elemento.lon ?? elemento.center?.lon
  if (!categoria || lat == null || lon == null) return null

  const datosDeCategoria = buscarCategoria(categoria)
  return {
    id: `${elemento.type}/${elemento.id}`,
    nombre: elemento.tags.name || datosDeCategoria.sinNombre,
    tipo: datosDeCategoria.singular,
    categoria,
    lat,
    lon,
  }
}

/**
 * Consulta un servidor de Overpass y devuelve los lugares ya limpios y ordenados.
 *
 * Corta la petición si la app la cancela (`signal`) o si el servidor tarda más de
 * lo permitido. En ese segundo caso lanza un error normal, nunca un AbortError:
 * así quien llama puede distinguir «me cancelaron» de «se agotó el tiempo».
 */
async function consultarLugaresEnServidor(servidor, coordenadas, signal) {
  const cuerpo = new URLSearchParams({ data: construirConsultaOverpass(coordenadas) })
  const controlador = new AbortController()
  let seAgotoElTiempo = false

  const temporizador = setTimeout(() => {
    seAgotoElTiempo = true
    controlador.abort()
  }, ESPERA_MAXIMA_MS)

  // Si la app cancela (por ejemplo, cambió la ubicación), se corta la petición.
  const cancelar = () => controlador.abort()
  signal?.addEventListener('abort', cancelar, { once: true })

  try {
    const respuesta = await fetch(servidor.url, { method: 'POST', body: cuerpo, signal: controlador.signal })
    if (!respuesta.ok) throw new Error(`respondió ${respuesta.status}`)

    const datos = await respuesta.json()
    // Overpass puede contestar 200 y, aun así, informar un error en «remark».
    if (datos.remark) throw new Error(`informó un problema: ${datos.remark}`)

    return (datos.elements ?? [])
      .map(convertirElementoEnLugar)
      .filter(Boolean)
      // La caja acelera la consulta, pero es rectangular: aquí se recorta al círculo.
      .filter((lugar) => distanciaEntrePuntos(coordenadas, [lugar.lat, lugar.lon]) <= RADIO_BUSQUEDA_METROS)
      // Un mismo lugar puede llegar repetido: se conserva la primera aparición.
      .filter((lugar, indice, todos) => todos.findIndex((otro) => otro.id === lugar.id) === indice)
      // Orden alfabético en español, con los acentos en su sitio.
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  } catch (fallo) {
    // El error original se conserva en «cause» para poder depurarlo después.
    if (seAgotoElTiempo) throw new Error(`no respondió en ${SEGUNDOS_MAXIMOS_DE_ESPERA} s`, { cause: fallo })
    throw fallo
  } finally {
    clearTimeout(temporizador)
    signal?.removeEventListener('abort', cancelar)
  }
}

/**
 * Busca los lugares de nuestras categorías alrededor de [latitud, longitud].
 *
 * Prueba los servidores de Overpass en orden hasta que uno responda. Si la app
 * cancela la consulta lanza un AbortError; si fallan todos los servidores lanza
 * un Error que detalla el motivo de cada intento.
 *
 * @param {[number, number]} coordenadas Punto central de la búsqueda.
 * @param {AbortSignal} [signal] Permite cancelar la consulta desde fuera.
 * @returns {Promise<Array<{id: string, nombre: string, tipo: string, categoria: string, lat: number, lon: number}>>}
 */
export async function cargarLugaresCercanos(coordenadas, signal) {
  const fallos = []

  for (const servidor of SERVIDORES_OVERPASS) {
    if (signal?.aborted) throw new DOMException('Consulta cancelada', 'AbortError')

    try {
      return await consultarLugaresEnServidor(servidor, coordenadas, signal)
    } catch (fallo) {
      // Si la cancelación la pidió la app, no tiene sentido probar otro servidor.
      if (signal?.aborted || fallo.name === 'AbortError') throw fallo
      console.warn(`[Lugares] ${servidor.nombre} ${fallo.message}`)
      fallos.push(`${servidor.nombre} ${fallo.message}`)
    }
  }

  throw new Error(`Ningún servidor de lugares respondió. ${fallos.join(' · ')}`)
}

// ===========================================================================
// 5. Rutas
// ===========================================================================

/**
 * Calcula la ruta en auto de `origen` a `destino` (ambos [latitud, longitud]).
 *
 * Devuelve { coordenadas, distancia (m), duracion (s) }.
 *
 * OJO: OSRM espera los puntos como [longitud, latitud] y Leaflet los quiere como
 * [latitud, longitud]. Por eso se invierten en los dos sentidos; si no, la línea
 * se dibujaría en otra parte del mundo.
 */
export async function calcularRutaEnAuto(origen, destino, signal) {
  const [latitudOrigen, longitudOrigen] = origen
  const [latitudDestino, longitudDestino] = destino
  const url = `${SERVIDOR_OSRM}/${longitudOrigen},${latitudOrigen};${longitudDestino},${latitudDestino}?overview=full&geometries=geojson`

  const respuesta = await fetch(url, { signal })
  if (!respuesta.ok) throw new Error(`OSRM respondió ${respuesta.status}`)

  const datos = await respuesta.json()
  const mejorRuta = datos.routes?.[0]
  if (datos.code !== 'Ok' || !mejorRuta) throw new Error('No hay ruta disponible')

  return {
    coordenadas: mejorRuta.geometry.coordinates.map(([longitud, latitud]) => [latitud, longitud]),
    distancia: mejorRuta.distance,
    duracion: mejorRuta.duration,
  }
}

// ===========================================================================
// 6. Formato de datos
// ===========================================================================

/** Convierte metros en un texto corto: 850 → «850 m» · 2430 → «2.4 km». */
export function formatearDistancia(metros) {
  return metros < 1000 ? `${Math.round(metros)} m` : `${(metros / 1000).toFixed(1)} km`
}
