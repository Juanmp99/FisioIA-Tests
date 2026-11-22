// Comprobación de que una agrupación es la que decimos que es.
//
// Una agrupación no es un test con nombre largo: son unos tests concretos
// combinados bajo una regla concreta, y sus cifras solo valen para esa
// combinación y esa regla. "Dos de estos tres positivos" y "los tres positivos"
// son pruebas distintas con especificidades muy distintas.
//
// Hasta ahora bastaba con que la búsqueda devolviese cifras para algo que se
// llamara parecido, y la interfaz lo etiquetaba como AGRUPACIÓN VALIDADA sin
// que nadie hubiera comprobado que el artículo combinaba esos tests ni exigía
// ese número de positivos. Eso es prometer más de lo comprobado, que en una
// herramienta clínica es la única clase de error que no se puede permitir.
//
// Comparar lo hace este módulo y no el modelo, a propósito: al modelo se le
// piden los componentes tal como los nombra el artículo, sin enseñarle la
// propuesta, y el careo es después y determinista.

/**
 * Los nombres de los tests no coinciden nunca literalmente. El artículo dice
 * "joint line tenderness", la batería dice "Palpación de la interlínea
 * articular", y un tercero dice "Jobe" donde otro dice "empty can". Comparar
 * cadenas sin más daría discrepancias falsas todo el rato.
 */
const SINONIMOS = [
  ["joint line tenderness", "interlinea articular", "interlinea", "palpacion de la interlinea"],
  ["mcmurray", "mc murray"],
  ["apley", "apley compression", "apley grinding", "grinding"],
  ["thessaly"],
  ["ege", "eges"],
  ["empty can", "jobe", "supraspinatus test"],
  ["full can"],
  ["neer"],
  ["hawkins", "hawkins kennedy"],
  ["painful arc", "arco doloroso"],
  ["drop arm", "brazo caido"],
  ["phalen"],
  ["tinel", "hoffmann tinel"],
  ["durkan", "carpal compression", "compresion del carpo"],
  ["lachman"],
  ["cajon anterior", "anterior drawer"],
  ["pivot shift"],
  ["forced flexion", "flexion forzada", "pain with forced flexion"],
];

/** Sin tildes, sin puntuación, sin la palabra "test", en minúsculas. */
export function normalizar(nombre) {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(test|sign|signo|maniobra|prueba|de|del|la|el|of|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La familia de sinónimos a la que pertenece un nombre, o el nombre mismo. */
function familia(nombre) {
  const n = normalizar(nombre);
  if (!n) return "";
  for (const grupo of SINONIMOS) {
    for (const alias of grupo) {
      const a = normalizar(alias);
      if (a && (n === a || n.includes(a) || a.includes(n))) return grupo[0];
    }
  }
  return n;
}

/** ¿Son el mismo test, aunque se llamen distinto? */
export function mismoTest(a, b) {
  const fa = familia(a);
  const fb = familia(b);
  return Boolean(fa) && fa === fb;
}

/**
 * ¿Sostiene el artículo la agrupación que estamos mostrando?
 *
 * Devuelve el careo completo y no un sí o un no, porque lo que el
 * fisioterapeuta necesita ver no es un sello sino en qué se parecen y en qué no
 * la agrupación propuesta y la que midió el artículo.
 *
 * @param {string[]} propuestos  Tests de la agrupación tal como se le muestran.
 * @param {string[]} delArticulo Tests que el artículo dice combinar.
 * @param {string}   criterio    Regla que el artículo dice aplicar.
 * @param {string[]} bateria     Nombres de los tests de la batería, para
 *                               enseñar cada componente como se llama abajo.
 */
export function comprobarAgrupacion({ propuestos, delArticulo, criterio, bateria }) {
  const mios = (propuestos || []).filter(Boolean);
  const suyos = (delArticulo || []).filter(Boolean);

  // Ver "Joint line tenderness" en la agrupación y "Palpación de la interlínea
  // articular" en la batería parecen dos pruebas distintas, y son una. El careo
  // se hace aquí, con la misma tabla de sinónimos que todo lo demás, para que
  // no haya una segunda copia en el navegador.
  const equivalencias = mios.map((m) => ({
    propuesto: m,
    enBateria: (bateria || []).find((b) => mismoTest(m, b)) || null,
  }));

  // El artículo no enumera lo que combina: no hay nada que comparar, y decir
  // que coincide sería inventárselo.
  if (suyos.length < 2) {
    return {
      descrita: false,
      coincide: false,
      motivo: "El artículo publica cifras para una exploración combinada, pero no enumera qué tests la componen.",
      delArticulo: suyos,
      criterio: criterio || "",
      faltan: [],
      sobran: [],
      equivalencias,
    };
  }

  const faltan = mios.filter((m) => !suyos.some((s) => mismoTest(m, s)));
  const sobran = suyos.filter((s) => !mios.some((m) => mismoTest(m, s)));
  const sinCriterio = !criterio || !String(criterio).trim();

  const coincide = !faltan.length && !sobran.length && !sinCriterio;

  let motivo = "";
  if (coincide) {
    motivo = "El artículo mide esta misma combinación de tests y dice con qué regla la da por positiva.";
  } else if (sinCriterio && !faltan.length && !sobran.length) {
    motivo = "El artículo mide estos mismos tests, pero no dice cuántos positivos hacen falta para darla por positiva.";
  } else {
    const partes = [];
    if (sobran.length) partes.push(`incluye ${sobran.join(", ")}`);
    if (faltan.length) partes.push(`no incluye ${faltan.join(", ")}`);
    motivo = `Las cifras son de otra combinación: el artículo ${partes.join(" y ")}.`;
  }

  return { descrita: true, coincide, motivo, delArticulo: suyos, criterio: criterio || "", faltan, sobran, equivalencias };
}
