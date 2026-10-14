# Punto cerca

Explorador de lugares hecho con React, Leaflet y React-Leaflet. Permite buscar restaurantes, iglesias, ferreterías y parques, mostrar la ubicación del usuario y dibujar sobre el mapa una ruta de conducción al lugar elegido.

## Iniciar el proyecto

```bash
cd front
yarn install
yarn dev
```

Abre la dirección local que muestra Vite. Para compilar la versión de producción: `yarn build`.

## Uso

1. Al abrir la app, acepta el permiso de ubicación para centrar el mapa en tu posición y buscar POI en un radio de 1.8 km.
2. Usa las categorías o el buscador para encontrar un sitio.
3. Selecciona un resultado para centrar el mapa en ese lugar.
4. La app dibuja la ruta en el mapa y muestra distancia y tiempo estimado.

La ubicación requiere permiso del navegador y un contexto seguro (HTTPS o `localhost`). Si la consulta de lugares falla, revisa la conexión y vuelve a cargar la página.

## Código

- `src/App.jsx`: interfaz, geolocalización, filtros, lista de lugares y capas del mapa.
- `src/mapa.js`: categorías, consulta y normalización de POI, cálculo de ruta y formato de distancia.
- `src/App.css`: diseño adaptable para escritorio y móvil.

### Funciones de `mapa.js`

| Función | Para qué sirve |
| --- | --- |
| `construirConsultaOverpass(coordenadas, radio)` | Arma la consulta que se envía a Overpass. |
| `cargarLugaresCercanos(coordenadas, signal)` | Busca los lugares cercanos probando varios servidores. |
| `convertirElementoEnLugar(elemento)` | Convierte un elemento de OpenStreetMap en un lugar de la app. |
| `calcularRutaEnAuto(origen, destino, signal)` | Calcula la ruta en auto con OSRM. |
| `distanciaEntrePuntos(puntoA, puntoB)` | Distancia en metros entre dos puntos (fórmula de Haversine). |
| `formatearDistancia(metros)` | «850 m» o «2.4 km». |
| `buscarCategoria(id)` | Devuelve la categoría: nombre, icono y singular. |

### Hooks de `App.jsx`

| Hook | Para qué sirve |
| --- | --- |
| `useUbicacionDelUsuario()` | Pide la ubicación al navegador y guarda el error si falla. |
| `useLugaresCercanos(ubicacion)` | Carga los POI de alrededor y cancela la búsqueda anterior. |
| `useRutaEnAuto(ubicacion, destino)` | Calcula la ruta hasta el lugar elegido. |

Los tres archivos están comentados en español y divididos en secciones numeradas.
El centro del mapa y la búsqueda de POI se actualizan con la ubicación que comparte el navegador.

## Fuentes del mapa

- Los POI y las teselas del mapa vienen de [OpenStreetMap](https://www.openstreetmap.org/copyright); la búsqueda usa el servicio público [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API). Si un servidor falla o está saturado, la app prueba el siguiente y el error final indica qué contestó cada uno.
- La geometría y los tiempos de ruta vienen del servidor público de demostración de [OSRM](https://project-osrm.org/), usando el perfil de conducción. Es un ejemplo para desarrollo; para uso de producción se recomienda configurar servicios con límites y disponibilidad adecuados.

Los servicios públicos pueden limitar solicitudes o dejar de estar disponibles. La atribución de OpenStreetMap se muestra en el mapa.
