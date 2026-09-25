// Explicaciones personalizadas de las cifras de un test.
//
// Es la única parte de la herramienta donde un modelo redacta algo clínico para
// que el fisioterapeuta lo lea, así que se le ata corto por dos lados:
//
//   1. Solo recibe los datos que ya están en la ficha (cifras, motivos, la frase
//      citada) y se le prohíbe añadir nada que no salga de ellos.
//   2. En pantalla va marcado como redactado con IA, separado de lo verificado.
//
// Hubo un tercero, un candado que comprobaba cada número y el tono después de
// redactar. Se quitó: descartaba más de lo que protegía y hacía esperar.
//
// Se genera una vez por test y patología y se guarda, como la evidencia: la
// misma pregunta da siempre la misma explicación, y solo se paga la primera.

import { leer, escribir } from "../lib/almacen.js";
import { pedirJson } from "./cliente.js";
import { interpretar, acotarParcial, pctMostrado, PRE_TEST, UMBRAL_CONFIRMA, UMBRAL_DESCARTA } from "../dominio/probabilidad.js";

const ALMACEN = "explicacion";

/** Se cambia al tocar el prompt, para no servir explicaciones escritas con otro. */
const VERSION = 11;

/**
 * En qué cifras se apoya una explicación.
 *
 * La clave de la explicación es la de la evidencia, así que al rehacer una
 * búsqueda —vaciando la caché, por ejemplo— la clave es la misma pero los
 * números pueden ser otros. Sin esto se serviría un texto escrito sobre las
 * cifras viejas junto a las nuevas: la ficha diría 0,45 y el texto de al lado,
 * 0,77. Guardando de qué cifras salió, se rehace sola cuando cambian.
 */
function huellaDe(ev) {
  return JSON.stringify(datosDe(ev, {}));
}


const SISTEMA = `Redactas aclaraciones muy breves para un fisioterapeuta que tiene a un paciente delante y está haciendo un test de exploración. Le explicas qué significan, para su paciente, unas cifras que ya ha visto.

Reglas, sin excepción:

1. Solo puedes usar los datos que te doy. No añadas NINGÚN hecho clínico que no salga de ellos: nada de anatomía, mecanismos lesionales, epidemiología, prevalencias, cómo se hace el test, qué otros tests conviene hacer, ni tratamientos. Si para decir algo necesitarías saber algo que no está en los datos, no lo digas.

2. No escribas ningún número que no esté en los datos. Puedes expresar una proporción como porcentaje (0,77 es 77%). No calcules nada nuevo.

3. Tu trabajo es traducir, no ampliar: convierte las cifras y los motivos en lo que implican en consulta para un paciente con esa sospecha. Nombra el test y la patología.

4. Cada campo, una o dos frases y como mucho 45 palabras. Español de España, tono sobrio y práctico. Sin tecnicismos: si usas uno, explícalo en la misma frase.

4 bis. Quien te lee es el fisioterapeuta, y el enfermo es un tercero. Tutéale a él y llama al enfermo "tu paciente": "aumenta la probabilidad de que tu paciente lo tenga", nunca "de que tengas" ni "tu lesión". Son correctos "tu sospecha", "tu paciente" y "el test que has hecho".

4 quater. Las dos cifras significan esto, y solo esto:
   - sensibilidad: de cada 100 personas que SÍ tienen la patología, cuántas dan positivo en el test;
   - especificidad: de cada 100 personas que NO tienen la patología, cuántas dan negativo.
   La especificidad nunca "confirma", "detecta" ni "acierta el diagnóstico": habla solo de quienes no tienen la patología. Y la sensibilidad habla solo de quienes sí la tienen.

4 quinquies. Revisa la ortografía antes de responder: "conviene", no "convine".

4 ter. Escribe las frases completas. Si dices "de cada 100 personas", ese 100 tiene que estar escrito; no empieces una frase contando sobre un total que no nombras.

5. Devuelve null SOLO cuando el dato no exista: indirecta si las cifras se midieron sobre la misma patología, parcial si constan las dos cifras. Si una cifra consta en los datos, su campo no puede quedarse vacío.

6. No hables de qué aporta un resultado positivo o negativo: eso se explica aparte, cuando se conoce la sospecha de partida.

7. En eleccion, como mucho 50 palabras, le cuentas al fisioterapeuta qué hacer con los otros estudios que también miden el test. Ya ha leído, justo encima, qué cifras usa el cálculo y la regla por la que se eligió el citado; no la repitas. Tu trabajo es decirle lo que se ve al compararlos en este caso concreto: si las cifras de los demás se parecen a las del citado o se alejan, en cuál de las dos (sensibilidad o especificidad), y qué implica eso para fiarse del resultado del test en su paciente. Si un estudio publica solo una de las dos cifras, dilo. Nunca inventes un motivo de elección que no esté en los datos, y no sugieras mezclar ni promediar cifras de estudios distintos.

7 quater. Si otro estudio no mide la misma patología (mideLaMismaPatologia en falso), sino un subgrupo o una entidad parecida (queMide), no presentes la diferencia de cifras como un desacuerdo entre estudios: dilo tal cual, que ese estudio responde a otra pregunta y por eso sus cifras no son directamente comparables.

7 ter. Que las cifras se parezcan no demuestra mayor certeza ni validación independiente: un estudio primario puede estar incluido en la revisión citada. Describe la similitud sin afirmar que refuerza la confianza en el resultado de este paciente ni cambiar la calidad asignada.

7 bis. Compara cada cifra solo con la misma cifra del otro estudio, y solo si los dos la publican. Cada estudio trae en cifrasQueNoPublica las que le faltan: con esas no hay comparación posible. Si el citado no publica la especificidad y el otro sí, no digas que la del otro es más alta ni más baja: di que solo el otro la publica. Nunca agrupes las dos cifras de un estudio en una sola comparación ("sus cifras son más altas") salvo que el otro publique también las dos.`;

const campo = (descripcion) => ({ type: ["string", "null"], description: descripcion });

const ESQUEMA = {
  type: "object",
  properties: {
    sensibilidad: campo("Qué implica esta sensibilidad para un paciente con esta sospecha."),
    especificidad: campo("Qué implica esta especificidad para un paciente con esta sospecha."),
    calidad: campo("Qué implica la calidad del estudio para fiarse de estas cifras en este caso."),
    indirecta: campo("Qué implica que las cifras se midieran en otra patología. Null si no es indirecta."),
    eleccion: campo("Qué se ve al comparar el estudio citado con los demás que miden el test, y qué implica para fiarse. Null si no hay otros."),
    parcial: campo("Qué implica que solo conste una de las dos cifras. Null si constan las dos."),
  },
  required: ["sensibilidad", "especificidad", "calidad", "indirecta", "parcial"],
  additionalProperties: false,
};

const CAMPOS = Object.keys(ESQUEMA.properties);

/**
 * Qué cifras no publica un estudio, dicho con todas las letras. Con un null en
 * el campo el modelo acababa comparando igual: "las cifras del otro son más
 * altas", cuando el citado ni siquiera tenía especificidad.
 */
function faltanEn(x) {
  return [x.sn == null ? "sensibilidad" : null, x.sp == null ? "especificidad" : null].filter(Boolean);
}

/** El nivel del dominio dicho como se enseña en pantalla. */
const SENAL = { concluyente: "señal muy clara", moderado: "señal clara", pequeno: "señal débil", irrelevante: "no sirve como señal" };
const senalDe = (nivel) => (nivel ? SENAL[nivel] || null : null);

/** Los datos que se le enseñan al modelo: los de la ficha y nada más. */
function datosDe(ev, { test, entidad }) {
  return {
    test,
    patologia: entidad,
    sensibilidad: ev.sn,
    especificidad: ev.sp,
    cifraQueFalta: ev.parcial ? ev.falta : null,
    razonPositiva: ev.rv?.positiva ?? null,
    razonNegativa: ev.rv?.negativa ?? null,
    senalSiPositivo: senalDe(ev.rv?.magnitudPositiva),
    senalSiNegativo: senalDe(ev.rv?.magnitudNegativa),
    calidad: ev.calidad?.etiqueta ?? null,
    motivosDeLaCalidad: ev.calidad?.motivos ?? [],
    medidaEnOtraPatologia: ev.indirecta ? ev.entidadDeLasCifras : null,
    fraseDelArticulo: ev.citaLiteral || null,
    // Para poder explicar la elección: qué es el artículo citado y qué son los
    // otros que también miden este test.
    articuloCitado: {
      sensibilidad: ev.sn ?? null,
      especificidad: ev.sp ?? null,
      cifrasQueNoPublica: faltanEn(ev),
      tipo: ev.valoracion?.tipoEstudio ?? null,
      estudiosQueReune: ev.valoracion?.numeroEstudios ?? null,
      anio: ev.cita?.anio ?? null,
    },
    otrosQueTambienLoMiden: (ev.otrasFuentes || []).map((o) => ({
      cifrasQueNoPublica: faltanEn(o),
      // Si mide la entidad preguntada o un subgrupo: dos cifras de preguntas
      // distintas no son una contradicción.
      mideLaMismaPatologia: o.mismaEntidad !== false,
      queMide: o.mismaEntidad === false ? o.entidadDeLasCifras || "un subgrupo o una entidad parecida" : null,
      tipo: o.tipoEstudio,
      estudiosQueReune: o.numeroEstudios,
      anio: o.anio,
      sensibilidad: o.sn,
      especificidad: o.sp,
    })),
  };
}

/** Los campos que traen texto; los demás, null. Sin más control. */
function limpiar(bruto, campos) {
  const limpio = {};
  for (const c of campos) {
    limpio[c] = typeof bruto?.[c] === "string" && bruto[c].trim() ? bruto[c].trim() : null;
  }
  return limpio;
}

/**
 * La explicación de un test con cifras, de la base o recién redactada.
 * Devuelve null si no hay nada que explicar o si el modelo falla: es un
 * añadido, y la pantalla funciona sin él.
 */
export async function explicacionDe(clave, ev, { test, entidad, senal }) {
  if (!ev?.hayCifras) return null;

  const huella = huellaDe(ev);
  const guardada = await leer(ALMACEN, clave);
  if (guardada?.version === VERSION && guardada.huella === huella) return guardada.textos;

  try {
    const { datos } = await pedirJson({
      sistema: SISTEMA,
      mensaje: `Datos del test:\n${JSON.stringify(datosDe(ev, { test, entidad }), null, 2)}`,
      esquema: ESQUEMA,
      esfuerzo: "low",
      maxTokens: 1500,
      senal,
    });
    const textos = limpiar(datos, CAMPOS);
    await escribir(ALMACEN, clave, { version: VERSION, huella, test, entidad, textos, fecha: new Date().toISOString() });
    return textos;
  } catch (e) {
    console.warn(`[explicacion] ${test}: ${e.message}`);
    return null;
  }
}

/* ============ qué significa el resultado, con la sospecha de partida ============ */

/*
 * La explicación de arriba se escribe en cuanto llegan las cifras, sin saber
 * con qué sospecha llega el fisioterapeuta. Para las cifras da igual, pero para
 * decir qué significa un positivo o un negativo, no: escribía a ciegas, y bajo
 * un título que decía "Confirma" llegó a poner "aunque no la confirma".
 *
 * Esta se pide cuando se conoce la sospecha, y se guarda por test y por nivel:
 * cambiar de idea en la fase 1 la rehace una vez, y volver a un nivel ya visto
 * no cuesta nada. El cálculo lo hace el dominio y se le da hecho; el modelo
 * solo lo explica.
 */

const VERSION_RESULTADO = 5;

const SISTEMA_RESULTADO = `Explicas a un fisioterapeuta, que tiene al paciente delante, qué significa el resultado del test que está haciendo. Conoces con qué sospecha llega, lo que la herramienta ha calculado para un positivo y para un negativo, las cifras del test y la calidad del estudio del que salen.

Escribe para que lo entienda un niño: frases cortas, palabras de todos los días, y las cifras convertidas en personas ("de cada 100 personas que no la tienen, 12 dan positivo igualmente"), nunca en jerga ("especificidad de 0,88").

Cada campo tiene tres frases, en este orden:
1. Por qué la señal es clara o débil, explicado con lo que hace el test en personas con y sin la patología. Usa los datos deCada100.
2. Qué significa para tu paciente, uniendo esa señal con la sospecha de partida. Por ejemplo: "Partías de una sospecha media, así que este positivo la refuerza, pero no lo bastante para darla por segura."
3. Cuánto fiarte de esas cifras, según la calidad y el contextoDeEvidencia. Distingue la fuente elegida para calcular de todos los estudios localizados. Si hay otras fuentes, no digas que solo existe un estudio. Una revisión no equivale a un estudio primario. Si no se conoce cuántos estudios reúne para este test, no inventes el número. Las cifras parecidas no prueban independencia ni elevan por sí solas la calidad: el primario puede estar incluido en la revisión. Si otro estudio mide un subgrupo o una patología parecida (mideLaMismaPatologia en falso), no presentes su diferencia como una contradicción: mide otra cosa. Conserva las limitaciones de sesgo, precisión y aplicabilidad.

Reglas, sin excepción:

- Solo puedes usar los datos que te doy. No añadas ningún hecho clínico que no salga de ellos: nada de anatomía, mecanismos, epidemiología, otros tests ni tratamientos.
- No escribas ningún número que no esté en los datos, y no calcules nada nuevo.
- No contradigas loQueDiceLaPantalla, que es lo que el fisioterapeuta lee justo encima de tu texto. Si dice que confirma, no digas que no confirma; si dice que refuerza pero no confirma, no la des por confirmada. Lo mismo al descartar.
- El porcentaje al que llega la sospecha ya se ve en pantalla: no hace falta repetirlo.
- La clase de señal se dice con estas palabras, que son las de la pantalla: señal muy clara, señal clara, señal débil, no sirve como señal. Nunca "poder diagnóstico".
- Si solo se conoce una de las dos cifras, tu texto irá dentro del desplegable de orientación teórica y sustituye la estructura de tres frases anterior: explica qué cifra falta y por qué no hay probabilidad calculable; si hay orientacionTeorica, explica su supuesto, distinguiendo techo para un positivo y límite inferior para un negativo. Nunca atribuyas ese porcentaje al paciente, ni digas que la probabilidad real queda entre la inicial y el límite. Si hay ajuste o redondeo, explica que el número mostrado no es un límite exacto ni una cifra publicada. Si no hay orientación teórica, explica el motivoSinLimite sin inventar un techo. El resultado no confirma ni descarta y no entra en el cálculo de la conclusión.
- Las proporciones deCada100 describen la muestra del estudio, no una garantía para todos los pacientes. Si se observó un 100%, no lo presentes como certeza absoluta.
- Quien te lee es el fisioterapeuta, y el enfermo es un tercero: "tu paciente", nunca "tú tienes" ni "tu lesión".
- Nunca digas qué hacer a continuación.
- Cada campo, como mucho 70 palabras. Español de España, tono cercano y sobrio.`;

const ESQUEMA_RESULTADO = {
  type: "object",
  properties: {
    positivo: campo("Qué significa para este paciente, con esta sospecha de partida, que el test salga positivo."),
    negativo: campo("Qué significa para este paciente, con esta sospecha de partida, que el test salga negativo."),
  },
  required: ["positivo", "negativo"],
  additionalProperties: false,
};

const pct = (p) => Math.round(p * 100);

/** Lo calculado para un resultado, dicho para el modelo, y los números que usa. */
function calculado(ev, nivel, resultado) {
  if (!ev.parcial) {
    const d = interpretar({ nivelPreTest: nivel, sn: ev.sn, sp: ev.sp, resultado });
    if (!d.interpretable) return { datos: null };
    const x = d.detalle;
    const mov = pctMostrado(x.postTest) - pctMostrado(x.preTest);
    return {
      datos: {
        claseDeSenal: x.magnitud.texto,
        loQueDiceLaPantalla: d.lectura,
        laSospechaQuedaEn: x.postTestTexto,
        puntosQueSeMueve: `${mov > 0 ? "+" : "-"}${Math.abs(mov)}`,
      },
    };
  }
  const parcial = acotarParcial({ nivelPreTest: nivel, sn: ev.sn, sp: ev.sp, resultado });
  return {
    datos: {
      orientacionTeorica: parcial.orientacion ?? null,
      motivoSinLimite: parcial.acotable ? null : parcial.motivo,
      soloSeConoceUnaCifra: true,
      cifraQueFalta: ev.sn == null ? "sensibilidad" : "especificidad",
      loQueDiceLaPantalla: "Probabilidad no calculable · faltan datos. El resultado no entra en el cálculo de la conclusión.",
    },
  };
}

/**
 * Qué significa un positivo y un negativo de este test, para esta sospecha de
 * partida. De la base si ya está, o redactado ahora.
 */
export async function lecturaResultadoDe(clave, ev, { test, entidad, nivel, senal }) {
  if (!ev?.hayCifras || !PRE_TEST[nivel]) return null;

  const k = `${clave}|resultado|${nivel}`;
  const huella = huellaDe(ev);
  const guardada = await leer(ALMACEN, k);
  if (guardada?.version === VERSION_RESULTADO && guardada.huella === huella) return guardada.textos;

  const pos = calculado(ev, nivel, "positivo");
  const neg = calculado(ev, nivel, "negativo");
  if (!pos.datos && !neg.datos) return null;

  const datos = {
    test,
    patologia: entidad,
    sospechaDePartida: `${PRE_TEST[nivel].etiqueta}, ${PRE_TEST[nivel].detalle}`,
    umbrales: `se habla de confirmar por encima del ${pct(UMBRAL_CONFIRMA)}% y de descartar por debajo del ${pct(UMBRAL_DESCARTA)}%`,
    sensibilidad: ev.sn,
    especificidad: ev.sp,
    // Las cifras dichas en personas, ya calculadas: el modelo no tiene que
    // hacer ninguna cuenta, solo contarlas.
    deCada100: {
      conLaPatologiaDanPositivo: ev.sn != null ? pct(ev.sn) : null,
      conLaPatologiaDanNegativo: ev.sn != null ? 100 - pct(ev.sn) : null,
      sinLaPatologiaDanNegativo: ev.sp != null ? pct(ev.sp) : null,
      sinLaPatologiaDanPositivo: ev.sp != null ? 100 - pct(ev.sp) : null,
    },
    contextoDeEvidencia: datosDe(ev, { test, entidad }),
    calidadDelEstudio: ev.calidad?.etiqueta ?? null,
    motivosDeLaCalidad: ev.calidad?.motivos ?? [],
    tipoDeEstudio: ev.valoracion?.tipoEstudio ?? null,
    estudiosQueReune: ev.valoracion?.numeroEstudios ?? null,
    medidaEnOtraPatologia: ev.indirecta ? ev.entidadDeLasCifras : null,
    siSalePositivo: pos.datos,
    siSaleNegativo: neg.datos,
  };
  try {
    const { datos: bruto } = await pedirJson({
      sistema: SISTEMA_RESULTADO,
      mensaje: `Datos:\n${JSON.stringify(datos, null, 2)}`,
      esquema: ESQUEMA_RESULTADO,
      esfuerzo: "low",
      maxTokens: 1000,
      senal,
    });
    const textos = limpiar(bruto, ["positivo", "negativo"]);
    await escribir(ALMACEN, k, { version: VERSION_RESULTADO, huella, test, entidad, nivel, textos, fecha: new Date().toISOString() });
    return textos;
  } catch (e) {
    console.warn(`[lectura] ${test}: ${e.message}`);
    return null;
  }
}
