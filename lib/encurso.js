// Qué búsquedas están ahora mismo en marcha.
//
// Nace con el trabajo en segundo plano. Cuando una búsqueda deja de resolverse
// dentro de la misma petición, hacen falta dos cosas que antes no: saber que ya
// hay alguien ocupándose —para no lanzar el mismo trabajo dos veces cuando el
// navegador vuelve a preguntar— y saber que ha fracasado, porque un fracaso no
// se guarda en la base de evidencia y sin esta marca sería indistinguible de no
// haber empezado nunca. El navegador preguntaría eternamente.
//
// La marca es deliberadamente frágil: caduca. Un trabajador puede morir sin
// avisar —se queda sin memoria, lo mata la plataforma— y entonces nadie la
// borraría. Si nada la toca en unos minutos se da por muerta y el trabajo se
// vuelve a lanzar. Vale más repetir una búsqueda que dejar un test colgado para
// siempre.

import { leer, escribir, borrar } from "./almacen.js";

const ALMACEN = "curso";

/**
 * Cuánto se espera antes de dar por muerto un trabajo.
 *
 * Generoso a propósito: el trabajo en segundo plano tiene quince minutos, y una
 * búsqueda con lectura de varios textos completos puede irse a dos o tres.
 * Cortar antes de tiempo significa lanzar un duplicado que compite con el
 * original por el mismo hueco de PubMed.
 */
const CADUCIDAD = 5 * 60 * 1000;

/**
 * El estado de un trabajo: "en_curso", "fallo" o null si no hay ninguno.
 *
 * Una marca caducada se devuelve como null, o sea como si no existiera, que es
 * exactamente lo que se quiere: que el siguiente que pregunte lo relance.
 */
export async function estadoDe(clave) {
  const marca = await leer(ALMACEN, clave);
  if (!marca) return null;
  if (Date.now() - new Date(marca.desde).getTime() > CADUCIDAD) return null;
  return marca;
}

/** Deja dicho que alguien se está ocupando. */
export async function marcarEnCurso(clave, identidad = {}) {
  await escribir(ALMACEN, clave, { ...identidad, estado: "en_curso", desde: new Date().toISOString() });
}

/**
 * Deja dicho que no se ha podido.
 *
 * No se borra la marca, se cambia: un fracaso transitorio no llega a la base de
 * evidencia —a propósito, porque sellar como "sin cifras" lo que no se ha
 * llegado a mirar sería peor que no responder— así que esta marca es el único
 * sitio donde consta que se intentó y salió mal.
 */
export async function marcarFallo(clave, motivo) {
  await escribir(ALMACEN, clave, { estado: "fallo", motivo, desde: new Date().toISOString() });
}

/** Se acabó: o salió bien y ya está en la base, o el fallo ya se ha contado. */
export async function olvidar(clave) {
  await borrar(ALMACEN, clave);
}
