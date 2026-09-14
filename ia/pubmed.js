// Acceso a PubMed mediante E-utilities. Es gratuito y no requiere clave, pero
// limita a unas tres peticiones por segundo, así que las llamadas van en serie
// con una pausa entre ellas.
//
// El XML se lee con expresiones regulares sobre los campos que necesitamos en
// lugar de con un analizador completo. Es una simplificación consciente: el
// esquema de PubMed es estable y solo extraemos seis campos. Si algún día
// hiciera falta más, toca traer un analizador de verdad.

import { buscarCuerpoCompleto } from "./europepmc.js";

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const PAUSA = 350;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, senal) {
  const respuesta = await fetch(url, { signal: senal });
  if (!respuesta.ok) throw new Error(`PubMed respondió ${respuesta.status}`);
  return respuesta;
}

function entidades(texto) {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const sinEtiquetas = (s) => entidades(s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

function extraerArticulos(xml) {
  const bloques = xml.split("<PubmedArticle>").slice(1);

  return bloques.map((b) => {
    const uno = (re) => {
      const m = b.match(re);
      return m ? sinEtiquetas(m[1]) : "";
    };

    // El resumen puede venir troceado en secciones etiquetadas.
    const partes = [...b.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => {
      const etiqueta = m[0].match(/Label="([^"]+)"/);
      const cuerpo = sinEtiquetas(m[1]);
      return etiqueta ? `${etiqueta[1]}: ${cuerpo}` : cuerpo;
    });

    return {
      pmid: uno(/<PMID[^>]*>(\d+)<\/PMID>/),
      titulo: uno(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/),
      revista: uno(/<Title>([\s\S]*?)<\/Title>/),
      anio: uno(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/) || uno(/<DateCompleted><Year>(\d{4})<\/Year>/),
      tipos: [...b.matchAll(/<PublicationType[^>]*>([\s\S]*?)<\/PublicationType>/g)].map((m) => sinEtiquetas(m[1])),
      resumen: partes.join("\n"),
    };
  });
}

async function buscarIds(termino, limite, senal) {
  const url = `${BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(termino)}&retmax=${limite}&retmode=json&sort=relevance`;
  const datos = await (await pedir(url, senal)).json();
  return datos?.esearchresult?.idlist ?? [];
}

async function traer(ids, senal) {
  if (!ids.length) return [];
  const url = `${BASE}/efetch.fcgi?db=pubmed&id=${ids.join(",")}&retmode=xml`;
  const xml = await (await pedir(url, senal)).text();
  return extraerArticulos(xml);
}

/**
 * Cuántos artículos se leen por test.
 *
 * Eran seis, y la auditoría dijo por qué se quedaban cortos: seis de cada diez
 * tests acababan sin ninguna cifra. Con quince hay muchas más papeletas de que
 * alguno publique sensibilidad y especificidad juntas. Cuesta un céntimo más de
 * extracción por test y no añade ni una petición a PubMed: caben en la misma.
 *
 * Los huecos reservados a revisiones suben en la misma proporción, porque son
 * las únicas que pueden dar un semáforo verde.
 */
const ARTICULOS_MAX = 15;
const REVISIONES_MAX = 6;

/**
 * Cuántos de esos quince puede ocupar la búsqueda en el cuerpo del artículo.
 *
 * Cinco, y no más, porque lo que aporta Europe PMC es cobertura y no criterio:
 * su API no ordena por relevancia, solo por fecha, y lo que llega arriba hay
 * que reordenarlo aquí. Cinco huecos bastan para colar el estudio que PubMed no
 * ve sin arriesgar los diez primeros, que vienen ya ordenados por relevancia.
 */
const CUERPO_COMPLETO_MAX = 5;

const ACCURACY = '(sensitivity OR specificity OR "diagnostic accuracy" OR "likelihood ratio")';
const REVISIONES = '(systematic[sb] OR meta-analysis[pt] OR "systematic review"[pt])';

/** Los apóstrofes y paréntesis rompen la sintaxis de búsqueda de PubMed. */
const limpiar = (s) => String(s).replace(/['’]s\b/g, "").replace(/[()'"’]/g, " ").replace(/\s+/g, " ").trim();

/** Varios sinónimos combinados con OR, para entidades y para tests. */
function clausulaOr(terminos) {
  const utiles = [...new Set((terminos || []).map(limpiar).filter(Boolean))];
  if (!utiles.length) return "";
  if (utiles.length === 1) return `"${utiles[0]}"`;
  return `(${utiles.map((t) => `"${t}"`).join(" OR ")})`;
}

/**
 * Busca literatura de precisión diagnóstica para un test aplicado a una entidad.
 *
 * Dos ideas gobiernan esta función, y las dos salieron de encontrarnos con cero
 * resultados donde sí había literatura.
 *
 * La primera es que tanto la entidad como el test se buscan con varios sinónimos
 * a la vez. El término clínicamente correcto y el más indexado suelen ser
 * distintos: "lateral epicondylitis" tiene quince veces más artículos que
 * "lateral epicondylalgia". Con los tests pasa igual y durante un tiempo se nos
 * escapó: "Jobe test", "empty can test" y "supraspinatus test" son el mismo
 * test, cada artículo elige uno, y buscando por uno solo se perdían los demás.
 *
 * La segunda es el ensanchado progresivo. Se empieza por la consulta más
 * específica y, solo si no devuelve nada, se van soltando restricciones. Filtrar
 * de más no protege de nada: el control de calidad está después, en la extracción
 * y en el semáforo. Aquí lo único que importa es no perder el artículo bueno.
 */
export async function buscarPrecision({ test, nombresTest, terminos, senal }) {
  const nombres = [test, ...(Array.isArray(nombresTest) ? nombresTest : [])];
  const lista = Array.isArray(terminos) ? terminos : [terminos];
  const t = clausulaOr(nombres);
  const entidad = clausulaOr(lista);

  // Europe PMC busca dentro del cuerpo del artículo, que es donde vive la tabla
  // de resultados con las cifras de cada test. Se lanza a la vez que la primera
  // consulta a PubMed y se recoge al final, así que no cuesta tiempo. Sus
  // hallazgos ocupan huecos que ya estaban pagados, no artículos de más: el
  // total que se manda a extraer sigue siendo ARTICULOS_MAX.
  const deCuerpoCompleto = buscarCuerpoCompleto({
    nombresTest: nombres,
    terminos: lista,
    limite: CUERPO_COMPLETO_MAX,
    senal,
  });

  const estrategias = [
    { id: "especifica", termino: `${t} AND ${entidad} AND ${ACCURACY}` },
    { id: "sin_filtro_precision", termino: `${t} AND ${entidad}` },
    { id: "solo_test", termino: `${t} AND ${ACCURACY}` },
  ];

  for (const estrategia of estrategias) {
    const revisiones = await buscarIds(`${estrategia.termino} AND ${REVISIONES}`, REVISIONES_MAX, senal);
    await esperar(PAUSA);

    const generales = (await buscarIds(estrategia.termino, ARTICULOS_MAX, senal)).filter((id) => !revisiones.includes(id));
    await esperar(PAUSA);

    // El ensanchado se decide con lo que encuentra PubMed y solo con eso. Si
    // contara también lo del cuerpo, una consulta demasiado estrecha que Europe
    // PMC salvara por los pelos se daría por buena y la escalera no llegaría a
    // soltar la restricción que sobraba.
    if (!revisiones.length && !generales.length) continue;

    const cuerpo = await deCuerpoCompleto;

    // Las revisiones primero, porque son las únicas que pueden dar verde.
    // Después lo que aportó la búsqueda en el cuerpo, que desplaza a los
    // últimos resultados de PubMed y no a los primeros: si algo sobra de una
    // lista ordenada por relevancia, es la cola.
    const ids = [...new Set([...revisiones, ...cuerpo, ...generales])].slice(0, ARTICULOS_MAX);

    const articulos = await traer(ids, senal);
    const porId = new Map(articulos.map((a) => [a.pmid, a]));
    const aportados = cuerpo.filter((id) => ids.includes(id) && !revisiones.includes(id) && !generales.includes(id));

    return {
      articulos: ids.map((id) => porId.get(id)).filter(Boolean),
      estrategia: estrategia.id,
      deCuerpoCompleto: aportados.length,
    };
  }

  // Si PubMed no dio nada por ninguna de las tres vías, todavía queda lo que
  // encontró la búsqueda en el cuerpo: es el caso para el que más falta hace.
  const cuerpo = await deCuerpoCompleto;
  if (cuerpo.length) {
    const articulos = await traer(cuerpo, senal);
    if (articulos.length) {
      return { articulos, estrategia: "solo_cuerpo_completo", deCuerpoCompleto: articulos.length };
    }
  }

  return { articulos: [], estrategia: "sin_resultados", deCuerpoCompleto: 0 };
}

export function urlPubmed(pmid) {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}
