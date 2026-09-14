// Texto completo desde PubMed Central.
//
// Por qué existe: un resumen de PubMed casi nunca publica los intervalos de
// confianza de cada cifra, ni da detalle metodológico suficiente para juzgar el
// riesgo de sesgo. Y el semáforo exige las dos cosas para dar verde. El
// resultado era que ninguna evidencia llegaba nunca a verde, no porque la
// literatura fuera mala, sino porque le pedíamos al modelo juzgar un estudio
// leyendo solo la contraportada.
//
// Lo que falta suele estar en las tablas, y las tablas están en el texto
// completo. PubMed Central lo ofrece en abierto para una parte de la
// literatura: no para toda, así que esto mejora los casos que puede y deja los
// demás como estaban.

const BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

/** Tope de texto que se manda al modelo. Un artículo entero no cabe ni conviene. */
const TOPE = 26000;

async function pedir(url, senal) {
  const respuesta = await fetch(url, { signal: senal });
  if (!respuesta.ok) throw new Error(`PubMed Central respondió ${respuesta.status}`);
  return respuesta;
}

const entidades = (t) =>
  t
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const sinEtiquetas = (t) => entidades(String(t).replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();

/** PMCID de un artículo, si lo tiene. Muchos no están en PubMed Central. */
export async function pmcidDe(pmid, senal) {
  const url = `${BASE}/elink.fcgi?dbfrom=pubmed&db=pmc&id=${encodeURIComponent(pmid)}&retmode=json`;
  const datos = await (await pedir(url, senal)).json();

  const conjuntos = datos?.linksets?.[0]?.linksetdbs || [];
  for (const c of conjuntos) {
    if (c.linkname === "pubmed_pmc" && c.links?.length) return `PMC${c.links[0]}`;
  }
  return null;
}

/**
 * Las partes del artículo que sirven para lo que buscamos.
 *
 * Las tablas van primero y enteras: es donde viven las sensibilidades con sus
 * intervalos de confianza, que es justo lo que el resumen no trae. Después las
 * secciones de método y resultados. Lo demás solo si sobra sitio.
 */
function partesUtiles(xml) {
  const trozos = [];

  const tablas = [...xml.matchAll(/<table-wrap[\s\S]*?<\/table-wrap>/g)].map((m) => m[0]);
  for (const t of tablas) {
    const titulo = t.match(/<label[^>]*>([\s\S]*?)<\/label>/);
    const pie = t.match(/<caption[\s\S]*?<\/caption>/);
    trozos.push(
      `[TABLA${titulo ? " " + sinEtiquetas(titulo[1]) : ""}]\n` +
        (pie ? sinEtiquetas(pie[0]) + "\n" : "") +
        sinEtiquetas(t.replace(/<caption[\s\S]*?<\/caption>/, "")),
    );
  }

  const secciones = [...xml.matchAll(/<sec\b[\s\S]*?<\/sec>/g)].map((m) => m[0]);
  const interesa = /result|method|accuracy|diagnostic|quality|bias|statistic|analysis|assessment/i;

  const prioritarias = [];
  const resto = [];
  for (const s of secciones) {
    const titulo = s.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    const nombre = titulo ? sinEtiquetas(titulo[1]) : "";
    const cuerpo = `[${nombre.toUpperCase() || "SECCIÓN"}]\n${sinEtiquetas(s.replace(/<table-wrap[\s\S]*?<\/table-wrap>/g, " "))}`;
    (interesa.test(nombre) ? prioritarias : resto).push(cuerpo);
  }

  const todo = [...trozos, ...prioritarias, ...resto];

  let texto = "";
  for (const t of todo) {
    if (texto.length + t.length > TOPE) break;
    texto += t + "\n\n";
  }
  return texto.trim();
}

/**
 * Texto completo de un artículo, si PubMed Central lo sirve.
 * Devuelve null cuando no está en abierto, que es un desenlace normal.
 */
export async function textoCompleto(pmid, senal) {
  const pmcid = await pmcidDe(pmid, senal);
  if (!pmcid) return null;

  const url = `${BASE}/efetch.fcgi?db=pmc&id=${encodeURIComponent(pmcid.replace("PMC", ""))}&retmode=xml`;
  const xml = await (await pedir(url, senal)).text();

  // Sin cuerpo no hay nada que leer: pasa con los que solo tienen resumen
  // depositado, y con los que no son de acceso abierto.
  if (!/<body[\s>]/.test(xml)) return null;

  const texto = partesUtiles(xml);
  return texto.length > 600 ? { pmcid, texto } : null;
}
