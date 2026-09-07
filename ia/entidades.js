// Registro de entidades y baterías ya resueltas.
//
// Sin esto, la misma sospecha escrita dos veces puede normalizarse de forma
// distinta —"epicondilalgia lateral" una vez, "epicondilitis lateral" la
// siguiente—, y como la clave de la caché de evidencia depende del término en
// inglés, el fisioterapeuta recibe dos respuestas diferentes para la misma
// pregunta. En una herramienta clínica eso no es aceptable.
//
// Se resuelve en dos capas:
//
//   1. Por el texto que escribe el fisioterapeuta. Si ya se consultó esa misma
//      frase, se devuelve exactamente la batería de la primera vez. Además de
//      reproducible, sale instantánea y gratis.
//
//   2. Por los términos en inglés. Si la frase es nueva pero alguno de sus
//      términos ya identifica una entidad registrada, se adopta la entidad
//      canónica en lugar de crear una variante nueva. Así "epicondilitis" y
//      "codo de tenista" acaban en el mismo sitio.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = path.join(RAIZ, "datos", "entidades.json");

// Al cambiar los prompts, lo registrado deja de ser comparable. Subir este
// número invalida el registro sin tener que borrar el archivo a mano.
export const VERSION = 1;

export const normalizar = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Primer término registrado que coincida con alguno de los buscados.
 * Función pura: es la parte con lógica y la que conviene poder probar.
 */
export function coincidencia(terminos, canonicas) {
  for (const t of terminos || []) {
    const clave = normalizar(t);
    if (clave && canonicas[clave]) return canonicas[clave];
  }
  return null;
}

let memoria = null;

async function cargar() {
  if (memoria) return memoria;
  try {
    const leido = JSON.parse(await fs.readFile(ARCHIVO, "utf8"));
    memoria = leido.version === VERSION ? leido : { version: VERSION, consultas: {}, canonicas: {} };
  } catch {
    memoria = { version: VERSION, consultas: {}, canonicas: {} };
  }
  return memoria;
}

async function volcar() {
  await fs.mkdir(path.dirname(ARCHIVO), { recursive: true });
  await fs.writeFile(ARCHIVO, JSON.stringify(memoria, null, 2), "utf8");
}

/** Capa 1: ¿se ha consultado ya esta misma frase? */
export async function porTexto(sospecha) {
  const base = await cargar();
  const clave = base.consultas[normalizar(sospecha)];
  return clave ? base.canonicas[clave] || null : null;
}

/** Capa 2: ¿alguno de estos términos ingleses ya identifica una entidad registrada? */
export async function porTerminos(terminos) {
  const base = await cargar();
  return coincidencia(terminos, base.canonicas);
}

/**
 * Registra una batería como la respuesta canónica de su entidad, y apunta la
 * frase consultada hacia ella. Si la entidad ya existía, no se sobrescribe:
 * la primera respuesta es la buena, porque es la que ya vio alguien.
 */
export async function registrar(sospecha, bateria) {
  const base = await cargar();
  const terminos = bateria.terminosBusqueda || [];
  const principal = normalizar(terminos[0] || bateria.entidad);
  if (!principal) return bateria;

  if (!base.canonicas[principal]) {
    base.canonicas[principal] = { ...bateria, fecha: new Date().toISOString() };
    // Todos los sinónimos apuntan a la misma entrada.
    for (const t of terminos) {
      const alias = normalizar(t);
      if (alias && alias !== principal) base.canonicas[alias] = base.canonicas[principal];
    }
  }

  base.consultas[normalizar(sospecha)] = principal;
  await volcar();
  return base.canonicas[principal];
}

export async function tamano() {
  const base = await cargar();
  return { consultas: Object.keys(base.consultas).length, entidades: Object.keys(base.canonicas).length };
}
