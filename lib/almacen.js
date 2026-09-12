// Almacenamiento persistente, con dos implementaciones tras la misma interfaz.
//
// En local escribe archivos bajo datos/, como hasta ahora. En Netlify no hay
// disco: cada invocación de una función arranca con el sistema de archivos
// limpio, así que la caché de evidencia y el registro de entidades se
// perderían entre peticiones. Y perder el registro no es perder velocidad: es
// perder la garantía de que la misma sospecha devuelve siempre la misma
// batería, que es lo que hace reproducible a la herramienta.
//
// Cada valor va en su propia clave, nunca en un archivo común que haya que
// leer entero y reescribir. Con varias funciones atendiendo peticiones a la
// vez, ese patrón de leer-modificar-escribir pierde escrituras en silencio.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIRECTORIO = path.join(RAIZ, "datos");

// Netlify define NETLIFY en su propio entorno. Fuera de él se puede llegar al
// mismo almacén con credenciales explícitas, que es lo que permite auditar
// desde el portátil la base que ha construido producción.
const credenciales = process.env.NETLIFY_SITE_ID && process.env.NETLIFY_API_TOKEN
  ? { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_API_TOKEN }
  : null;

const enNetlify = Boolean(process.env.NETLIFY) || Boolean(credenciales);

/**
 * Clave legible y segura a la vez.
 *
 * La parte legible sirve para poder mirar el almacén y entender qué hay. El
 * resumen del final evita que dos claves distintas que se limpian igual
 * —"hawkins test" y "hawkins-test"— acaben pisándose.
 */
export function claveSegura(texto) {
  const bruta = String(texto);
  const legible = bruta
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const resumen = crypto.createHash("sha256").update(bruta).digest("hex").slice(0, 10);
  return `${legible || "x"}-${resumen}`;
}

/* ============ implementación sobre Netlify Blobs ============ */

let getStore = null;

async function almacenBlobs(nombre) {
  if (!getStore) ({ getStore } = await import("@netlify/blobs"));
  // Consistencia fuerte: al verificar un acceso recién creado, o al releer una
  // entidad que se acaba de registrar, una lectura desfasada daría un error
  // incomprensible al usuario. Cuesta algo de latencia y lo vale.
  return getStore({ name: nombre, consistency: "strong", ...(credenciales || {}) });
}

/* ============ implementación sobre archivos ============ */

const rutaLocal = (nombre, clave) => path.join(DIRECTORIO, nombre, `${clave}.json`);

/* ============ interfaz ============ */

export async function leer(nombre, clave) {
  const k = claveSegura(clave);
  if (enNetlify) {
    const almacen = await almacenBlobs(nombre);
    return (await almacen.get(k, { type: "json" })) ?? null;
  }
  try {
    return JSON.parse(await fs.readFile(rutaLocal(nombre, k), "utf8"));
  } catch {
    return null;
  }
}

export async function escribir(nombre, clave, valor) {
  const k = claveSegura(clave);
  if (enNetlify) {
    const almacen = await almacenBlobs(nombre);
    await almacen.setJSON(k, valor);
    return;
  }
  const destino = rutaLocal(nombre, k);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, JSON.stringify(valor, null, 2), "utf8");
}

/**
 * Todo lo guardado en un almacén. Lo usa la auditoría, que necesita recorrer
 * la base entera; el resto del código va siempre por clave.
 */
export async function todos(nombre) {
  if (enNetlify) {
    const almacen = await almacenBlobs(nombre);
    const { blobs } = await almacen.list();
    const salida = [];
    for (const { key } of blobs) {
      const valor = await almacen.get(key, { type: "json" });
      if (valor) salida.push(valor);
    }
    return salida;
  }
  try {
    const carpeta = path.join(DIRECTORIO, nombre);
    const archivos = (await fs.readdir(carpeta)).filter((a) => a.endsWith(".json"));
    return Promise.all(
      archivos.map(async (a) => JSON.parse(await fs.readFile(path.join(carpeta, a), "utf8"))),
    );
  } catch {
    return [];
  }
}

/** Número de elementos guardados. Solo informativo: se muestra en el estado. */
export async function cuantos(nombre) {
  if (enNetlify) {
    const almacen = await almacenBlobs(nombre);
    const { blobs } = await almacen.list();
    return blobs.length;
  }
  try {
    const archivos = await fs.readdir(path.join(DIRECTORIO, nombre));
    return archivos.filter((a) => a.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
