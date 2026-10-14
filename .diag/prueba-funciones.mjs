/**
 * Pruebas del archivo refactorizado front/src/mapa.js.
 * No usan red: sustituyen fetch por una función falsa cuando hace falta.
 *   node .diag/prueba-funciones.mjs
 */
import {
  CATEGORIA_TODOS,
  CATEGORIAS,
  RADIO_BUSQUEDA_METROS,
  buscarCategoria,
  calcularRutaEnAuto,
  cargarLugaresCercanos,
  construirConsultaOverpass,
  convertirElementoEnLugar,
  distanciaEntrePuntos,
  formatearDistancia,
} from 'file:///C:/WM/gps-tracker/front/src/mapa.js'

let fallos = 0
const afirmar = (condicion, descripcion) => {
  console.log(`${condicion ? '  ok  ' : ' FALLA'} · ${descripcion}`)
  if (!condicion) fallos += 1
}
const titulo = (texto) => console.log(`\n${texto}`)

// ---------------------------------------------------------------- categorías
titulo('Categorías')
afirmar(CATEGORIA_TODOS === 'todos', 'CATEGORIA_TODOS es "todos"')
afirmar(CATEGORIAS.length === 5, 'hay 5 categorías (una de ellas "todos")')
afirmar(buscarCategoria('ferreteria')?.singular === 'Ferretería', 'la categoría ferretería tiene singular "Ferretería"')
afirmar(buscarCategoria('inexistente') === null, 'una categoría desconocida devuelve null')

// ------------------------------------------------------------------ consulta
titulo('Consulta a Overpass')
const consulta = construirConsultaOverpass([40.4168, -3.7038])
afirmar(consulta.includes('[out:json][timeout:25]'), 'declara la salida JSON y 25 s de espera')
afirmar((consulta.match(/nwr/g) ?? []).length === 4, 'pide una línea por cada categoría buscable')
afirmar(consulta.includes('out center tags;'), 'pide el centro de las áreas y sus etiquetas')

const [sur, oeste, norte, este] = consulta
  .match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)
  .slice(1)
  .map(Number)
afirmar(sur < 40.4168 && 40.4168 < norte, 'la latitud del usuario queda dentro de la caja')
afirmar(oeste < -3.7038 && -3.7038 < este, 'la longitud del usuario queda dentro de la caja')
const gradosEsperados = RADIO_BUSQUEDA_METROS / 111320
afirmar(
  Math.abs(norte - (40.4168 + gradosEsperados)) < 1e-9,
  'la caja se estira en latitud justo lo que mide el radio',
)
const cajaChica = construirConsultaOverpass([0, 0], 1000)
  .match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/)
  .slice(1)
  .map(Number)
afirmar(
  Math.abs(cajaChica[2] - 1000 / 111320) < 1e-9,
  'el radio se puede cambiar por parámetro (1000 m da una caja más pequeña)',
)

// -------------------------------------------------------------- conversiones
titulo('Conversión de elementos de OpenStreetMap')
const nodo = { type: 'node', id: 1, lat: 40.4, lon: -3.7, tags: { amenity: 'restaurant', name: 'La Cocina' } }
afirmar(
  JSON.stringify(convertirElementoEnLugar(nodo)) ===
    JSON.stringify({ id: 'node/1', nombre: 'La Cocina', tipo: 'Restaurante', categoria: 'restaurante', lat: 40.4, lon: -3.7 }),
  'un nodo con nombre se convierte en un lugar completo',
)

const area = { type: 'way', id: 2, center: { lat: 40.41, lon: -3.71 }, tags: { leisure: 'park' } }
const areaConvertida = convertirElementoEnLugar(area)
afirmar(areaConvertida?.nombre === 'Parque sin nombre', 'un área sin nombre usa el texto de reemplazo')
afirmar(areaConvertida?.tipo === 'Parque', 'el tipo sale en singular')
afirmar(areaConvertida?.lat === 40.41 && areaConvertida?.lon === -3.71, 'un área toma sus coordenadas de "center"')

afirmar(convertirElementoEnLugar({ type: 'node', id: 3, lat: 1, lon: 1, tags: { amenity: 'cafe' } }) === null, 'una categoría ajena devuelve null')
afirmar(convertirElementoEnLugar({ type: 'node', id: 4, tags: { shop: 'hardware' } }) === null, 'un elemento sin coordenadas devuelve null')
afirmar(convertirElementoEnLugar({ type: 'way', id: 5, center: { lat: 1, lon: 1 } }) === null, 'un elemento sin etiquetas devuelve null')

// ------------------------------------------------------------------ distancias
titulo('Distancias y formato')
afirmar(distanciaEntrePuntos([40.4, -3.7], [40.4, -3.7]) === 0, 'la distancia al mismo punto es 0')
afirmar(
  Math.abs(distanciaEntrePuntos([0, 0], [0, 1]) - 111194.9) < 5,
  'un grado de longitud en el ecuador son ~111.19 km',
)
afirmar(formatearDistancia(850) === '850 m', '850 metros se muestran como "850 m"')
afirmar(formatearDistancia(2430) === '2.4 km', '2430 metros se muestran como "2.4 km"')

// ------------------------------------------------------- carga de lugares
titulo('Carga de lugares (con fetch falso)')

// 1. Overpass responde 200 pero informa un error en "remark".
globalThis.fetch = async () => ({ ok: true, json: async () => ({ remark: 'runtime error: out of memory', elements: [] }) })
let mensaje = ''
try {
  await cargarLugaresCercanos([40.4168, -3.7038])
} catch (fallo) {
  mensaje = fallo.message
}
afirmar(mensaje.includes('informó un problema'), 'un "remark" de Overpass se convierte en error, no en lista vacía')
afirmar(mensaje.includes('out of memory'), 'el error conserva lo que dijo Overpass')

// 2. Todos los servidores contestan 429.
globalThis.fetch = async () => ({ ok: false, status: 429 })
try {
  await cargarLugaresCercanos([40.4168, -3.7038])
  mensaje = ''
} catch (fallo) {
  mensaje = fallo.message
}
afirmar(mensaje.includes('overpass-api.de respondió 429'), 'el error final nombra al primer servidor y su código')
afirmar(mensaje.includes('kumi') && mensaje.includes('private.coffee'), 'el error final incluye a todos los servidores probados')

// 3. Un servidor responde bien tras fallar el primero.
let llamadas = 0
globalThis.fetch = async () => {
  llamadas += 1
  if (llamadas === 1) throw new Error('sin conexión')
  return {
    ok: true,
    json: async () => ({
      elements: [
        { type: 'node', id: 1, lat: 40.4169, lon: -3.7037, tags: { amenity: 'restaurant', name: 'Zeta' } },
        { type: 'node', id: 2, lat: 40.417, lon: -3.7036, tags: { amenity: 'restaurant', name: 'Alfa' } },
        { type: 'node', id: 3, lat: 40.5, lon: -3.7, tags: { amenity: 'restaurant', name: 'Lejos' } },
        { type: 'node', id: 1, lat: 40.4169, lon: -3.7037, tags: { amenity: 'restaurant', name: 'Zeta' } },
        { type: 'node', id: 4, lat: 40.4169, lon: -3.7037, tags: { amenity: 'cafe', name: 'Café' } },
      ],
    }),
  }
}
const encontrados = await cargarLugaresCercanos([40.4168, -3.7038])
afirmar(llamadas === 2, 'si el primer servidor falla, se prueba el siguiente')
afirmar(encontrados.length === 2, 'se descartan el lugar lejano, el duplicado y la categoría ajena')
afirmar(encontrados.map((l) => l.nombre).join(',') === 'Alfa,Zeta', 'los lugares llegan ordenados por nombre')

// 4. Cancelación pedida por la app: debe seguir siendo un AbortError.
globalThis.fetch = async () => ({ ok: true, json: async () => ({ elements: [] }) })
const controlador = new AbortController()
controlador.abort()
let nombreDelError = ''
try {
  await cargarLugaresCercanos([40.4168, -3.7038], controlador.signal)
} catch (fallo) {
  nombreDelError = fallo.name
}
afirmar(nombreDelError === 'AbortError', 'una cancelación de la app sigue siendo un AbortError')

// ------------------------------------------------------------------- rutas
titulo('Rutas (con fetch falso)')
let urlPedida = ''
globalThis.fetch = async (url) => {
  urlPedida = url
  return {
    ok: true,
    json: async () => ({
      code: 'Ok',
      routes: [{ distance: 1234.5, duration: 300, geometry: { coordinates: [[-3.7038, 40.4168], [-3.7, 40.42]] } }],
    }),
  }
}
const ruta = await calcularRutaEnAuto([40.4168, -3.7038], [40.42, -3.7])
afirmar(urlPedida.includes('/-3.7038,40.4168;-3.7,40.42'), 'a OSRM se le envía [longitud, latitud]')
afirmar(JSON.stringify(ruta.coordenadas[0]) === '[40.4168,-3.7038]', 'de OSRM se recibe [latitud, longitud] para Leaflet')
afirmar(ruta.distancia === 1234.5 && ruta.duracion === 300, 'se conservan distancia y duración')

globalThis.fetch = async () => ({ ok: true, json: async () => ({ code: 'NoRoute', routes: [] }) })
mensaje = ''
try {
  await calcularRutaEnAuto([40.4168, -3.7038], [40.42, -3.7])
} catch (fallo) {
  mensaje = fallo.message
}
afirmar(mensaje === 'No hay ruta disponible', 'sin ruta se lanza un error claro')

console.log(fallos === 0 ? '\nTODO CORRECTO' : `\n${fallos} PRUEBAS FALLIDAS`)
process.exitCode = fallos === 0 ? 0 : 1
