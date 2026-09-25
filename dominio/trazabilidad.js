// Comprobación de que la cifra publicada está de verdad en el texto citado.
//
// El modelo devuelve, además de las cifras, la frase literal del artículo de
// donde las sacó. Aquí se comprueba programáticamente que los números aparecen
// en esa frase. No demuestra que la interpretación sea correcta, pero atrapa el
// fallo más grave posible: una cifra que no está en ninguna parte.
//
// No se rechaza el dato cuando falla, porque la cifra puede estar en una tabla o
// escrita con palabras. Se marca, y la auditoría enseña primero las marcadas.

/** Formas en que un artículo puede escribir una proporción. */
function variantes(x) {
  const pct = x * 100;
  const formas = [
    x.toFixed(2),
    x.toFixed(3).replace(/0$/, ""),
    String(x),
    pct.toFixed(0),
    pct.toFixed(1),
    pct.toFixed(2).replace(/0$/, ""),
  ];
  // Los artículos usan indistintamente punto y coma decimal.
  return [...new Set(formas.flatMap((f) => [f, f.replace(".", ",")]))].filter((f) => f.length > 1);
}

/**
 * @returns {{verificada: boolean, encontradas: string[], ausentes: string[]}}
 */
export function comprobarCita(cita, { sn, sp }) {
  const texto = String(cita || "");
  if (!texto.trim()) {
    return { verificada: false, encontradas: [], ausentes: ["no se aportó cita literal"] };
  }

  const encontradas = [];
  const ausentes = [];

  for (const [nombre, valor] of [["sensibilidad", sn], ["especificidad", sp]]) {
    if (typeof valor !== "number") continue;
    const hallada = variantes(valor).some((v) => texto.includes(v));
    (hallada ? encontradas : ausentes).push(nombre);
  }

  return { verificada: ausentes.length === 0 && encontradas.length > 0, encontradas, ausentes };
}

/**
 * ¿Da la frase una probabilidad de tener la patología, y no la precisión del
 * test? "98% chance of having a rotator cuff tear" es lo que pasa después de
 * un positivo, no la sensibilidad. En la agrupación de Park se leyó como tal.
 */
export function esProbabilidadNoPrecision(cita) {
  const texto = String(cita || "");
  const probabilidad = /\bchance\b|probabilit|predictive value|\bPPV\b|\bNPV\b|post-?test|likelihood of having|odds of having/i;
  const precision = /sensitiv|specificit|\bSn\b|\bSp\b|\bSe\b|\bSens?\b|\bSpec\b/i;
  return probabilidad.test(texto) && !precision.test(texto);
}

// Palabras que no identifican un test: están en el nombre de casi todos.
const VACIAS = new Set([
  "test", "tests", "sign", "signo", "signe", "prueba", "maniobra", "maneuver", "manoeuvre",
  "the", "of", "and", "de", "del", "la", "el", "los", "las", "y",
]);

const normalizarTexto = (t) =>
  String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * ¿Nombra la frase el test? Vale el nombre, una palabra que lo identifique
 * ("Hawkins", "Jobe", "painful arc") o su abreviatura ("ERLS", "DAT"). Una fila
 * de tabla que solo trae números —"SN (%) 62.1 34.5 75.9…"— no dice de qué
 * test es cada columna, y nadie puede comprobar que la cifra sea la suya.
 */
export function nombraElTest(cita, nombres) {
  const palabras = new Set(normalizarTexto(cita).split(" ").filter(Boolean));
  if (!palabras.size) return false;
  return (nombres || []).some((nombre) => {
    const todas = normalizarTexto(nombre).split(" ").filter(Boolean);
    const utiles = todas.filter((p) => p.length >= 3 && !VACIAS.has(p));
    if (utiles.some((p) => palabras.has(p))) return true;
    const siglas = [todas, todas.filter((p) => !VACIAS.has(p))]
      .map((ps) => ps.map((p) => p[0]).join(""))
      .filter((s) => s.length >= 2);
    return siglas.some((s) => palabras.has(s));
  });
}

/**
 * Por qué no se puede publicar una cifra con esta frase, o una lista vacía si
 * se puede. Una agrupación no tiene un nombre que buscar en la frase: la
 * describe ("when all three were positive"), así que ahí no se exige.
 */
export function problemasDeCita(cita, { nombres = [], esAgrupacion = false } = {}) {
  const problemas = [];
  if (esProbabilidadNoPrecision(cita)) {
    problemas.push(
      "La frase citada da una probabilidad de tener la patología o un valor predictivo, no la sensibilidad ni la especificidad del test.",
    );
  }
  if (!esAgrupacion && nombres.length && !nombraElTest(cita, nombres)) {
    problemas.push(
      "La frase citada no nombra el test, así que no se puede comprobar que esas cifras sean suyas: por ejemplo, una fila de tabla con números y sin el nombre del test.",
    );
  }
  return problemas;
}
