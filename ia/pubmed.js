// Acceso a PubMed mediante E-utilities. Es gratuito y no requiere clave, pero
// limita a unas tres peticiones por segundo, así que las llamadas van en serie
// con una pausa entre ellas.
//
// El XML se lee con expresiones regulares sobre los campos que necesitamos en
// lugar de con un analizador completo. Es una simplificación consciente: el
// esquema de PubMed es estable y solo extraemos seis campos. Si algún día
// hiciera falta más, toca traer un analizador de verdad.

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
  const t = clausulaOr([test, ...(Array.isArray(nombresTest) ? nombresTest : [])]);
  const entidad = clausulaOr(Array.isArray(terminos) ? terminos : [terminos]);

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

    const ids = [...revisiones, ...generales].slice(0, ARTICULOS_MAX);
    if (!ids.length) continue;

    const articulos = await traer(ids, senal);
    const porId = new Map(articulos.map((a) => [a.pmid, a]));

    // Se conserva el orden de la búsqueda: las revisiones primero.
    return {
      articulos: ids.map((id) => porId.get(id)).filter(Boolean),
      estrategia: estrategia.id,
    };
  }

  return { articulos: [], estrategia: "sin_resultados" };
}

export function urlPubmed(pmid) {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}
