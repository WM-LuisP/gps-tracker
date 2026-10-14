/**
 * ============================================================
 *  PUNTO CERCA — App.jsx
 * ============================================================
 *  Qué hace:
 *    1. Pide la ubicación del usuario.
 *    2. Carga lugares (POI) alrededor de esa ubicación.
 *    3. Permite filtrarlos por categoría y por nombre.
 *    4. Al elegir un lugar, calcula y dibuja la ruta en el mapa.
 *
 *  Estructura del archivo:
 *    A. Imports e íconos
 *    B. Componentes auxiliares (CentrarMapa, obtenerUbicacion)
 *    C. Componente App
 *         C1. Estado
 *         C2. Carga de lugares
 *         C3. Efectos (ubicación inicial y cálculo de ruta)
 *         C4. Datos derivados (filtro, centro del mapa)
 *         C5. Acciones del usuario
 *         C6. Render (barra superior, panel lateral, mapa)
 *
 *  Cambios respecto a la versión anterior (marcados con [FIX]):
 *    - [FIX 1] Los errores ya no se tragan: ahora se ven en la consola (F12).
 *    - [FIX 2] El centro del mapa se memoriza; antes se re-centraba en cada render.
 *    - [FIX 3] El filtro no se rompe si un lugar llega sin nombre.
 *    - [FIX 4] Una ruta cancelada ya no puede pisar a la ruta vigente.
 * ============================================================
 */

// ---------- A. Imports e íconos ----------
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { CATEGORIAS, cargarLugares, calcularRuta, formatearDistancia } from './mapa.js'
import 'leaflet/dist/leaflet.css'
import './App.css'

/** Ícono de un lugar normal (el aspecto se define en App.css con la clase .poi-marker). */
const iconoLugar = L.divIcon({ className: 'poi-marker', html: '<span></span>', iconSize: [20, 20], iconAnchor: [10, 10] })

/** Ícono del lugar seleccionado (clase .destination-marker en App.css). */
const iconoDestino = L.divIcon({ className: 'destination-marker', html: '<span>★</span>', iconSize: [30, 36], iconAnchor: [15, 34] })

// ---------- B. Componentes auxiliares ----------

/** Mueve el mapa hacia unas coordenadas [lat, lon]. No dibuja nada. */
function CentrarMapa({ coordenadas, zoom = 16 }) {
  const mapa = useMap()
  useEffect(() => {
    if (coordenadas) mapa.flyTo(coordenadas, zoom, { duration: 0.8 })
  }, [coordenadas, mapa, zoom])
  return null
}

/** Pide al navegador la ubicación actual. Devuelve una promesa con [lat, lon]. */
function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no ofrece geolocalización.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve([coords.latitude, coords.longitude]),
      () => reject(new Error('Activa el permiso de ubicación para encontrar lugares cerca de ti.')),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  })
}

// ---------- C. Componente principal ----------
function App() {
  // ----- C1. Estado -----
  const [lugares, setLugares] = useState([])            // Todos los POI cargados
  const [categoria, setCategoria] = useState('todos')   // Filtro de categoría activo
  const [busqueda, setBusqueda] = useState('')          // Texto del buscador
  const [seleccionado, setSeleccionado] = useState(null) // Lugar elegido (destino)
  const [ubicacion, setUbicacion] = useState(null)      // [lat, lon] del usuario
  const [ruta, setRuta] = useState(null)                // { coordenadas, distancia, duracion }
  const [cargando, setCargando] = useState(true)        // Cargando ubicación o POI
  const [cargandoRuta, setCargandoRuta] = useState(false)
  const [error, setError] = useState('')
  const consultaRef = useRef(null)                      // AbortController de la consulta de POI en curso

  // ----- C2. Carga de lugares -----

  /** Busca los POI alrededor de unas coordenadas y cancela la consulta anterior. */
  const buscarLugaresCercanos = async (coordenadas) => {
    consultaRef.current?.abort()
    const controlador = new AbortController()
    consultaRef.current = controlador
    setCargando(true)
    try {
      const resultados = await cargarLugares(coordenadas, controlador.signal)
      console.info(`[POI] ${resultados.length} lugares recibidos`, resultados.slice(0, 3)) // [FIX 1]
      if (!controlador.signal.aborted) setLugares(resultados)
    } catch (fallo) {
      if (fallo.name === 'AbortError') return // Cancelada a propósito, no es un error real
      console.error('[POI] Falló la carga de lugares:', fallo) // [FIX 1] Aquí se ve la causa real
      if (!controlador.signal.aborted) setError('No pudimos cargar lugares cerca de ti. Intenta de nuevo.')
    } finally {
      if (!controlador.signal.aborted) setCargando(false)
    }
  }

  // ----- C3. Efectos -----

  /** Al abrir la app: obtiene la ubicación y carga los lugares cercanos. */
  useEffect(() => {
    let vigente = true // Evita actualizar estado si el componente ya se desmontó
    const iniciar = async () => {
      try {
        const coordenadas = await obtenerUbicacion()
        if (!vigente) return
        setUbicacion(coordenadas)
        await buscarLugaresCercanos(coordenadas)
      } catch (fallo) {
        if (vigente) {
          setError(fallo.message)
          setCargando(false)
        }
      }
    }
    iniciar()
    return () => {
      vigente = false
      consultaRef.current?.abort()
    }
  }, [])

  /** Cada vez que cambia el destino o la ubicación: calcula la ruta. */
  useEffect(() => {
    if (!ubicacion || !seleccionado) return
    const controlador = new AbortController()
    calcularRuta(ubicacion, [seleccionado.lat, seleccionado.lon], controlador.signal)
      .then((resultado) => {
        console.info('[Ruta] Recibida:', resultado, 'primer punto:', resultado?.coordenadas?.[0]) // [FIX 1]
        if (!controlador.signal.aborted) setRuta(resultado) // [FIX 4]
      })
      .catch((fallo) => {
        if (fallo.name === 'AbortError') return
        console.error('[Ruta] Falló el cálculo:', fallo) // [FIX 1]
        setError('No encontramos una ruta para este lugar. Prueba con otro destino.')
      })
      .finally(() => { if (!controlador.signal.aborted) setCargandoRuta(false) })
    return () => controlador.abort()
  }, [ubicacion, seleccionado])

  // ----- C4. Datos derivados -----

  /** Lugares que pasan el filtro de categoría y el buscador. */
  const visibles = useMemo(() => {
    const texto = busqueda.toLocaleLowerCase('es')
    return lugares.filter((lugar) =>
      (categoria === 'todos' || lugar.categoria === categoria) &&
      (lugar.nombre ?? '').toLocaleLowerCase('es').includes(texto), // [FIX 3]
    )
  }, [lugares, categoria, busqueda])

  /** Punto hacia el que vuela el mapa: el destino si hay uno, si no la ubicación del usuario. */
  const centroMapa = useMemo( // [FIX 2] Misma referencia entre renders = no se repite el flyTo
    () => (seleccionado ? [seleccionado.lat, seleccionado.lon] : ubicacion),
    [seleccionado, ubicacion],
  )

  // ----- C5. Acciones del usuario -----

  /** El usuario elige un lugar: se reinicia la ruta (el efecto de arriba la recalcula). */
  const elegirLugar = (lugar) => {
    setSeleccionado(lugar)
    setRuta(null)
    setError('')
    setCargandoRuta(Boolean(ubicacion))
  }

  /** El usuario pide (o actualiza) su ubicación: reinicia todo y recarga los lugares. */
  const solicitarUbicacion = () => {
    setRuta(null)
    setError('')
    setSeleccionado(null)
    setCargandoRuta(false)
    setCargando(true)
    obtenerUbicacion()
      .then((coordenadas) => {
        setUbicacion(coordenadas)
        buscarLugaresCercanos(coordenadas)
      })
      .catch((fallo) => {
        setCargando(false)
        setCargandoRuta(false)
        setError(fallo.message)
      })
  }

  // ----- C6. Render -----
  return (
    <main className="app-shell">
      {/* ===== Barra superior ===== */}
      <header className="topbar">
        <a className="brand" href="#inicio" aria-label="Punto Cerca, inicio">
          <span className="brand-mark" aria-hidden="true">⌖</span>
          <span>Punto <strong>cerca</strong></span>
        </a>
        <div className="topbar-note"><span className="live-dot" /> Lugares de tu ciudad, a un mapa de distancia</div>
        <button className="location-button" onClick={solicitarUbicacion}>
          <span aria-hidden="true">◎</span> {ubicacion ? 'Actualizar ubicación' : 'Mi ubicación'}
        </button>
      </header>

      <section className="workspace" id="inicio">
        {/* ===== Panel lateral ===== */}
        <aside className="sidebar" aria-label="Explorar lugares">
          <div className="sidebar-heading">
            <p className="eyebrow">EXPLORA A TU ALREDEDOR</p>
            <h1>¿Qué buscas<br />hoy?</h1>
            <p className="intro">Encuentra lugares y descubre cómo llegar.</p>
          </div>

          {/* Buscador por nombre */}
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input type="search" placeholder="Busca un lugar..." value={busqueda} onChange={(event) => setBusqueda(event.target.value)} />
            <kbd>/</kbd>
          </label>

          {/* Filtro por categoría */}
          <div className="category-list" aria-label="Filtrar por categoría">
            {CATEGORIAS.map((item) => (
              <button
                key={item.id}
                className={`category-chip ${categoria === item.id ? 'active' : ''}`}
                onClick={() => setCategoria(item.id)}
                aria-pressed={categoria === item.id}
              >
                <span aria-hidden="true">{item.icono}</span>{item.nombre}
              </button>
            ))}
          </div>

          {/* Lista de lugares */}
          <div className="places-header">
            <h2>Lugares cerca</h2>
            <span className="place-count">{cargando ? '…' : visibles.length}</span>
          </div>

          <div className="places-list" aria-live="polite">
            {cargando && <p className="empty-state">{ubicacion ? 'Buscando lugares cerca de ti…' : 'Detectando tu ubicación…'}</p>}
            {!cargando && !ubicacion && <p className="empty-state">Comparte tu ubicación para ver restaurantes, iglesias, ferreterías y parques cercanos.</p>}
            {!cargando && ubicacion && visibles.length === 0 && <p className="empty-state">No encontramos lugares con ese nombre cerca de ti. Prueba otra búsqueda.</p>}
            {visibles.map((lugar) => (
              <button key={lugar.id} className={`place-row ${seleccionado?.id === lugar.id ? 'selected' : ''}`} onClick={() => elegirLugar(lugar)}>
                <span className={`place-icon ${lugar.categoria}`} aria-hidden="true">{CATEGORIAS.find((item) => item.id === lugar.categoria)?.icono}</span>
                <span className="place-copy"><strong>{lugar.nombre}</strong><small>{lugar.tipo}</small></span>
                <span className="place-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>

          {/* Tarjeta "Cómo llegar" */}
          {seleccionado && (
            <div className="route-card" role="status">
              <div className="route-card-top"><span className="route-symbol" aria-hidden="true">↗</span><div><strong>Cómo llegar</strong><small>{seleccionado.nombre}</small></div></div>
              {!ubicacion && <p>Comparte tu ubicación para calcular una ruta.</p>}
              {cargandoRuta && <p>Calculando la mejor ruta…</p>}
              {ruta && <p><strong>{formatearDistancia(ruta.distancia)}</strong><span> · </span>{Math.max(1, Math.round(ruta.duracion / 60))} min en auto</p>}
            </div>
          )}

          <footer className="sidebar-footer">Datos del mapa © OpenStreetMap</footer>
        </aside>

        {/* ===== Mapa ===== */}
        <section className="map-panel" aria-label="Mapa interactivo de lugares">
          <div className="map-label"><span className="map-label-pin">⌖</span><span><strong>Tu ubicación</strong><small>{ubicacion ? 'Lugares en un radio de 1.8 km' : 'Comparte tu ubicación para empezar'}</small></span></div>

          <MapContainer center={[0, 0]} zoom={2} scrollWheelZoom className="map-view">
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <CentrarMapa coordenadas={centroMapa} />

            {/* Marcadores de lugares */}
            {visibles.map((lugar) => (
              <Marker key={lugar.id} position={[lugar.lat, lugar.lon]} icon={seleccionado?.id === lugar.id ? iconoDestino : iconoLugar} eventHandlers={{ click: () => elegirLugar(lugar) }}>
                <Popup><strong>{lugar.nombre}</strong><br />{lugar.tipo}</Popup>
              </Marker>
            ))}

            {/* Punto del usuario */}
            {ubicacion && <CircleMarker center={ubicacion} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#3d816c', fillOpacity: 1 }}><Popup>Estás aquí</Popup></CircleMarker>}

            {/* Línea de la ruta: espera coordenadas en formato [lat, lon] */}
            {ruta && <Polyline positions={ruta.coordenadas} pathOptions={{ color: '#df7553', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }} />}
          </MapContainer>

          <div className="map-legend"><span className="legend-user" /> Tu ubicación <span className="legend-route" /> Tu ruta</div>
          {error && <div className="map-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Cerrar mensaje">×</button></div>}
          <button className="map-location-button" aria-label="Centrar en mi ubicación" title="Centrar en mi ubicación" onClick={solicitarUbicacion}>◎</button>
        </section>
      </section>
    </main>
  )
}

export default App
