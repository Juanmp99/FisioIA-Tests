// Servidor de desarrollo.
//
// No reimplementa nada: monta las mismas funciones que se despliegan en
// Netlify y les da el transporte que en producción pone la plataforma. Así lo
// que se prueba en local es exactamente lo que se ejecuta en producción, y no
// hay dos copias de la lógica esperando a separarse.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MODELO, hayCredencial } from "./ia/cliente.js";
import { tamanoCache } from "./ia/evidencia.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(RAIZ, "publico");
const PUERTO = Number(process.env.PORT) || 3200;

const FUNCIONES = ["acceso", "verificar", "bateria", "evidencia", "interpretar", "estado"];

// Cada función declara su ruta en `config.path`; aquí se construye el mismo
// mapa que arma Netlify al desplegar.
const rutas = new Map();
for (const nombre of FUNCIONES) {
  const modulo = await import(`./netlify/functions/${nombre}.mjs`);
  rutas.set(modulo.config.path, modulo.default);
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

/** Página estática, resolviendo /app igual que el redirect de netlify.toml. */
async function estatico(ruta, res) {
  let relativa = ruta === "/" ? "index.html" : ruta.replace(/^\/+/, "");
  if (relativa === "app") relativa = "app.html";

  // Sin esto, una ruta como /../.env saldría de publico/.
  const destino = path.join(PUBLICO, relativa);
  if (!destino.startsWith(PUBLICO + path.sep)) {
    res.writeHead(403).end("Prohibido");
    return;
  }

  try {
    const contenido = await fs.readFile(destino);
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(destino)] || "application/octet-stream" });
    res.end(contenido);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
  }
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const manejador = rutas.get(url.pathname);

  if (!manejador) return estatico(url.pathname, res);

  // De la petición de Node a la petición web que esperan las funciones.
  const cuerpo = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise((resolver, fallar) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => resolver(Buffer.concat(trozos)));
    req.on("error", fallar);
  });

  try {
    const peticion = new Request(url, { method: req.method, headers: req.headers, body: cuerpo });
    const respuesta = await manejador(peticion, { ip: req.socket.remoteAddress });
    res.writeHead(respuesta.status, Object.fromEntries(respuesta.headers));
    res.end(Buffer.from(await respuesta.arrayBuffer()));
  } catch (e) {
    console.error("Fallo:", e);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: e.message || "Error interno." }));
  }
});

servidor.listen(PUERTO, async () => {
  console.log(`FisioIA · asistente de tests → http://localhost:${PUERTO}`);
  console.log(`Modelo: ${MODELO} · ${await tamanoCache()} elementos en caché`);
  if (!hayCredencial()) {
    console.log("Aviso: ANTHROPIC_API_KEY no está definida. La búsqueda y la batería devolverán error.");
  }
  if (process.env.ACCESO_LIBRE !== "1") {
    console.log("Aviso: sin ACCESO_LIBRE=1 hará falta un token de acceso. Para desarrollo, arranca con ACCESO_LIBRE=1.");
  }
});
