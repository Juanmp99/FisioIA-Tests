// Las otras cifras publicadas del mismo test.
//
// La sensibilidad y la especificidad de un test salen de la misma tabla y del
// mismo grupo de pacientes, así que mezclar la de un artículo con la de otro
// produce un número que nadie ha medido. Por eso el cálculo usa un solo
// artículo, y por eso estas cifras se enseñan al lado y no se funden con él.
//
// Lo que aportan es lo que una cifra sola esconde: que la literatura no está de
// acuerdo. Ver 0,45 en un estudio y 0,88 en otro dice más sobre cuánto fiarse
// que cualquier etiqueta de calidad.

import { comprobarCita, problemasDeCita } from "./trazabilidad.js";

/** Como mucho tres. Más es una tabla, y esto es un apunte al margen. */
const MAXIMO = 3;

const esProporcion = (x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1;

const TIPOS = new Set(["revision_sistematica", "estudio_primario"]);

/**
 * Se queda con las fuentes secundarias que se pueden enseñar.
 *
 * Exige lo mismo que a la principal: que el artículo esté entre los leídos, que
 * las cifras sean proporciones y que aparezcan en la frase citada. Lo que no lo
 * cumple se descarta en silencio; son un añadido, y un añadido dudoso vale
 * menos que ninguno.
 *
 * @param {object[]} candidatas  Lo que devolvió el modelo.
 * @param {object[]} articulos   Los artículos que se le dieron a leer.
 * @param {string}   pmidPrincipal  El que sostiene las cifras del cálculo.
 * @param {string[]} nombres        Cómo se llama el test, para exigir que la frase lo nombre.
 */
export function depurarFuentes({ candidatas, articulos, pmidPrincipal, nombres = [], esAgrupacion = false }) {
  const porPmid = new Map((articulos || []).map((a) => [String(a.pmid), a]));
  const vistos = new Set([String(pmidPrincipal || "")]);
  const salida = [];

  for (const c of candidatas || []) {
    if (salida.length >= MAXIMO) break;

    const pmid = String(c?.pmid || "");
    const articulo = porPmid.get(pmid);
    if (!articulo || vistos.has(pmid)) continue;

    const sn = esProporcion(c.sn) ? c.sn : null;
    const sp = esProporcion(c.sp) ? c.sp : null;
    if (sn === null && sp === null) continue;

    // La misma comprobación que a la cifra principal: los números tienen que
    // estar en la frase que el modelo dice haber copiado.
    if (!comprobarCita(c.citaLiteral, { sn, sp }).verificada) continue;
    // Y lo mismo que a la principal: ni una probabilidad de tener la patología,
    // ni una fila de tabla que no dice de qué test es.
    if (problemasDeCita(c.citaLiteral, { nombres, esAgrupacion }).length) continue;

    vistos.add(pmid);
    salida.push({
      pmid,
      titulo: articulo.titulo,
      revista: articulo.revista,
      anio: articulo.anio,
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      sn,
      sp,
      // Qué es cada artículo, para poder decir por qué se eligió el otro.
      tipoEstudio: TIPOS.has(c.tipoEstudio) ? c.tipoEstudio : null,
      numeroEstudios: Number.isFinite(c.numeroEstudios) && c.numeroEstudios > 0 ? c.numeroEstudios : null,
      // Qué mide: la misma entidad, o un subgrupo o una parecida. Dos cifras
      // que responden a preguntas distintas no se comparan como si
      // discreparan. Si el modelo no lo dice, se da por la misma.
      mismaEntidad: c.mismaEntidad !== false,
      entidadDeLasCifras: c.mismaEntidad === false && c.entidadDeLasCifras ? String(c.entidadDeLasCifras) : null,
      // Si los dos miden una parte, si es la misma: solo entonces se comparan.
      mismaParteQueElCitado: c.mismaEntidad === false && c.mismaParteQueElElegido === true,
      citaLiteral: String(c.citaLiteral || ""),
    });
  }

  return salida;
}

/**
 * ¿Mide esta fuente lo mismo que la citada? Si la citada mide la entidad
 * entera, las que también la miden entera; si mide una parte, las que miden esa
 * misma parte. Lo demás responde a otra pregunta, y compararlo haría pasar por
 * desacuerdo lo que no lo es.
 */
export function comparableConCitado(otra, principal) {
  if (principal?.indirecta) return otra?.mismaEntidad === false && otra?.mismaParteQueElCitado === true;
  return otra?.mismaEntidad !== false;
}

/**
 * Entre qué valores se mueve cada cifra contando todas las fuentes.
 *
 * Solo tiene sentido si hay más de un valor: con uno no hay rango que enseñar,
 * hay una cifra, y decir "entre 0,77 y 0,77" sería ruido.
 */
export function rangoPublicado({ principal, otras }) {
  // Solo las que miden lo mismo que la citada: una parte abriría un rango que no es tal.
  const reunir = (campo) =>
    [principal?.[campo], ...(otras || []).filter((o) => comparableConCitado(o, principal)).map((o) => o[campo])]
      .filter(esProporcion);

  const tramo = (campo) => {
    const valores = reunir(campo);
    if (valores.length < 2) return null;
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    return min === max ? null : { min, max, estudios: valores.length };
  };

  return { sn: tramo("sn"), sp: tramo("sp") };
}
