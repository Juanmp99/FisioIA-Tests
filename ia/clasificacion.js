// Qué mide cada artículo, decidido una sola vez por patología.
//
// Cada test se analiza por separado, y la IA no recuerda lo que decidió en el
// de al lado. Así, un mismo estudio —el de las roturas agudas del supraespinoso
// de 2010— salía como "la patología entera" en el Drop arm y como "una parte"
// en el ERLS, según qué frase del artículo se citara. Lo que mide un artículo
// no depende del test que se esté mirando, así que se decide la primera vez y
// se respeta en todos los demás.

import { leer, escribir } from "../lib/almacen.js";

const ALMACEN = "clasificacion";

const normalizar = (s) => String(s || "").toLowerCase().trim();
const claveDe = (pmid, termino) => `${String(pmid)}|${normalizar(termino)}`;

/** Lo ya decidido para estos artículos y esta patología: Map pmid → { mismaEntidad, entidadDeLasCifras }. */
export async function clasificacionesDe(pmids, termino) {
  const unicos = [...new Set((pmids || []).filter(Boolean).map(String))];
  const leidas = await Promise.all(unicos.map((p) => leer(ALMACEN, claveDe(p, termino)).catch(() => null)));
  const mapa = new Map();
  unicos.forEach((p, i) => {
    const c = leidas[i];
    if (c && typeof c.mismaEntidad === "boolean") {
      mapa.set(p, { mismaEntidad: c.mismaEntidad, entidadDeLasCifras: c.entidadDeLasCifras || null });
    }
  });
  return mapa;
}

/**
 * Guarda lo que se ha decidido en este test para los artículos que aún no
 * estaban clasificados. Lo que ya lo estaba no se toca: manda la primera vez.
 */
export async function recordarClasificaciones(fuentes, termino, yaSabidas) {
  const nuevas = (fuentes || []).filter(
    (f) => f?.pmid && typeof f.mismaEntidad === "boolean" && !yaSabidas?.has(String(f.pmid)),
  );
  await Promise.all(
    nuevas.map((f) =>
      escribir(ALMACEN, claveDe(f.pmid, termino), {
        pmid: String(f.pmid),
        termino: normalizar(termino),
        mismaEntidad: f.mismaEntidad,
        entidadDeLasCifras: f.mismaEntidad === false ? f.entidadDeLasCifras || null : null,
        fecha: new Date().toISOString(),
      }).catch(() => null),
    ),
  );
}

/**
 * Aplica a una extracción lo ya decidido, al artículo elegido y a los otros.
 *
 * Si el elegido cambia de "entera" a "una parte" o al revés, lo que el modelo
 * dijera de "la misma parte que el elegido" se refería a otra cosa, así que no
 * se da por bueno.
 */
export function aplicarClasificaciones(datos, mapa) {
  if (!datos || !mapa?.size) return datos;
  const fijar = (d) => {
    const c = mapa.get(String(d?.pmid || ""));
    if (!c) return d;
    return { ...d, mismaEntidad: c.mismaEntidad, entidadDeLasCifras: c.mismaEntidad ? null : c.entidadDeLasCifras || d.entidadDeLasCifras || null };
  };
  const antes = datos.mismaEntidad !== false;
  const principal = fijar(datos);
  const cambia = (principal.mismaEntidad !== false) !== antes;
  const otrasFuentes = (datos.otrasFuentes || []).map((o) => {
    const f = fijar(o);
    return cambia ? { ...f, mismaParteQueElElegido: false } : f;
  });
  return { ...principal, otrasFuentes };
}

/** Lo que se le dice al modelo de los artículos ya clasificados. Vacío si no hay ninguno. */
export function avisoClasificadas(mapa, pmids) {
  const lineas = (pmids || [])
    .map(String)
    .filter((p) => mapa?.has(p))
    .map((p) => {
      const c = mapa.get(p);
      return c.mismaEntidad
        ? `- PMID ${p}: mide la entidad preguntada entera.`
        : `- PMID ${p}: mide una parte o una entidad relacionada: ${c.entidadDeLasCifras || "no la entidad entera"}.`;
    });
  if (!lineas.length) return "";
  return (
    "\n\nEstos artículos ya se han clasificado al analizar otros tests de esta misma patología. " +
    "Lo que mide un artículo no depende del test, así que usa exactamente esta clasificación en mismaEntidad y entidadDeLasCifras, " +
    "tanto si eliges el artículo como si va en otrasFuentes:\n" +
    lineas.join("\n")
  );
}
