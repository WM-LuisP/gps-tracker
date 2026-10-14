/**
 * ============================================================================
 *  PUNTO CERCA — App.jsx
 * ============================================================================
 *  Interfaz de la aplicación: ubicación del usuario, lista de lugares y mapa.
 *
 *  ---------------------------------------------------------------------------
 *  QUÉ HACE
 *  ---------------------------------------------------------------------------
 *    1. Pide la ubicación del usuario al abrir la app.
 *    2. Carga los lugares (POI) que hay alrededor de esa ubicación.
 *    3. Deja filtrarlos por categoría y buscarlos por nombre.
 *    4. Al elegir un lugar, calcula la ruta en auto y la dibuja en el mapa.
 *
 *  ---------------------------------------------------------------------------
 *  ÍNDICE
 *  ---------------------------------------------------------------------------
 *    A. Imports e iconos
 *    B. Ayudas: ubicación del navegador y centrado del mapa
 *    C. Hooks propios: useUbicacionDelUsuario, useLugaresCercanos, useRutaEnAuto
 *    D. Componentes de la interfaz
 *    E. Componente principal
 *
 *  ---------------------------------------------------------------------------
 *  CAMBIOS DE ESTA VERSIÓN (refactor)
 *  ---------------------------------------------------------------------------
 *    · Nombres en español que describen la intención. Antes: buscarLugaresCercanos,
 *      elegirLugar, obtenerUbicacion, cargando, error. Ahora: cargarLugares,
 *      seleccionarLugar, pedirUbicacion y un estado por asunto (cargandoLugares,
 *      cargandoRuta…), que se lee mucho mejor.
 *    · La ubicación, los lugares y la ruta viven en hooks propios: cada uno
 *      controla su estado, su error y la cancelación de su petición.
 *    · Cada respuesta se guarda junto al dato que la originó (la ubicación o el
 *      lugar elegido). Así una respuesta vieja nunca se muestra por error y no
 *      hace falta limpiar el estado a mano al empezar una petición nueva.
 *    · El panel lateral se dividió en componentes pequeños (buscador, filtros,
 *      lista y tarjeta de ruta) para que el componente principal se lea de un
 *      vistazo.
 *    · Un tiempo de espera agotado ya no se confunde con una cancelación: antes,
 *      si Overpass no respondía, la interfaz decía «no encontramos lugares» en
 *      lugar de avisar del problema de conexión.
 * ============================================================================
 */

// ---------- A. Imports e iconos ----------

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  CATEGORIA_TODOS,
  CATEGORIAS,
  RADIO_BUSQUEDA_METROS,
  buscarCategoria,
  calcularRutaEnAuto,
  cargarLugaresCercanos,
  formatearDistancia,
} from './mapa.js'
import 'leaflet/dist/leaflet.css'
import './App.css'

/** Zoom al que se acerca el mapa cuando encuentra una ubicación o un destino. */
const ZOOM_AL_CENTRAR = 16

/** Icono de un lugar normal (el aspecto se define en App.css con «.poi-marker»). */
const iconoPuntoDeInteres = L.divIcon({
  className: 'poi-marker',
  html: '<span></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

/** Icono del lugar elegido (clase «.destination-marker» en App.css). */
const iconoLugarSeleccionado = L.divIcon({
  className: 'destination-marker',
  html: '<span>★</span>',
  iconSize: [30, 36],
  iconAnchor: [15, 34],
})

// ---------- B. Ayudas ----------

/**
 * Pide al navegador la ubicación actual y devuelve [latitud, longitud].
 * Si no la consigue, rechaza la promesa con un mensaje listo para mostrar.
 */
function pedirUbicacionAlNavegador() {
  return new Promise((resolver, rechazar) => {
    if (!navigator.geolocation) {
      rechazar(new Error('Este navegador no ofrece geolocalización.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolver([coords.latitude, coords.longitude]),
      () => rechazar(new Error('Activa el permiso de ubicación para encontrar lugares cerca de ti.')),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })
}

/**
 * Pregunta la ubicación al navegador y devuelve siempre un objeto:
 * { coordenadas } si la obtuvo, o { mensajeDeError } si no.
 */
async function consultarUbicacionAlNavegador() {
  try {
    return { coordenadas: await pedirUbicacionAlNavegador() }
  } catch (fallo) {
    return { mensajeDeError: fallo.message }
  }
}

/** Mueve el mapa hasta unas coordenadas. No dibuja nada. */
function CentrarMapaEn({ coordenadas, zoom = ZOOM_AL_CENTRAR }) {
  const mapa = useMap()

  useEffect(() => {
    if (coordenadas) mapa.flyTo(coordenadas, zoom, { duration: 0.8 })
  }, [coordenadas, mapa, zoom])

  return null
}

// ---------- C. Hooks propios ----------

/**
 * Guarda la ubicación del usuario y la pide una vez al abrir la app.
 * Llama a `pedirUbicacion` para volver a preguntarle al navegador.
 */
function useUbicacionDelUsuario() {
  const [ubicacion, setUbicacion] = useState(null)
  const [pidiendo, setPidiendo] = useState(true) // Al abrir la app ya se está pidiendo
  const [error, setError] = useState('')

  /** Guarda lo que respondió el navegador. */
  const guardarRespuesta = useCallback(({ coordenadas, mensajeDeError }) => {
    if (coordenadas) setUbicacion(coordenadas)
    else setError(mensajeDeError)
    setPidiendo(false)
  }, [])

  // Primera petición, al abrir la app. El estado se toca sólo cuando el navegador
  // contesta, no dentro del propio efecto.
  useEffect(() => {
    let vigente = true
    consultarUbicacionAlNavegador().then((respuesta) => {
      if (vigente) guardarRespuesta(respuesta)
    })
    return () => {
      vigente = false
    }
  }, [guardarRespuesta])

  /** Vuelve a preguntar la ubicación (botones «Mi ubicación»). */
  const pedirUbicacion = useCallback(async () => {
    setPidiendo(true)
    setError('')
    guardarRespuesta(await consultarUbicacionAlNavegador())
  }, [guardarRespuesta])

  const limpiarError = useCallback(() => setError(''), [])

  return { ubicacion, pidiendo, error, pedirUbicacion, limpiarError }
}

/**
 * Carga los lugares que hay alrededor de la ubicación indicada.
 *
 * Cada respuesta se guarda junto a la ubicación que la originó. Comparando por
 * identidad (===) se sabe al instante si lo guardado corresponde a la ubicación
 * actual, así que una respuesta vieja nunca se muestra por error.
 */
function useLugaresCercanos(ubicacion) {
  const [resultado, setResultado] = useState(null) // { ubicacion, lugares }
  const [fallo, setFallo] = useState(null) // { ubicacion, mensaje }
  const [ubicacionDescartada, setUbicacionDescartada] = useState(null) // aviso ya cerrado

  useEffect(() => {
    if (!ubicacion) return undefined

    const controlador = new AbortController()

    cargarLugaresCercanos(ubicacion, controlador.signal)
      .then((lugares) => {
        if (!controlador.signal.aborted) setResultado({ ubicacion, lugares })
      })
      .catch((error) => {
        // Cancelar es normal (cambió la ubicación o se cerró la app).
        if (error.name === 'AbortError' || controlador.signal.aborted) return
        console.error('[Lugares] No se pudieron cargar:', error)
        setFallo({
          ubicacion,
          mensaje: 'No pudimos cargar lugares cerca de ti. Revisa tu conexión e inténtalo de nuevo.',
        })
      })

    // Al cambiar de ubicación (o al cerrar la app) se cancela la búsqueda anterior.
    return () => controlador.abort()
  }, [ubicacion])

  const yaRespondio = resultado?.ubicacion === ubicacion || fallo?.ubicacion === ubicacion
  const hayFallo = fallo?.ubicacion === ubicacion

  /** Cierra el aviso de error hasta que vuelva a fallar en otra ubicación. */
  const limpiarError = useCallback(() => setUbicacionDescartada(ubicacion), [ubicacion])

  return {
    lugares: resultado?.ubicacion === ubicacion ? resultado.lugares : [],
    cargando: Boolean(ubicacion) && !yaRespondio,
    error: hayFallo && fallo.ubicacion !== ubicacionDescartada ? fallo.mensaje : '',
    limpiarError,
  }
}

/**
 * Calcula la ruta en auto hasta el lugar elegido.
 *
 * Como en los lugares, el resultado se guarda junto al destino que lo originó:
 * al elegir otro lugar la ruta se recalcula y la anterior desaparece sola.
 */
function useRutaEnAuto(ubicacion, lugarDestino) {
  const [resultado, setResultado] = useState(null) // { lugarDestino, ruta }
  const [fallo, setFallo] = useState(null) // { lugarDestino, mensaje }
  const [destinoDescartado, setDestinoDescartado] = useState(null) // aviso ya cerrado

  useEffect(() => {
    // Sin ubicación o sin destino no hay ruta que calcular.
    if (!ubicacion || !lugarDestino) return undefined

    const controlador = new AbortController()

    calcularRutaEnAuto(ubicacion, [lugarDestino.lat, lugarDestino.lon], controlador.signal)
      .then((ruta) => {
        if (!controlador.signal.aborted) setResultado({ lugarDestino, ruta })
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controlador.signal.aborted) return
        console.error('[Ruta] No se pudo calcular:', error)
        setFallo({
          lugarDestino,
          mensaje: 'No encontramos una ruta para este lugar. Prueba con otro destino.',
        })
      })

    return () => controlador.abort()
  }, [ubicacion, lugarDestino])

  const rutaLista = resultado?.lugarDestino === lugarDestino
  const hayFallo = fallo?.lugarDestino === lugarDestino

  /** Cierra el aviso de error hasta que vuelva a fallar con otro destino. */
  const limpiarError = useCallback(() => setDestinoDescartado(lugarDestino), [lugarDestino])

  return {
    ruta: rutaLista ? resultado.ruta : null,
    cargando: Boolean(ubicacion && lugarDestino) && !rutaLista && !hayFallo,
    error: hayFallo && fallo.lugarDestino !== destinoDescartado ? fallo.mensaje : '',
    limpiarError,
  }
}

// ---------- D. Componentes de la interfaz ----------

/** Barra superior con la marca y el botón para pedir la ubicación. */
function BarraSuperior({ hayUbicacion, alPedirUbicacion }) {
  return (
    <header className="topbar">
      <a className="brand" href="#inicio" aria-label="Punto Cerca, inicio">
        <span className="brand-mark" aria-hidden="true">⌖</span>
        <span>Punto <strong>cerca</strong></span>
      </a>
      <div className="topbar-note"><span className="live-dot" /> Lugares de tu ciudad, a un mapa de distancia</div>
      <button className="location-button" onClick={alPedirUbicacion}>
        <span aria-hidden="true">◎</span> {hayUbicacion ? 'Actualizar ubicación' : 'Mi ubicación'}
      </button>
    </header>
  )
}

/** Caja para buscar lugares por nombre. */
function BuscadorDeLugares({ valor, alCambiar }) {
  return (
    <label className="search-box">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        placeholder="Busca un lugar..."
        value={valor}
        onChange={(evento) => alCambiar(evento.target.value)}
      />
      <kbd>/</kbd>
    </label>
  )
}

/** Botones para filtrar por categoría. */
function FiltroDeCategorias({ categoriaActiva, alElegirCategoria }) {
  return (
    <div className="category-list" aria-label="Filtrar por categoría">
      {CATEGORIAS.map((categoria) => (
        <button
          key={categoria.id}
          className={`category-chip ${categoriaActiva === categoria.id ? 'active' : ''}`}
          onClick={() => alElegirCategoria(categoria.id)}
          aria-pressed={categoriaActiva === categoria.id}
        >
          <span aria-hidden="true">{categoria.icono}</span>{categoria.nombre}
        </button>
      ))}
    </div>
  )
}

/** Lista de lugares, con un mensaje distinto según lo que esté pasando. */
function ListaDeLugares({ lugares, cargando, hayUbicacion, lugarSeleccionado, alSeleccionar }) {
  return (
    <>
      <div className="places-header">
        <h2>Lugares cerca</h2>
        <span className="place-count">{cargando ? '…' : lugares.length}</span>
      </div>

      <div className="places-list" aria-live="polite">
        {cargando && (
          <p className="empty-state">{hayUbicacion ? 'Buscando lugares cerca de ti…' : 'Detectando tu ubicación…'}</p>
        )}
        {!cargando && !hayUbicacion && (
          <p className="empty-state">Comparte tu ubicación para ver restaurantes, iglesias, ferreterías y parques cercanos.</p>
        )}
        {!cargando && hayUbicacion && lugares.length === 0 && (
          <p className="empty-state">No encontramos lugares con ese nombre cerca de ti. Prueba otra búsqueda.</p>
        )}

        {lugares.map((lugar) => (
          <button
            key={lugar.id}
            className={`place-row ${lugarSeleccionado?.id === lugar.id ? 'selected' : ''}`}
            onClick={() => alSeleccionar(lugar)}
          >
            <span className={`place-icon ${lugar.categoria}`} aria-hidden="true">
              {buscarCategoria(lugar.categoria)?.icono}
            </span>
            <span className="place-copy"><strong>{lugar.nombre}</strong><small>{lugar.tipo}</small></span>
            <span className="place-arrow" aria-hidden="true">↗</span>
          </button>
        ))}
      </div>
    </>
  )
}

/** Tarjeta «Cómo llegar» con la distancia y el tiempo de la ruta. */
function TarjetaDeRuta({ lugar, ruta, cargando, hayUbicacion }) {
  return (
    <div className="route-card" role="status">
      <div className="route-card-top">
        <span className="route-symbol" aria-hidden="true">↗</span>
        <div><strong>Cómo llegar</strong><small>{lugar.nombre}</small></div>
      </div>
      {!hayUbicacion && <p>Comparte tu ubicación para calcular una ruta.</p>}
      {cargando && <p>Calculando la mejor ruta…</p>}
      {ruta && (
        <p>
          <strong>{formatearDistancia(ruta.distancia)}</strong>
          <span> · </span>
          {Math.max(1, Math.round(ruta.duracion / 60))} min en auto
        </p>
      )}
    </div>
  )
}

// ---------- E. Componente principal ----------

function App() {
  // ----- Filtros de la lista -----
  const [categoriaActiva, setCategoriaActiva] = useState(CATEGORIA_TODOS)
  const [textoBusqueda, setTextoBusqueda] = useState('')
  const [lugarSeleccionado, setLugarSeleccionado] = useState(null)

  // ----- Datos: ubicación, lugares y ruta -----
  const {
    ubicacion,
    pidiendo: pidiendoUbicacion,
    error: errorUbicacion,
    pedirUbicacion,
    limpiarError: limpiarErrorUbicacion,
  } = useUbicacionDelUsuario()

  const {
    lugares,
    cargando: cargandoLugares,
    error: errorLugares,
    limpiarError: limpiarErrorLugares,
  } = useLugaresCercanos(ubicacion)

  const {
    ruta,
    cargando: cargandoRuta,
    error: errorRuta,
    limpiarError: limpiarErrorRuta,
  } = useRutaEnAuto(ubicacion, lugarSeleccionado)

  /** Lugares que pasan el filtro de categoría y el buscador. */
  const lugaresVisibles = useMemo(() => {
    const texto = textoBusqueda.toLocaleLowerCase('es')
    return lugares.filter((lugar) =>
      (categoriaActiva === CATEGORIA_TODOS || lugar.categoria === categoriaActiva) &&
      // El nombre siempre llega con valor, pero se protege por si viniera vacío.
      (lugar.nombre ?? '').toLocaleLowerCase('es').includes(texto),
    )
  }, [lugares, categoriaActiva, textoBusqueda])

  /** Punto al que vuela el mapa: el lugar elegido o, si no hay, la ubicación. */
  const centroDelMapa = useMemo(
    () => (lugarSeleccionado ? [lugarSeleccionado.lat, lugarSeleccionado.lon] : ubicacion),
    [lugarSeleccionado, ubicacion],
  )

  const cargando = pidiendoUbicacion || cargandoLugares
  const hayUbicacion = Boolean(ubicacion)
  const mensajeDeError = errorUbicacion || errorLugares || errorRuta

  const limpiarErrores = () => {
    limpiarErrorUbicacion()
    limpiarErrorLugares()
    limpiarErrorRuta()
  }

  /** El usuario elige otro lugar: el hook de la ruta recalcula solo. */
  const seleccionarLugar = (lugar) => {
    setLugarSeleccionado(lugar)
    limpiarErrores()
  }

  /** El usuario pide (o actualiza) su ubicación: se descarta el destino elegido. */
  const actualizarUbicacion = () => {
    setLugarSeleccionado(null)
    limpiarErrores()
    void pedirUbicacion()
  }

  return (
    <main className="app-shell">
      <BarraSuperior hayUbicacion={hayUbicacion} alPedirUbicacion={actualizarUbicacion} />

      <section className="workspace" id="inicio">
        {/* ===== Panel lateral: buscar y elegir lugares ===== */}
        <aside className="sidebar" aria-label="Explorar lugares">
          <div className="sidebar-heading">
            <p className="eyebrow">EXPLORA A TU ALREDEDOR</p>
            <h1>¿Qué buscas<br />hoy?</h1>
            <p className="intro">Encuentra lugares y descubre cómo llegar.</p>
          </div>

          <BuscadorDeLugares valor={textoBusqueda} alCambiar={setTextoBusqueda} />
          <FiltroDeCategorias categoriaActiva={categoriaActiva} alElegirCategoria={setCategoriaActiva} />

          <ListaDeLugares
            lugares={lugaresVisibles}
            cargando={cargando}
            hayUbicacion={hayUbicacion}
            lugarSeleccionado={lugarSeleccionado}
            alSeleccionar={seleccionarLugar}
          />

          {lugarSeleccionado && (
            <TarjetaDeRuta
              lugar={lugarSeleccionado}
              ruta={ruta}
              cargando={cargandoRuta}
              hayUbicacion={hayUbicacion}
            />
          )}

          <footer className="sidebar-footer">Datos del mapa © OpenStreetMap</footer>
        </aside>

        {/* ===== Mapa ===== */}
        <section className="map-panel" aria-label="Mapa interactivo de lugares">
          <div className="map-label">
            <span className="map-label-pin">⌖</span>
            <span>
              <strong>Tu ubicación</strong>
              <small>
                {hayUbicacion
                  ? `Lugares en un radio de ${RADIO_BUSQUEDA_METROS / 1000} km`
                  : 'Comparte tu ubicación para empezar'}
              </small>
            </span>
          </div>

          <MapContainer center={[0, 0]} zoom={2} scrollWheelZoom className="map-view">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <CentrarMapaEn coordenadas={centroDelMapa} />

            {/* Marcadores de los lugares visibles */}
            {lugaresVisibles.map((lugar) => (
              <Marker
                key={lugar.id}
                position={[lugar.lat, lugar.lon]}
                icon={lugarSeleccionado?.id === lugar.id ? iconoLugarSeleccionado : iconoPuntoDeInteres}
                eventHandlers={{ click: () => seleccionarLugar(lugar) }}
              >
                <Popup><strong>{lugar.nombre}</strong><br />{lugar.tipo}</Popup>
              </Marker>
            ))}

            {/* Punto del usuario */}
            {ubicacion && (
              <CircleMarker
                center={ubicacion}
                radius={9}
                pathOptions={{ color: '#fff', weight: 3, fillColor: '#3d816c', fillOpacity: 1 }}
              >
                <Popup>Estás aquí</Popup>
              </CircleMarker>
            )}

            {/* Línea de la ruta (coordenadas en formato [latitud, longitud]) */}
            {ruta && (
              <Polyline
                positions={ruta.coordenadas}
                pathOptions={{ color: '#df7553', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }}
              />
            )}
          </MapContainer>

          <div className="map-legend">
            <span className="legend-user" /> Tu ubicación <span className="legend-route" /> Tu ruta
          </div>

          {mensajeDeError && (
            <div className="map-error" role="alert">
              {mensajeDeError}
              <button onClick={limpiarErrores} aria-label="Cerrar mensaje">×</button>
            </div>
          )}

          <button
            className="map-location-button"
            aria-label="Centrar en mi ubicación"
            title="Centrar en mi ubicación"
            onClick={actualizarUbicacion}
          >
            ◎
          </button>
        </section>
      </section>
    </main>
  )
}

export default App
