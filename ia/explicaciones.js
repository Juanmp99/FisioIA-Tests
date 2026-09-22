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

const ALMACEN = "explicacion";

/** Se cambia al tocar el prompt, para no servir explicaciones escritas con otro. */
const VERSION = 2;

const TOPE_CAMPO = 360;

const SISTEMA = `Redactas aclaraciones muy breves para un fisioterapeuta que tiene a un paciente delante y está haciendo un test de exploración. Le explicas qué significan, para su paciente, unas cifras que ya ha visto.

Reglas, sin excepción:

1. Solo puedes usar los datos que te doy. No añadas NINGÚN hecho clínico que no salga de ellos: nada de anatomía, mecanismos lesionales, epidemiología, prevalencias, cómo se hace el test, qué otros tests conviene hacer, ni tratamientos. Si para decir algo necesitarías saber algo que no está en los datos, no lo digas.

2. No escribas ningún número que no esté en los datos. Puedes expresar una proporción como porcentaje (0,77 es 77%). No calcules nada nuevo.

3. Tu trabajo es traducir, no ampliar: convierte las cifras y los motivos en lo que implican en consulta para un paciente con esa sospecha. Nombra el test y la patología.

4. Cada campo, una o dos frases y como mucho 45 palabras. Español de España, tono sobrio y práctico. Sin tecnicismos: si usas uno, explícalo en la misma frase.

4 bis. Quien te lee es el fisioterapeuta, y el enfermo es un tercero. Tutéale a él y llama al enfermo "tu paciente": "aumenta la probabilidad de que tu paciente lo tenga", nunca "de que tengas" ni "tu lesión". Son correctos "tu sospecha", "tu paciente" y "el test que has hecho".

4 ter. Escribe las frases completas. Si dices "de cada 100 personas", ese 100 tiene que estar escrito; no empieces una frase contando sobre un total que no nombras.

5. Devuelve null SOLO cuando el dato no exista: indirecta si las cifras se midieron sobre la misma patología, parcial si constan las dos cifras. Si una cifra consta en los datos, su campo no puede quedarse vacío.

6. Sobre los resultados positivo y negativo, apóyate en la magnitud que te doy (concluyente, moderado, pequeño, irrelevante). No afirmes que confirma o descarta: eso depende de la sospecha previa, que no conoces.`;

const campo = (descripcion) => ({ type: ["string", "null"], description: descripcion });

const ESQUEMA = {
  type: "object",
  properties: {
    sensibilidad: campo("Qué implica esta sensibilidad para un paciente con esta sospecha."),
    especificidad: campo("Qué implica esta especificidad para un paciente con esta sospecha."),
    calidad: campo("Qué implica la calidad del estudio para fiarse de estas cifras en este caso."),
    indirecta: campo("Qué implica que las cifras se midieran en otra patología. Null si no es indirecta."),
    parcial: campo("Qué implica que solo conste una de las dos cifras. Null si constan las dos."),
    positivo: campo("Qué aporta en este caso que el test salga positivo, según su magnitud."),
    negativo: campo("Qué aporta en este caso que el test salga negativo, según su magnitud."),
  },
  required: ["sensibilidad", "especificidad", "calidad", "indirecta", "parcial", "positivo", "negativo"],
  additionalProperties: false,
};

const CAMPOS = Object.keys(ESQUEMA.properties);

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
    magnitudSiPositivo: ev.rv?.magnitudPositiva ?? null,
    magnitudSiNegativo: ev.rv?.magnitudNegativa ?? null,
    calidad: ev.calidad?.etiqueta ?? null,
    motivosDeLaCalidad: ev.calidad?.motivos ?? [],
    medidaEnOtraPatologia: ev.indirecta ? ev.entidadDeLasCifras : null,
    fraseDelArticulo: ev.citaLiteral || null,
  };
}

/**
 * Pasa cada campo por el candado. Lo que no pasa se descarta en silencio para
 * el fisioterapeuta, que verá el texto fijo, pero queda anotado en el registro.
 */
function filtrar(bruto, ev, test) {
  const permitidos = numerosPermitidos({
    proporciones: [ev.sn, ev.sp],
    razones: [ev.rv?.positiva, ev.rv?.negativa],
  });

  const limpio = {};
  for (const c of CAMPOS) {
    const texto = typeof bruto?.[c] === "string" ? bruto[c].trim() : "";
    if (!texto) { limpio[c] = null; continue; }
    if (texto.length > TOPE_CAMPO) {
      console.warn(`[explicacion] ${test} · ${c}: descartado por largo`);
      limpio[c] = null;
      continue;
    }
    const r = comprobarNumeros(texto, permitidos);
    if (!r.valido) {
      console.warn(`[explicacion] ${test} · ${c}: descartado, números que no venían en los datos: ${r.intrusos.join(", ")}`);
      limpio[c] = null;
      continue;
    }
    // Además de pedírselo en el prompt, se comprueba: el modelo se despista y
    // acaba hablándole al paciente, que no es quien está leyendo.
    if (hablaAlPaciente(texto)) {
      console.warn(`[explicacion] ${test} · ${c}: descartado, le habla al paciente en vez de al fisioterapeuta`);
      limpio[c] = null;
      continue;
    }
    limpio[c] = texto;
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

  const guardada = await leer(ALMACEN, clave);
  if (guardada?.version === VERSION) return guardada.textos;

  try {
    const { datos } = await pedirJson({
      sistema: SISTEMA,
      mensaje: `Datos del test:\n${JSON.stringify(datosDe(ev, { test, entidad }), null, 2)}`,
      esquema: ESQUEMA,
      esfuerzo: "low",
      maxTokens: 1500,
      senal,
    });
    const textos = filtrar(datos, ev, test);
    await escribir(ALMACEN, clave, { version: VERSION, test, entidad, textos, fecha: new Date().toISOString() });
    return textos;
  } catch (e) {
    console.warn(`[explicacion] ${test}: ${e.message}`);
    return null;
  }
}
