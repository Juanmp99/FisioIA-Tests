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
//
// Cada entrada se guarda por separado en el almacén. La batería se repite bajo
// cada sinónimo en lugar de guardar un puntero: son unos pocos kilobytes, y
// como una entidad registrada no se sobrescribe nunca, las copias no pueden
// divergir.

import { leer, escribir, cuantos } from "../lib/almacen.js";

const ALMACEN = "registro";

// Al cambiar los prompts, lo registrado deja de ser comparable. Subir este
// número invalida el registro sin tener que borrar nada a mano.
export const VERSION = 2;

export const normalizar = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Claves normalizadas de una lista de términos, en el orden en que deben
 * probarse. Es la parte con lógica —normalización y prioridad— y la
 * comparten la búsqueda en memoria y la que va contra el almacén.
 */
export function clavesDeBusqueda(terminos) {
  return (terminos || []).map(normalizar).filter(Boolean);
}

/**
 * Primer término registrado que coincida con alguno de los buscados.
 * Función pura sobre un mapa: es la que conviene poder probar.
 */
export function coincidencia(terminos, canonicas) {
  for (const clave of clavesDeBusqueda(terminos)) {
    if (canonicas[clave]) return canonicas[clave];
  }
  return null;
}

const vigente = (entrada) => (entrada && entrada.version === VERSION ? entrada : null);

async function entidadPorClave(clave) {
  const entrada = vigente(await leer(ALMACEN, `entidad:${clave}`));
  return entrada ? entrada.bateria : null;
}

/** Capa 1: ¿se ha consultado ya esta misma frase? */
export async function porTexto(sospecha) {
  const entrada = vigente(await leer(ALMACEN, `consulta:${normalizar(sospecha)}`));
  return entrada ? entidadPorClave(entrada.principal) : null;
}

/** Capa 2: ¿alguno de estos términos ingleses ya identifica una entidad registrada? */
export async function porTerminos(terminos) {
  for (const clave of clavesDeBusqueda(terminos)) {
    const hallada = await entidadPorClave(clave);
    if (hallada) return hallada;
  }
  return null;
}

/**
 * Registra una batería como la respuesta canónica de su entidad, y apunta la
 * frase consultada hacia ella. Si la entidad ya existía, no se sobrescribe:
 * la primera respuesta es la buena, porque es la que ya vio alguien.
 */
export async function registrar(sospecha, bateria) {
  const terminos = bateria.terminosBusqueda || [];
  const principal = normalizar(terminos[0] || bateria.entidad);
  if (!principal) return bateria;

  const yaRegistrada = await entidadPorClave(principal);
  const definitiva = yaRegistrada || { ...bateria, fecha: new Date().toISOString() };

  if (!yaRegistrada) {
    const entrada = { version: VERSION, bateria: definitiva };
    // Todos los sinónimos llevan a la misma respuesta.
    const claves = new Set([principal, ...clavesDeBusqueda(terminos)]);
    for (const alias of claves) await escribir(ALMACEN, `entidad:${alias}`, entrada);
  }

  await escribir(ALMACEN, `consulta:${normalizar(sospecha)}`, { version: VERSION, principal });
  return definitiva;
}

export async function tamano() {
  return cuantos(ALMACEN);
}
