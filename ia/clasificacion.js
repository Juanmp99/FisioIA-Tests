// Qué mide cada artículo, recordado entre los tests de una misma patología.
//
// Cada test se analiza por separado, y la IA no recuerda lo que decidió en el
// de al lado. Así, un mismo estudio —el de las roturas agudas del supraespinoso
// de 2010— salía como "la patología entera" en el Drop arm y como "una parte"
// en el ERLS, según qué frase del artículo se citara. Lo que mide un artículo
// no suele depender del test que se esté mirando, así que la primera decisión
// se le pasa al modelo en los demás. Como pista, no como imposición: una
// revisión puede dar cifras de pinzamiento para un test y de rotura para otro,
// y ahí lo que manda es la fila que se cita.

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
    "\n\nEstos artículos ya se han clasificado al analizar otros tests de esta misma patología, según las cifras que se citaron de ellos. " +
    "Si las cifras que tú citas de uno de ellos miden lo mismo, usa esa misma clasificación en mismaEntidad y entidadDeLasCifras, " +
    "tanto si lo eliges como si va en otrasFuentes. Si el artículo da cifras de varias patologías o grupos y tú citas otra fila, " +
    "decide según la fila que citas:\n" +
    lineas.join("\n")
  );
}
