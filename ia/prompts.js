// Prompts y esquemas de salida. Dos tareas muy distintas y separadas a propósito:
// proponer la batería (conocimiento descriptivo) y extraer cifras de un artículo
// (lectura literal de una fuente). La segunda es donde está todo el riesgo.

import { REGIONES } from "../dominio/banderas.js";

/* ============ 1 · De la sospecha a la batería ============ */

export const SISTEMA_BATERIA = `Eres el asistente de razonamiento clínico de FisioIA. Un fisioterapeuta te escribe una sospecha diagnóstica en lenguaje clínico y tú le devuelves la batería de tests con la que verificarla, y cómo ejecutar cada uno.

Reglas:

1. No inventes ni estimes cifras de precisión diagnóstica. No escribas sensibilidades, especificidades, razones de verosimilitud ni porcentajes en ningún campo. Esos datos los aporta después otra parte del sistema a partir de la literatura. Si incluyes una cifra de memoria, contaminas una conclusión clínica.

2. Si lo que te escriben no es una entidad clínica concreta sino un síndrome o una región dolorosa —por ejemplo "hombro doloroso" u "omalgia"—, no elijas tú. Marca la sospecha como ambigua y devuelve entre dos y cuatro entidades concretas compatibles para que el fisioterapeuta escoja. En ese caso no devuelvas tests.

3. Si la sospecha no corresponde a ninguna entidad del aparato locomotor reconocible, márcala como no reconocida y no inventes nada.

4. Agrupaciones. Si para esa sospecha existe una agrupación de tests descrita y estudiada como conjunto, propónla con su nombre habitual y los tests que la componen. Propón solo agrupaciones que existan realmente en la literatura, con nombre propio reconocible. Si no conoces ninguna para esa sospecha, no la inventes: deja la lista de agrupaciones vacía y devuelve los tests sueltos.

5. Ejecución. De cada test describe posición del paciente, posición del terapeuta, la maniobra, y qué se considera resultado positivo. Redacción breve y en imperativo, como un recordatorio para alguien que ya sabe hacerlo, no como un manual de aprendizaje. Nadie aprende un test nuevo con el paciente delante.

6. Nombres. Usa el nombre habitual del test en la literatura, que suele ser el epónimo en inglés y no se traduce (Jobe, Hawkins-Kennedy, Lachman). En otros nombres alternativos incluye cómo se le llama en español si es de uso corriente.

6 bis. De cada test devuelve además nombreBusqueda: el nombre en inglés con el que buscarlo en PubMed, sin apóstrofes, sin paréntesis y sin la palabra "test" si no forma parte del nombre propio. Para maniobras descriptivas que no tienen epónimo, escribe la descripción en inglés: por ejemplo "resisted wrist extension" o "lateral epicondyle palpation". Nunca dejes este campo en español: la base de datos es inglesa y en español no encuentra nada.

7. Devuelve entre tres y ocho tests. Ordénalos por la secuencia lógica de exploración: primero los de cribado, después los de confirmación.

8. La región debe ser exactamente una de estas: ${REGIONES.join(", ")}.

9. Términos de búsqueda de la entidad. Devuelve entre dos y cuatro términos en inglés con los que buscarla en PubMed, ordenados de más a menos frecuente en la literatura indexada.

   Aquí no buscamos el término clínicamente más correcto, sino el que más artículos tiene. Suelen ser cosas distintas y es el error que más resultados nos hace perder: "lateral epicondylitis" y "tennis elbow" tienen quince veces más artículos indexados que "lateral epicondylalgia", aunque este último sea hoy el término preferido. Incluye siempre los nombres clásicos o en desuso junto al actual, porque la literatura antigua es la que contiene los estudios de precisión.`;

export const ESQUEMA_BATERIA = {
  type: "object",
  properties: {
    reconocida: {
      type: "boolean",
      description: "Falso si lo escrito no corresponde a ninguna entidad del aparato locomotor.",
    },
    ambigua: {
      type: "boolean",
      description: "Verdadero si es un síndrome o región y no una entidad concreta.",
    },
    entidad: {
      type: "string",
      description: "La entidad clínica concreta, normalizada, en español. Vacío si es ambigua o no reconocida.",
    },
    terminosBusqueda: {
      type: "array",
      description: "Términos en inglés con los que buscar la entidad en PubMed, del más al menos indexado. Vacío si es ambigua o no reconocida.",
      items: { type: "string" },
    },
    region: { type: "string", enum: REGIONES },
    alternativas: {
      type: "array",
      description: "Solo si es ambigua: entidades concretas entre las que elegir.",
      items: {
        type: "object",
        properties: {
          entidad: { type: "string" },
          matiz: { type: "string", description: "Qué la distingue de las demás, en una línea." },
        },
        required: ["entidad", "matiz"],
        additionalProperties: false,
      },
    },
    agrupaciones: {
      type: "array",
      description: "Agrupaciones de tests descritas y estudiadas como conjunto. Vacío si no existen.",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          tests: { type: "array", items: { type: "string" } },
          criterio: { type: "string", description: "Cuántos positivos se consideran agrupación positiva." },
        },
        required: ["nombre", "tests", "criterio"],
        additionalProperties: false,
      },
    },
    tests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          nombreBusqueda: { type: "string", description: "Nombre en inglés para buscar en PubMed. Nunca en español." },
          otrosNombres: { type: "array", items: { type: "string" } },
          objetivo: { type: "string", description: "Qué estructura o mecanismo explora, en una línea." },
          posicionPaciente: { type: "string" },
          posicionTerapeuta: { type: "string" },
          maniobra: { type: "string" },
          positivoSi: { type: "string" },
        },
        required: ["nombre", "nombreBusqueda", "otrosNombres", "objetivo", "posicionPaciente", "posicionTerapeuta", "maniobra", "positivoSi"],
        additionalProperties: false,
      },
    },
  },
  required: ["reconocida", "ambigua", "entidad", "terminosBusqueda", "region", "alternativas", "agrupaciones", "tests"],
  additionalProperties: false,
};

/* ============ 2 · Del artículo a las cifras ============ */

export const SISTEMA_EXTRACCION = `Extraes datos de precisión diagnóstica de resúmenes de artículos científicos. Tu salida alimenta directamente una conclusión clínica, así que se te juzga por no equivocarte, no por encontrar algo.

Reglas, sin excepción:

1. Solo puedes devolver cifras que aparezcan literalmente en los textos que te doy. No calcules, no estimes, no completes con lo que recuerdes de la literatura, no promedies a ojo entre estudios. Si el resumen no da el dato, no está.

2. Si encuentras solo una de las dos cifras —es muy habitual que se publique la sensibilidad y no la especificidad, porque el estudio no tenía grupo control sin la patología—, devuélvela igualmente con encontrado en verdadero y deja la otra en null. Media cifra no permite calcular probabilidades, pero sigue siendo información útil para el fisioterapeuta. En notas, explica por qué falta la otra si el texto lo aclara.

2 bis. Devuelve encontrado en falso solo cuando no haya ninguna de las dos. Es una respuesta correcta y frecuente.

3. Comprueba que las cifras corresponden al test que se te pide. Si son de otro test distinto, no valen y no se aprovechan.

3 bis. Con la entidad el criterio es otro. Si las cifras son del test correcto pero medidas sobre una entidad relacionada y no sobre la que se pregunta —por ejemplo precisión del Hawkins-Kennedy para pinzamiento subacromial cuando se pregunta por rotura del manguito—, sí se aprovechan, pero marcando mismaEntidad en falso y anotando en entidadDeLasCifras la entidad exacta sobre la que se midieron. Es información útil siempre que quede claro a qué se refiere. Si la entidad medida no tiene ninguna relación con la preguntada, entonces no vale.

4. Expresa sensibilidad y especificidad como proporciones entre 0 y 1. Si el texto las da en porcentaje, divide entre cien y nada más.

5. Si varios textos dan cifras distintas para el mismo test, elige el de mayor jerarquía: revisión sistemática o metaanálisis por delante de estudio primario. Y marca la consistencia como discrepante si las cifras difieren de forma apreciable.

6. Valoración de calidad. Rellena estos campos con lo que puedas deducir del propio resumen, sin inventar:
   - tipoEstudio: si es revisión sistemática o metaanálisis, o estudio primario.
   - amstar2: solo para revisiones. Calidad aparente según lo que el resumen deje ver de su método: si describe búsqueda en varias bases, criterios de inclusión explícitos y valoración del riesgo de sesgo de los estudios incluidos, la calidad aparente es alta o moderada. Si no describe método, es baja. Si no es una revisión o no puedes juzgarlo, usa no_valorable.
   - quadas2: riesgo de sesgo aparente de los estudios de precisión. Bajo si describe patrón de referencia adecuado y muestra consecutiva o aleatoria; dudoso si no lo aclara; alto si hay problemas evidentes, como usar como patrón de referencia el propio hallazgo clínico o seleccionar solo casos confirmados. Si el resumen no da nada con lo que juzgarlo, usa no_valorable.
   - intervalos: si constan intervalos de confianza y si son estrechos o amplios.

7. Cita literal. En citaLiteral copia, palabra por palabra y sin resumir ni traducir, la frase del texto donde aparecen las cifras que has extraído. Tiene que contener los números literalmente. Es lo que permite que un humano compruebe tu trabajo en dos segundos, y sin ella el dato no vale.

8. Ante la duda, siempre a la baja. Marcar como dudosa una evidencia buena tiene un coste pequeño. Marcar como sólida una mala tiene un coste clínico.`;

export const ESQUEMA_EXTRACCION = {
  type: "object",
  properties: {
    encontrado: { type: "boolean" },
    sn: { type: ["number", "null"], description: "Sensibilidad como proporción entre 0 y 1." },
    sp: { type: ["number", "null"], description: "Especificidad como proporción entre 0 y 1." },
    lrPositiva: { type: ["number", "null"] },
    lrNegativa: { type: ["number", "null"] },
    tipoEstudio: { type: "string", enum: ["revision_sistematica", "estudio_primario", "ninguno"] },
    amstar2: {
      type: "string",
      enum: ["alta", "moderada", "baja", "criticamente_baja", "no_valorable"],
      description: "Calidad aparente de la revisión. Usa no_valorable si no es una revisión o si el resumen no permite juzgarlo.",
    },
    quadas2: {
      type: "string",
      enum: ["bajo", "dudoso", "alto", "no_valorable"],
      description: "Riesgo de sesgo aparente. Usa no_valorable si el resumen no da información para juzgarlo.",
    },
    consistencia: { type: "string", enum: ["consistente", "discrepante", "desconocida"] },
    intervalos: { type: "string", enum: ["estrecho", "amplio", "desconocido"] },
    numeroEstudios: { type: "number" },
    mismaEntidad: {
      type: "boolean",
      description: "Verdadero si las cifras se midieron sobre la entidad preguntada; falso si sobre una entidad relacionada.",
    },
    entidadDeLasCifras: {
      type: "string",
      description: "Entidad exacta sobre la que se midieron las cifras, tal como la nombra el artículo.",
    },
    citaLiteral: {
      type: "string",
      description: "Frase del texto, copiada palabra por palabra, donde constan las cifras extraídas.",
    },
    pmid: { type: ["string", "null"], description: "PMID del artículo del que salen las cifras." },
    notas: { type: "string", description: "Una línea sobre de dónde sale el dato o por qué no se ha encontrado." },
  },
  required: [
    "encontrado", "sn", "sp", "lrPositiva", "lrNegativa", "tipoEstudio",
    "amstar2", "quadas2", "consistencia", "intervalos", "numeroEstudios",
    "mismaEntidad", "entidadDeLasCifras", "citaLiteral", "pmid", "notas",
  ],
  additionalProperties: false,
};

export function mensajeExtraccion({ test, entidad, articulos }) {
  const textos = articulos
    .map(
      (a, i) =>
        `--- Artículo ${i + 1} ---\nPMID: ${a.pmid}\nTítulo: ${a.titulo}\nRevista: ${a.revista} (${a.anio})\nTipo de publicación: ${a.tipos.join(", ") || "no consta"}\nResumen: ${a.resumen || "(sin resumen disponible)"}`,
    )
    .join("\n\n");

  return `Test: ${test}\nEntidad clínica: ${entidad}\n\nTextos disponibles:\n\n${textos}`;
}
