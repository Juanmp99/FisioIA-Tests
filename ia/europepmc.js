// Europe PMC, usado como buscador y no como repositorio.
//
// La diferencia con PubMed no es el catálogo: es dónde busca. PubMed indexa
// título, resumen y descriptores MeSH, así que un test solo aparece si el
// resumen lo nombra. Europe PMC busca además dentro del cuerpo del artículo, y
// las cifras de precisión de un test concreto viven casi siempre en una tabla
// de resultados que el resumen nunca menciona.
//
// Medido sobre los tests de nuestra propia auditoría, la diferencia entre
// buscar solo en el resumen y buscar también en el cuerpo:
//
//     Thessaly test        11  ->  56
//     drop arm test        12  ->  70
//     flick sign            2  ->  35
//
// Lo que NO resuelve es descargar el texto completo. De los dieciocho artículos
// que sostienen hoy la base, ocho constan en Europe PMC pero solo cuatro
// devuelven el XML: el resto están indexados, no abiertos. Por eso esto es un
// buscador de candidatos y la lectura del artículo entero sigue donde estaba.

const BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

/** Lo que tiene que decir un artículo para que valga la pena mirarlo. */
const PRECISION = '("diagnostic accuracy" OR "sensitivity and specificity" OR "likelihood ratio" OR "predictive value" OR (sensitivity AND specificity))';

/** Los apóstrofes y las comillas rompen la sintaxis de consulta. */
const limpiar = (s) => String(s).replace(/['’]s\b/g, "").replace(/[()'"’]/g, " ").replace(/\s+/g, " ").trim();

const frase = (terminos) => {
  const utiles = [...new Set((terminos || []).map(limpiar).filter(Boolean))];
  if (!utiles.length) return "";
  if (utiles.length === 1) return `"${utiles[0]}"`;
  return `(${utiles.map((t) => `"${t}"`).join(" OR ")})`;
};

/**
 * Señales de que un artículo es un estudio de precisión diagnóstica, y de que
 * no lo es.
 *
 * Hacen falta porque la API de Europe PMC no ordena por relevancia: su único
 * orden es por fecha, y las primeras posiciones se llenan de técnicas
 * quirúrgicas recién publicadas que mencionan el test de pasada. Ordenar aquí
 * es más barato que pagar la extracción de seis artículos que no van a dar
 * ninguna cifra.
 */
const DIAGNOSTICO = /sensitivit|specificit|diagnostic accuracy|diagnostic value|diagnostic performance|predictive value|likelihood ratio|diagnos(is|ing)|validity/i;
const EXPLORACION = /physical examination|clinical examination|clinical test|provocative|special test|physical test/i;
const SINTESIS = /systematic review|meta-analys/i;
const TRATAMIENTO = /repair|reconstruction|arthroscop|surgical technique|injection|rehabilitation|treatment of|management of|outcomes after|postoperative/i;

/**
 * Cuánto promete un artículo, juzgado por su título y su resumen.
 *
 * Deliberadamente no puntúa que el nombre del test aparezca en el título o en
 * el resumen. Eso sería premiar justo lo que PubMed ya encuentra, y el motivo
 * de venir aquí es el contrario: el artículo que interesa es el que estudia la
 * exploración física entera y publica el test en una tabla de resultados que el
 * resumen no menciona. Que el test esté en algún sitio del artículo ya lo
 * garantiza la consulta.
 */
export function promete(articulo) {
  const titulo = articulo.title || "";
  const resumen = articulo.abstractText || "";
  let puntos = 0;
  if (DIAGNOSTICO.test(titulo)) puntos += 3;
  if (DIAGNOSTICO.test(resumen)) puntos += 1;
  if (EXPLORACION.test(titulo) || EXPLORACION.test(resumen)) puntos += 2;
  if (SINTESIS.test(titulo)) puntos += 2;
  if (TRATAMIENTO.test(titulo) && !DIAGNOSTICO.test(titulo)) puntos -= 3;
  return puntos;
}

/**
 * PMIDs de artículos que mencionan el test y la entidad y publican cifras de
 * precisión, buscando también dentro del cuerpo.
 *
 * Devuelve PMIDs a propósito, y no los artículos: así el que los pida los trae
 * por el mismo camino que los de PubMed y la ficha que llega a la extracción es
 * idéntica venga de donde venga. Los resultados sin PMID (preprints, actas) se
 * descartan por eso mismo.
 *
 * Un fallo aquí no es un fallo de la búsqueda: devuelve lista vacía y el
 * resultado se queda con lo que diera PubMed.
 */
export async function buscarCuerpoCompleto({ nombresTest, terminos, limite = 5, senal }) {
  const test = frase(nombresTest);
  const entidad = frase(terminos);
  if (!test) return [];

  const consulta = [test, entidad, PRECISION].filter(Boolean).join(" AND ");
  // Se piden muchos más de los que se van a usar porque los que llegan
  // ordenados por fecha hay que reordenarlos antes de quedarse con la cabeza.
  const url = `${BASE}?query=${encodeURIComponent(consulta)}&format=json&pageSize=25&resultType=core`;

  try {
    const respuesta = await fetch(url, { signal: senal });
    if (!respuesta.ok) return [];
    const datos = await respuesta.json();
    return (datos?.resultList?.result ?? [])
      .filter((r) => typeof r.pmid === "string" && /^\d+$/.test(r.pmid))
      .map((r) => ({ pmid: r.pmid, puntos: promete(r) }))
      .filter((r) => r.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
      .slice(0, limite)
      .map((r) => r.pmid);
  } catch {
    return [];
  }
}
