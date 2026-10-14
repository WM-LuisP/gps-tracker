/**
 * Arranca un servidor local que sirve la página de prueba y el archivo real
 * front/src/mapa.js, abre Chrome en modo headless y espera el resultado.
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'

const PUERTO = 8791
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PERFIL = path.join(process.env.TEMP ?? 'C:/Windows/Temp', `perfil-prueba-poi-${Date.now()}`)

let terminar
const listo = new Promise((resolve) => { terminar = resolve })

const servidor = http.createServer(async (peticion, respuesta) => {
  if (peticion.method === 'POST' && peticion.url === '/resultado') {
    let cuerpo = ''
    for await (const trozo of peticion) cuerpo += trozo
    console.log('===== RESULTADO DEL NAVEGADOR =====')
    console.log(cuerpo)
    console.log('===== FIN DEL RESULTADO =====')
    respuesta.writeHead(204).end()
    terminar('ok')
    return
  }
  if (peticion.url === '/mapa.js') {
    const fuente = await readFile('C:/WM/gps-tracker/front/src/mapa.js')
    respuesta.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }).end(fuente)
    return
  }
  if (peticion.url === '/' || peticion.url === '/index.html') {
    const pagina = await readFile('C:/WM/gps-tracker/.diag/prueba-poi.html')
    respuesta.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(pagina)
    return
  }
  respuesta.writeHead(404).end('no encontrado')
})

await new Promise((resolve) => servidor.listen(PUERTO, '127.0.0.1', resolve))
console.log(`servidor de prueba en http://127.0.0.1:${PUERTO}/`)

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--user-data-dir=${PERFIL}`,
  `http://127.0.0.1:${PUERTO}/`,
], { stdio: 'ignore', windowsHide: true })
// Nota: la salida de Chrome no se captura; bajo el sandbox, spawn con stdio 'pipe'
// falla con EPERM. El resultado llega por la petición POST a /resultado.

const limite = setTimeout(() => terminar('tiempo agotado'), 90000)
const motivo = await listo
clearTimeout(limite)

chrome.kill()
servidor.close()
console.log(`\n[chrome] motivo de cierre: ${motivo}`)
