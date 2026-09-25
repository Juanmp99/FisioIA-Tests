// Explicaciones personalizadas de las cifras de un test.
//
// Es la única parte de la herramienta donde un modelo redacta algo clínico para
// que el fisioterapeuta lo lea, así que se le ata corto por tres lados:
//
//   1. Solo recibe los datos que ya están en la ficha (cifras, motivos, la frase
//      citada) y se le prohíbe añadir nada que no salga de ellos.
//   2. Cada número que escriba se comprueba contra esos datos. Un campo con un
//      número de fuera se descarta, y la pantalla se queda con el texto fijo.
//   3. En pantalla va marcado como redactado con IA, separado de lo verificado.
//
// Se genera una vez por test y patología y se guarda, como la evidencia: la
// misma pregunta da siempre la misma explicación, y solo se paga la primera.

import { leer, escribir } from "../lib/almacen.js";
import { pedirJson } from "./cliente.js";
import { numerosPermitidos, comprobarNumeros, hablaAlPaciente } from "../dominio/redaccion.js";
import { interpretar, acotarParcial, PRE_TEST, UMBRAL_CONFIRMA, UMBRAL_DESCARTA } from "../dominio/probabilidad.js";

const ALMACEN = "explicacion";

/** Se cambia al tocar el prompt, para no servir explicaciones escritas con otro. */
const VERSION = 9;

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
  return [ev.sn, ev.sp, ev.cita?.pmid, ev.calidad?.id, (ev.otrasFuentes || []).length].join("|");
}

const TOPE_CAMPO = 420;

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
      tipo: o.tipoEstudio,
      estudiosQueReune: o.numeroEstudios,
      anio: o.anio,
      sensibilidad: o.sn,
      especificidad: o.sp,
    })),
  };
}

/**
 * Pasa cada campo por el candado. Lo que no pasa se descarta en silencio para
 * el fisioterapeuta, que verá el texto fijo, pero queda anotado en el registro.
 */
function filtrar(bruto, ev, test) {
  // Las cifras de los otros estudios también valen: la comparación con ellos
  // es justo lo que se le pide en `eleccion`. Y los años y el número de
  // estudios reunidos, que también están en los datos.
  const otras = ev.otrasFuentes || [];
  const permitidos = numerosPermitidos({
    proporciones: [ev.sn, ev.sp, ...otras.flatMap((o) => [o.sn, o.sp])],
    razones: [ev.rv?.positiva, ev.rv?.negativa],
    otros: [
      ev.valoracion?.numeroEstudios, ev.cita?.anio,
      ...otras.flatMap((o) => [o.numeroEstudios, o.anio]),
    ].filter((x) => x != null && x !== ""),
  });

  const limpio = {};
  const motivos = [];
  for (const c of CAMPOS) {
    const texto = typeof bruto?.[c] === "string" ? bruto[c].trim() : "";
    if (!texto) { limpio[c] = null; continue; }
    if (texto.length > TOPE_CAMPO) {
      console.warn(`[explicacion] ${test} · ${c}: descartado por largo`);
      limpio[c] = null;
      motivos.push(`${c} era demasiado largo`);
      continue;
    }
    const r = comprobarNumeros(texto, permitidos);
    if (!r.valido) {
      console.warn(`[explicacion] ${test} · ${c}: descartado, números que no venían en los datos: ${r.intrusos.join(", ")}`);
      limpio[c] = null;
      motivos.push(`en ${c} escribiste ${r.intrusos.join(", ")}, que no está en los datos`);
      continue;
    }
    // Además de pedírselo en el prompt, se comprueba: el modelo se despista y
    // acaba hablándole al paciente, que no es quien está leyendo.
    if (hablaAlPaciente(texto)) {
      console.warn(`[explicacion] ${test} · ${c}: descartado, le habla al paciente en vez de al fisioterapeuta`);
      limpio[c] = null;
      motivos.push(`en ${c} te dirigiste al enfermo; quien lee es el fisioterapeuta, y al enfermo se le llama "tu paciente"`);
      continue;
    }
    limpio[c] = texto;
  }
  return { limpio, motivos };
}

/** Cuántos campos útiles trae una redacción. Sirve para quedarse con la mejor. */
const utiles = (t) => Object.values(t).filter(Boolean).length;

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

  // Si el candado descarta algún campo, se pide una segunda vez diciéndole al
  // modelo qué falló, y se queda la redacción que traiga más campos buenos.
  const base = `Datos del test:\n${JSON.stringify(datosDe(ev, { test, entidad }), null, 2)}`;
  let mejor = null;
  let aviso = "";
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const { datos } = await pedirJson({
        sistema: SISTEMA,
        mensaje: base + aviso,
        esquema: ESQUEMA,
        esfuerzo: "low",
        maxTokens: 1500,
        senal,
      });
      const { limpio, motivos } = filtrar(datos, ev, test);
      if (!mejor || utiles(limpio) > utiles(mejor)) mejor = limpio;
      if (!motivos.length) break;
      aviso = `\n\nTu respuesta anterior no se ha podido usar entera: ${motivos.join("; ")}. Vuelve a redactarla corrigiendo eso y respetando todas las reglas.`;
    } catch (e) {
      console.warn(`[explicacion] ${test}: intento ${intento}: ${e.message}`);
      if (e.porPlazo) break;
    }
  }
  if (!mejor) return null;
  await escribir(ALMACEN, clave, { version: VERSION, huella, test, entidad, textos: mejor, fecha: new Date().toISOString() });
  return mejor;
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

const VERSION_RESULTADO = 1;

const SISTEMA_RESULTADO = `Explicas a un fisioterapeuta, que tiene al paciente delante, qué significa el resultado del test que está haciendo. Conoces con qué sospecha llega y lo que la herramienta ha calculado para un positivo y para un negativo.

Reglas, sin excepción:

1. Solo puedes usar los datos que te doy. No añadas ningún hecho clínico que no salga de ellos: nada de anatomía, mecanismos, epidemiología, otros tests ni tratamientos.

2. No escribas ningún número que no esté en los datos, y no calcules nada nuevo.

3. No contradigas loQueDiceLaPantalla, que es lo que el fisioterapeuta lee justo encima de tu texto. Si dice que confirma, no digas que no confirma; si dice que refuerza pero no confirma, no la des por confirmada. Lo mismo al descartar.

4. El fisioterapeuta ya ve en pantalla el porcentaje al que llega su sospecha y los puntos que se mueve. No los repitas: explica el porqué, uniendo la sospecha de partida con la clase de señal que es el resultado. Por ejemplo: "Partías de una sospecha media y es una señal muy clara: con un positivo basta para darla por confirmada." O: "La señal es débil, pero como partías de una sospecha baja, basta para descartarla."

5. La clase de señal se dice con estas palabras, que son las de la pantalla: señal muy clara, señal clara, señal débil, no sirve como señal. Nunca "poder diagnóstico".

6. Si solo se conoce una de las dos cifras, di que no se puede saber del todo cuánto cambia la sospecha y, si hay techo, que como mucho llegaría hasta ahí.

7. Quien te lee es el fisioterapeuta, y el enfermo es un tercero: "tu paciente", nunca "tú tienes" ni "tu lesión".

8. Nunca digas qué hacer a continuación.

9. Cada campo, una o dos frases y como mucho 35 palabras. Español de España, tono sobrio.`;

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
    if (!d.interpretable) return { datos: null, numeros: [] };
    const x = d.detalle;
    const mov = pct(x.postTest) - pct(x.preTest);
    return {
      datos: {
        claseDeSenal: x.magnitud.texto,
        loQueDiceLaPantalla: d.lectura,
        laSospechaQuedaEn: `${pct(x.postTest)}%`,
        puntosQueSeMueve: `${mov > 0 ? "+" : "-"}${Math.abs(mov)}`,
      },
      numeros: [pct(x.postTest), Math.abs(mov), x.razonDeVerosimilitud],
    };
  }
  const a = acotarParcial({ nivelPreTest: nivel, sn: ev.sn, sp: ev.sp, resultado });
  if (!a.acotable) {
    return { datos: { soloSeConoceUnaCifra: true, loQueDiceLaPantalla: a.motivo }, numeros: [] };
  }
  return {
    datos: {
      soloSeConoceUnaCifra: true,
      claseDeSenalComoMucho: a.detalle.magnitud.texto,
      loQueDiceLaPantalla: a.lectura,
      comoMuchoLlegariaA: a.detalle.postTestTexto,
    },
    numeros: [pct(a.detalle.postTest), a.detalle.razonDeVerosimilitud],
  };
}

function filtrarResultado(bruto, permitidos, lecturas, test) {
  const limpio = {};
  const motivos = [];
  for (const c of ["positivo", "negativo"]) {
    const texto = typeof bruto?.[c] === "string" ? bruto[c].trim() : "";
    if (!texto || !lecturas[c]) { limpio[c] = null; continue; }
    if (texto.length > TOPE_CAMPO) {
      limpio[c] = null;
      motivos.push(`${c} era demasiado largo`);
      continue;
    }
    const r = comprobarNumeros(texto, permitidos);
    if (!r.valido) {
      console.warn(`[lectura] ${test} · ${c}: números que no venían en los datos: ${r.intrusos.join(", ")}`);
      limpio[c] = null;
      motivos.push(`en ${c} escribiste ${r.intrusos.join(", ")}, que no está en los datos`);
      continue;
    }
    if (hablaAlPaciente(texto)) {
      console.warn(`[lectura] ${test} · ${c}: le habla al paciente`);
      limpio[c] = null;
      motivos.push(`en ${c} te dirigiste al enfermo; quien lee es el fisioterapeuta, y al enfermo se le llama "tu paciente"`);
      continue;
    }
    // Que no le lleve la contraria al título: si la pantalla confirma, el texto
    // no puede decir que no confirma, y lo mismo al descartar.
    const pantalla = lecturas[c];
    const contradice =
      (/^Confirma/.test(pantalla) && /no\s+(la\s+|lo\s+)?confirma/i.test(texto)) ||
      (/^Descarta/.test(pantalla) && /no\s+(la\s+|lo\s+)?descarta/i.test(texto)) ||
      (!/^Confirma/.test(pantalla) && /\b(la\s+)?confirma\b(?!r)/i.test(texto) && !/no\s+(la\s+)?confirma/i.test(texto)) ||
      (!/^Descarta/.test(pantalla) && /\b(la\s+)?descarta\b(?!r)/i.test(texto) && !/no\s+(la\s+)?descarta/i.test(texto));
    if (contradice) {
      console.warn(`[lectura] ${test} · ${c}: contradice a la pantalla`);
      limpio[c] = null;
      motivos.push(`en ${c} contradijiste lo que dice la pantalla ("${pantalla}")`);
      continue;
    }
    limpio[c] = texto;
  }
  return { limpio, motivos };
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
    siSalePositivo: pos.datos,
    siSaleNegativo: neg.datos,
  };
  const permitidos = numerosPermitidos({
    proporciones: [ev.sn, ev.sp, PRE_TEST[nivel].valor],
    razones: [...pos.numeros, ...neg.numeros].filter((n) => typeof n === "number"),
    otros: [pct(UMBRAL_CONFIRMA), pct(UMBRAL_DESCARTA), ...pos.numeros, ...neg.numeros],
  });
  const lecturas = { positivo: pos.datos?.loQueDiceLaPantalla, negativo: neg.datos?.loQueDiceLaPantalla };

  const base = `Datos:\n${JSON.stringify(datos, null, 2)}`;
  let mejor = null;
  let aviso = "";
  for (let intento = 1; intento <= 2; intento++) {
    try {
      const { datos: bruto } = await pedirJson({
        sistema: SISTEMA_RESULTADO,
        mensaje: base + aviso,
        esquema: ESQUEMA_RESULTADO,
        esfuerzo: "low",
        maxTokens: 800,
        senal,
      });
      const { limpio, motivos } = filtrarResultado(bruto, permitidos, lecturas, test);
      if (!mejor || utiles(limpio) > utiles(mejor)) mejor = limpio;
      if (!motivos.length) break;
      aviso = `\n\nTu respuesta anterior no se ha podido usar entera: ${motivos.join("; ")}. Vuelve a redactarla corrigiendo eso y respetando todas las reglas.`;
    } catch (e) {
      console.warn(`[lectura] ${test}: intento ${intento}: ${e.message}`);
      if (e.porPlazo) break;
    }
  }
  if (!mejor) return null;
  await escribir(ALMACEN, k, { version: VERSION_RESULTADO, huella, test, entidad, nivel, textos: mejor, fecha: new Date().toISOString() });
  return mejor;
}
