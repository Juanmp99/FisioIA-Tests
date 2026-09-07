// Razonamiento probabilístico del producto. Aquí no interviene ningún modelo de
// lenguaje: son operaciones cerradas sobre números que vienen de la literatura.
// Si algo de esto falla, falla la conclusión clínica, así que va aparte y con
// pruebas propias.

/**
 * Traducción de la sospecha del fisioterapeuta a probabilidad pre-test.
 *
 * Los valores son una convención, no un dato de la literatura, y por eso se
 * muestran siempre en la interfaz: el fisioterapeuta tiene que saber qué está
 * afirmando cuando marca "media". Se eligen dentro de los rangos que se usan
 * habitualmente al enseñar razonamiento clínico.
 */
export const PRE_TEST = {
  baja: { valor: 0.15, etiqueta: "Sospecha baja", detalle: "en torno al 15%" },
  media: { valor: 0.45, etiqueta: "Sospecha media", detalle: "en torno al 45%" },
  alta: { valor: 0.75, etiqueta: "Sospecha alta", detalle: "en torno al 75%" },
};

/** Tolerancia relativa al comprobar la coherencia entre Sn, Sp y las razones de verosimilitud. */
const TOLERANCIA = 0.15;

const esProporcion = (x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1;

/** Razones de verosimilitud derivadas de sensibilidad y especificidad. */
export function razonesDeVerosimilitud(sn, sp) {
  return {
    positiva: sn / (1 - sp),
    negativa: (1 - sn) / sp,
  };
}

/**
 * Detector de extracciones erróneas.
 *
 * Sn, Sp, LR+ y LR- no son cuatro datos independientes: LR+ = Sn/(1-Sp) y
 * LR- = (1-Sn)/Sp. Si un artículo publica los cuatro y no cumplen la identidad,
 * o alguien los ha extraído mal o no corresponden al mismo test. En ambos casos
 * el dato se rechaza en lugar de publicarse.
 *
 * Es la única defensa automática que tenemos, porque no hay revisión humana.
 */
export function validarPrecision({ sn, sp, lrPositiva, lrNegativa }) {
  const problemas = [];

  if (!esProporcion(sn)) problemas.push("La sensibilidad no es una proporción entre 0 y 1.");
  if (!esProporcion(sp)) problemas.push("La especificidad no es una proporción entre 0 y 1.");
  if (problemas.length) return { valido: false, problemas };

  const esperada = razonesDeVerosimilitud(sn, sp);

  const discrepa = (declarada, calculada) =>
    typeof declarada === "number" &&
    Number.isFinite(declarada) &&
    Math.abs(declarada - calculada) / calculada > TOLERANCIA;

  if (discrepa(lrPositiva, esperada.positiva)) {
    problemas.push(
      `La razón de verosimilitud positiva declarada (${lrPositiva}) no concuerda con la que se deduce de sensibilidad y especificidad (${esperada.positiva.toFixed(2)}).`,
    );
  }
  if (discrepa(lrNegativa, esperada.negativa)) {
    problemas.push(
      `La razón de verosimilitud negativa declarada (${lrNegativa}) no concuerda con la que se deduce de sensibilidad y especificidad (${esperada.negativa.toFixed(2)}).`,
    );
  }

  if (typeof lrPositiva === "number" && lrPositiva < 1) {
    problemas.push("Una razón de verosimilitud positiva menor que 1 invertiría el significado del test.");
  }
  if (typeof lrNegativa === "number" && lrNegativa > 1) {
    problemas.push("Una razón de verosimilitud negativa mayor que 1 invertiría el significado del test.");
  }

  return { valido: problemas.length === 0, problemas };
}

/**
 * Comprobación para cuando solo se ha publicado una de las dos cifras.
 * No hay identidad que verificar: únicamente que lo que hay esté en rango.
 */
export function validarParcial({ sn, sp }) {
  const problemas = [];
  if (sn != null && !esProporcion(sn)) problemas.push("La sensibilidad no es una proporción entre 0 y 1.");
  if (sp != null && !esProporcion(sp)) problemas.push("La especificidad no es una proporción entre 0 y 1.");
  if (sn == null && sp == null) problemas.push("No hay ninguna cifra que validar.");
  return { valido: problemas.length === 0, problemas };
}

/** Probabilidad posterior tras aplicar una razón de verosimilitud, vía odds. */
export function postTest(pre, lr) {
  const odds = pre / (1 - pre);
  const post = odds * lr;
  return post / (1 + post);
}

/**
 * Magnitud del cambio que aporta un resultado.
 *
 * Bandas de uso extendido en medicina basada en la evidencia: por encima de 10
 * y por debajo de 0,1 el cambio es concluyente; cerca de 1 el test no aporta
 * nada. Sirven para avisar de que un test muy usado puede ser inútil.
 */
export function magnitud(lr) {
  const fuerza = lr >= 1 ? lr : 1 / lr;
  if (fuerza >= 10) return { nivel: "concluyente", texto: "cambio grande y con frecuencia concluyente" };
  if (fuerza >= 5) return { nivel: "moderado", texto: "cambio moderado" };
  if (fuerza >= 2) return { nivel: "pequeno", texto: "cambio pequeño" };
  return { nivel: "irrelevante", texto: "cambio mínimo: este resultado apenas modifica la sospecha" };
}

/** Umbrales a partir de los cuales hablamos de confirmar o descartar en la práctica. */
const UMBRAL_CONFIRMA = 0.85;
const UMBRAL_DESCARTA = 0.10;

const pct = (p) => Math.round(p * 100);

/**
 * Interpreta un resultado concreto.
 *
 * Devuelve las dos capas que pidió el producto: una lectura directa para quien
 * solo quiere saber qué hacer, y el detalle numérico para quien lo quiera ver.
 */
export function interpretar({ nivelPreTest, sn, sp, resultado }) {
  const base = PRE_TEST[nivelPreTest];
  if (!base) throw new Error(`Nivel de sospecha desconocido: ${nivelPreTest}`);

  const validacion = validarPrecision({ sn, sp });
  if (!validacion.valido) {
    return { interpretable: false, problemas: validacion.problemas };
  }

  const lrs = razonesDeVerosimilitud(sn, sp);
  const positivo = resultado === "positivo";
  const lr = positivo ? lrs.positiva : lrs.negativa;
  const pre = base.valor;
  const post = postTest(pre, lr);
  const fuerza = magnitud(lr);

  let lectura;

  // El orden importa. Un test que no aporta nada puede dejar la probabilidad por
  // encima del umbral de confirmación si la sospecha previa ya era alta, y
  // entonces diríamos "confirma" cuando quien confirmaba era el propio
  // fisioterapeuta. Comprobar primero si el test aporta evita atribuirle un
  // mérito que no tiene.
  if (fuerza.nivel === "irrelevante") {
    lectura =
      `Este resultado apenas cambia la sospecha, que sigue en torno al ${pct(post)}%. ` +
      "No decidas en función de él.";
  } else if (positivo && post >= UMBRAL_CONFIRMA) {
    lectura = "Confirma la sospecha a efectos prácticos.";
  } else if (!positivo && post <= UMBRAL_DESCARTA) {
    lectura = "Descarta la sospecha a efectos prácticos.";
  } else if (positivo) {
    lectura = `Refuerza la sospecha, pero no la confirma: quedaría en torno al ${pct(post)}%.`;
  } else {
    lectura = `Debilita la sospecha, pero no la descarta: quedaría en torno al ${pct(post)}%.`;
  }

  return {
    interpretable: true,
    resultado,
    lectura,
    detalle: {
      preTest: pre,
      preTestTexto: `${base.etiqueta}, ${base.detalle}`,
      razonDeVerosimilitud: lr,
      cual: positivo ? "positiva" : "negativa",
      postTest: post,
      postTestTexto: `${pct(post)}%`,
      magnitud: fuerza,
      sensibilidad: sn,
      especificidad: sp,
    },
  };
}
