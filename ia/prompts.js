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

4 bis. La agrupación lleva, además, su nombre en inglés en nombreBusqueda, porque es con eso con lo que se busca en PubMed y allí no hay nada en español. "Combinación de Park" no encuentra nada; "Park's combination test" sí. Vale la misma regla que para los tests: en nombresBusqueda van las otras formas inglesas de llamarla, si las hay.

5. Ejecución. De cada test describe posición del paciente, posición del terapeuta, la maniobra, y qué se considera resultado positivo. Redacción breve y en imperativo, como un recordatorio para alguien que ya sabe hacerlo, no como un manual de aprendizaje. Nadie aprende un test nuevo con el paciente delante.

6. Nombres. Usa el nombre habitual del test en la literatura, que suele ser el epónimo en inglés y no se traduce (Jobe, Hawkins-Kennedy, Lachman). En otros nombres alternativos incluye cómo se le llama en español si es de uso corriente.

6 bis. De cada test devuelve además nombreBusqueda: el nombre en inglés con el que buscarlo en PubMed, sin apóstrofes, sin paréntesis y sin la palabra "test" si no forma parte del nombre propio. Para maniobras descriptivas que no tienen epónimo, escribe la descripción en inglés: por ejemplo "resisted wrist extension" o "lateral epicondyle palpation". Nunca dejes este campo en español: la base de datos es inglesa y en español no encuentra nada.

6 ter. Y devuelve nombresBusqueda: de uno a tres nombres MÁS con los que el mismo test aparece en la literatura inglesa, sin repetir el de nombreBusqueda. Es el mismo problema que con la entidad: un test se publica con varios nombres y buscándolo por uno solo se pierden artículos. "Jobe test", "empty can test" y "supraspinatus test" son el mismo test, y cada artículo elige uno. Solo nombres en inglés que se usen de verdad en publicaciones; si no conoces ninguno más, devuelve la lista vacía antes que inventarte uno.

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
          nombreBusqueda: {
            type: "string",
            description:
              "El nombre de la agrupación EN INGLÉS, tal como lo escribe la literatura. Es con lo que se busca en PubMed, así que nunca en español.",
          },
          nombresBusqueda: {
            type: "array",
            items: { type: "string" },
            description:
              "Otras formas inglesas de nombrar la misma agrupación. Vacío si no hay más de una.",
          },
          tests: { type: "array", items: { type: "string" } },
          criterio: { type: "string", description: "Cuántos positivos se consideran agrupación positiva." },
        },
        required: ["nombre", "nombreBusqueda", "nombresBusqueda", "tests", "criterio"],
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
          nombresBusqueda: {
            type: "array",
            description: "De cero a tres nombres más del mismo test en la literatura inglesa, para no perder artículos. Sin repetir nombreBusqueda.",
            items: { type: "string" },
          },
          otrosNombres: { type: "array", items: { type: "string" } },
          objetivo: { type: "string", description: "Qué estructura o mecanismo explora, en una línea." },
          posicionPaciente: { type: "string" },
          posicionTerapeuta: { type: "string" },
          maniobra: { type: "string" },
          positivoSi: { type: "string" },
        },
        required: ["nombre", "nombreBusqueda", "nombresBusqueda", "otrosNombres", "objetivo", "posicionPaciente", "posicionTerapeuta", "maniobra", "positivoSi"],
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

3 ter. Lo mismo vale cuando las cifras se midieron sobre un subgrupo o una combinación concreta de lesiones y no sobre la entidad preguntada en general: solo roturas del subescapular, o roturas combinadas de infraespinoso y supraespinoso, cuando se pregunta por rotura del manguito rotador. Marca mismaEntidad en falso y anota en entidadDeLasCifras el subgrupo exacto. Mira siempre las abreviaturas de las tablas y la definición de caso del estudio antes de decidir. No cuenta como subgrupo la forma habitual de la entidad o su definición estándar en la literatura: roturas de espesor completo, cuando se pregunta por rotura del manguito, son la misma entidad.

3 quater. Distingue una entidad parecida de otra pregunta diagnóstica. Hay estudios que miden el test para responder algo distinto de "¿tiene el paciente esta entidad?": por ejemplo, distinguir quién tiene una rotura dentro del tendón entre pacientes que ya tienen tendinopatía lateral del codo, o detectar una complicación o una fractura oculta. Sus cifras no dicen cuánto cambia la sospecha de la entidad preguntada, y usarlas daría un número que responde a otra cosa. En ese caso marca otraPregunta en verdadero y explica en otraPreguntaMotivo, en una frase y en español, qué pregunta responde el estudio. Si hay otro texto que sí mida la entidad preguntada, elige ese y deja otraPregunta en falso.

4. Expresa sensibilidad y especificidad como proporciones entre 0 y 1. Si el texto las da en porcentaje, divide entre cien y nada más.

4 bis. Solo valen sensibilidad y especificidad publicadas como tales. No las calcules tú a partir de recuentos de una tabla (verdaderos y falsos positivos y negativos): es fácil leer las columnas al revés y dar una cifra que el artículo no dice. Si el artículo solo da recuentos, trátalo como si no publicara esa cifra.

5. Si varios textos dan cifras para el mismo test, elige uno siguiendo este orden, y no otro:
   1) las dos cifras, medidas sobre la entidad preguntada;
   2) las dos cifras, medidas sobre una entidad relacionada o un subgrupo (mismaEntidad en falso);
   3) una sola cifra, medida sobre la entidad preguntada;
   4) una sola cifra, medida sobre una entidad relacionada;
   5) cifras que responden a otra pregunta diagnóstica, solo si no hay nada de lo anterior.
   Dentro de cada escalón, una revisión sistemática o metaanálisis va por delante de un estudio primario, y entre revisiones, la que reúna más estudios.
   Lo primero es que se publiquen las dos: con una sola no se puede calcular cuánto cambia la sospecha, y el test deja de servir para la conclusión. Por eso un estudio primario con las dos cifras va por delante de una revisión con una sola, aunque la revisión sea más fiable. Y lo segundo, que se hayan medido sobre la entidad preguntada: un estudio primario sobre la entidad preguntada va por delante de una revisión sobre otra parecida, porque responde a la pregunta del fisioterapeuta. La revisión con una sola cifra no se pierde: va a otrasFuentes y se enseña al lado. Marca la consistencia como discrepante si las cifras de unos y otros difieren de forma apreciable.

5 bis. Los demás textos que publiquen cifras de ESE test para ESA entidad van en otrasFuentes, hasta tres, cada uno con su PMID y su propia frase copiada palabra por palabra. No se van a mezclar con las que devuelves arriba —la sensibilidad y la especificidad salen de la misma tabla y del mismo grupo de pacientes, así que combinarlas entre estudios daría un número que nadie ha medido—, sino que se enseñan al lado para que se vea entre qué valores se mueve la literatura. No repitas ahí el artículo que ya has elegido. Si ningún otro publica cifras, deja la lista vacía: es una respuesta correcta y frecuente.
   Para cada uno, dime con el mismo criterio de las reglas 3 bis y 3 ter qué mide exactamente: mismaEntidad en verdadero si mide la entidad preguntada, y en falso si mide una entidad relacionada o un subgrupo (solo roturas posterosuperiores, solo subescapular…), anotando en entidadDeLasCifras, en español y en pocas palabras, cuál. Es lo que evita que dos cifras que responden a preguntas distintas se lean como una contradicción.

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
    otraPregunta: {
      type: "boolean",
      description: "Verdadero si las cifras responden a otra pregunta diagnóstica distinta de si el paciente tiene la entidad preguntada.",
    },
    otraPreguntaMotivo: {
      type: ["string", "null"],
      description: "Si otraPregunta es verdadero, qué pregunta responde el estudio, en una frase en español. Null si no.",
    },
    citaLiteral: {
      type: "string",
      description: "Frase del texto, copiada palabra por palabra, donde constan las cifras extraídas.",
    },
    pmid: { type: ["string", "null"], description: "PMID del artículo del que salen las cifras." },
    otrasFuentes: {
      type: "array",
      description:
        "Otros artículos de los que te he dado que publiquen cifras de este mismo test para esta misma entidad. Máximo tres. Vacío si no hay.",
      items: {
        type: "object",
        properties: {
          pmid: { type: "string" },
          sn: { type: ["number", "null"], description: "Sensibilidad como proporción entre 0 y 1." },
          sp: { type: ["number", "null"], description: "Especificidad como proporción entre 0 y 1." },
          tipoEstudio: {
            type: "string",
            enum: ["revision_sistematica", "estudio_primario", "ninguno"],
            description: "Qué es ESE artículo. Hace falta para poder explicar por qué se ha elegido otro.",
          },
          numeroEstudios: { type: "number", description: "Cuántos estudios reúne ESE artículo. 1 si es un estudio primario." },
          mismaEntidad: {
            type: "boolean",
            description: "Verdadero si ESE artículo mide la entidad preguntada; falso si una entidad relacionada o un subgrupo.",
          },
          entidadDeLasCifras: {
            type: ["string", "null"],
            description: "Si mismaEntidad es falso, qué mide ESE artículo, en español y en pocas palabras. Null si no.",
          },
          citaLiteral: { type: "string", description: "La frase de ESE artículo donde constan esas cifras, copiada palabra por palabra." },
        },
        required: ["pmid", "sn", "sp", "tipoEstudio", "numeroEstudios", "mismaEntidad", "entidadDeLasCifras", "citaLiteral"],
        additionalProperties: false,
      },
    },
    componentes: {
      type: "array",
      items: { type: "string" },
      description:
        "Solo para agrupaciones: los tests que componen la agrupación SEGÚN EL ARTÍCULO, nombrados como los nombra él. Vacío si el artículo no los enumera o si no se trata de una agrupación.",
    },
    criterioDelArticulo: {
      type: "string",
      description:
        "Solo para agrupaciones: la regla que el artículo usa para dar la agrupación por positiva, copiada de su texto. Vacío si el artículo no la dice.",
    },
    notas: { type: "string", description: "Una línea sobre de dónde sale el dato o por qué no se ha encontrado." },
  },
  required: [
    "encontrado", "sn", "sp", "lrPositiva", "lrNegativa", "tipoEstudio",
    "amstar2", "quadas2", "consistencia", "intervalos", "numeroEstudios",
    "mismaEntidad", "entidadDeLasCifras", "otraPregunta", "otraPreguntaMotivo", "citaLiteral", "pmid",
    "otrasFuentes", "componentes", "criterioDelArticulo", "notas",
  ],
  additionalProperties: false,
};

/**
 * Segunda pasada, con el artículo entero delante.
 *
 * Se usa solo cuando la primera pasada dejó sin valorar el riesgo de sesgo o
 * los intervalos de confianza: son los dos campos que un resumen casi nunca
 * trae y los dos que impiden que una evidencia buena llegue a verde. En el
 * texto completo suelen estar, y casi siempre en las tablas.
 */
export function mensajeExtraccionCompleta({ test, entidad, articulo, texto, esAgrupacion }) {
  return (
    `Test: ${test}\nEntidad clínica: ${entidad}\n` +
    (esAgrupacion ? exigenciaAgrupacion() : "") +
    "\n" +
    "Tienes el TEXTO COMPLETO de un solo artículo, no un resumen. Las tablas van primero.\n" +
    "Aprovéchalo para lo que un resumen no permite: comprobar si constan intervalos de\n" +
    "confianza y si son estrechos o amplios, y valorar con criterio el riesgo de sesgo\n" +
    "(QUADAS-2) y la calidad de la revisión (AMSTAR-2). Las reglas sobre las cifras no\n" +
    "cambian: solo vale lo que aparezca literalmente escrito.\n\n" +
    `--- Artículo ---\nPMID: ${articulo.pmid}\nTítulo: ${articulo.titulo}\n` +
    `Revista: ${articulo.revista} (${articulo.anio})\n` +
    `Tipo de publicación: ${articulo.tipos?.join(", ") || "no consta"}\n\n${texto}`
  );
}

/**
 * Lo que se le exige de más cuando lo que se busca es una agrupación.
 *
 * Una agrupación no es un test con otro nombre: son unos tests concretos
 * combinados bajo una regla concreta, y sus cifras solo valen para esa
 * combinación y esa regla. Sin comprobarlo, bastaba con que la búsqueda
 * devolviera cifras para algo llamado "exploración clínica combinada" para que
 * la interfaz lo diera por validado, aunque el artículo combinase otros tests o
 * exigiera otro número de positivos.
 *
 * Por eso se le piden los componentes y el criterio tal como los nombra el
 * artículo, y no se le enseña la propuesta que hay que comprobar: si la viera,
 * la tentación de devolverla igual sería demasiado grande. Comparar es trabajo
 * de después, y de código.
 */
function exigenciaAgrupacion() {
  return (
    "\nESTO ES UNA AGRUPACIÓN, NO UN TEST SUELTO.\n" +
    "Las cifras de una agrupación solo valen para unos tests concretos combinados\n" +
    "bajo una regla concreta. Así que, además de las cifras:\n" +
    "  - Enumera en `componentes` los tests que el artículo combina, con el nombre\n" +
    "    que les da el artículo. Si no los enumera, deja la lista vacía.\n" +
    "  - Copia en `criterioDelArticulo` la regla con la que el artículo da la\n" +
    "    agrupación por positiva. Si no la dice, déjalo vacío.\n" +
    "No deduzcas ninguna de las dos cosas ni las completes con lo que sepas: si no\n" +
    "están escritas en el texto, van vacías. Una agrupación sin componentes y sin\n" +
    "criterio no es un error, es un dato.\n"
  );
}

/**
 * Cuánto texto se le puede poner delante al modelo.
 *
 * Al ensanchar la búsqueda, los tests raros pasaron de encontrar un artículo a
 * encontrar catorce, y el mensaje se disparó: uno llegó a 51.000 caracteres,
 * con un solo "resumen" de 22.476 que no era un resumen sino un documento
 * entero. PubMed mete ahí a veces capítulos y revisiones completas. La
 * extracción tardaba tanto que la petición se cortaba y el fisioterapeuta veía
 * "la búsqueda ha tardado demasiado" justo en los tests donde más se había
 * buscado.
 *
 * Los dos números salen de medir, no de elegirlos redondos. Sobre 114 artículos
 * de ocho búsquedas reales se contó cuántas afirmaciones de sensibilidad,
 * especificidad o razón de verosimilitud llegan al modelo con cada
 * combinación:
 *
 *     resumen 2500 · total 24000  ->  82 %   89 de 114 artículos
 *     resumen 4000 · total 24000  ->  76 %   85            (peor: los
 *                                            resúmenes grandes echan fuera
 *                                            artículos enteros)
 *     resumen 3000 · total 27000  ->  86 %   98
 *     resumen 3000 · total 30000  ->  91 %  107
 *
 * Subir el tope por resumen sin subir el total empeora las cosas, que era justo
 * lo que no se veía a ojo. El 9 % que sigue sin llegar está casi todo en los
 * artículos de la cola, los de menos relevancia, que hasta anteayer no se leían
 * en absoluto porque la búsqueda devolvía uno solo.
 */
const TOPE_RESUMEN = 3000;
const TOPE_TEXTOS = 30000;

/**
 * Recorta un resumen desmedido sin tirar la frase que importa.
 *
 * El orden de prioridad es al revés de lo que parece natural. Lo primero que se
 * salva no es el principio del texto sino las frases con cifras de precisión,
 * porque son literalmente lo único que se ha venido a buscar y en los textos
 * largos suelen estar al final, que es justo lo que un recorte por delante se
 * lleva. Solo con el hueco que sobra se rellena la cabecera, que sirve para
 * saber de qué va el estudio.
 *
 * La primera versión hacía lo contrario —cabecera primero, cifras con lo que
 * quedara— y medido sobre dieciocho resúmenes recortados perdía una
 * sensibilidad publicada. Una de cuarenta, pero de la única clase de dato que
 * no se puede perder.
 *
 * Dentro de las frases con cifras también hay jerarquía: sensibilidad,
 * especificidad y razones de verosimilitud van antes que valores predictivos o
 * áreas bajo la curva, que no se extraen. Y se devuelven en el orden del
 * artículo, para que cada cifra siga pegada al test que la tenía al lado.
 */
const ESENCIAL = /sensitiv|specific|likelihood ratio|\bLR\s?[+−-]/i;
const SECUNDARIO = /accuracy|predictive value|AUC|95% ?CI/i;

function recortarResumen(texto) {
  const t = String(texto || "");
  if (t.length <= TOPE_RESUMEN) return t;

  const frases = t.split(/(?<=[.;])\s+/);
  const candidatas = frases
    .map((f, i) => ({ f, i, esencial: ESENCIAL.test(f) }))
    .filter((x) => x.esencial || SECUNDARIO.test(x.f));

  // Las esenciales primero para decidir cuáles caben...
  const porPrioridad = [
    ...candidatas.filter((x) => x.esencial),
    ...candidatas.filter((x) => !x.esencial),
  ];

  const elegidas = [];
  let gastado = 0;
  for (const x of porPrioridad) {
    if (gastado + x.f.length > TOPE_RESUMEN * 0.8) continue;
    elegidas.push(x);
    gastado += x.f.length + 1;
  }
  // ...pero se emiten en el orden en que las escribió el artículo.
  elegidas.sort((a, b) => a.i - b.i);
  const cifras = elegidas.map((x) => x.f).join(" ");

  const hueco = TOPE_RESUMEN - cifras.length - 40;
  const cabeza = hueco > 250 ? t.slice(0, hueco).trim() + "… [recortado] " : "";

  return cabeza + cifras;
}

export function mensajeExtraccion({ test, entidad, articulos, esAgrupacion }) {
  // Los artículos vienen ordenados por relevancia, y las revisiones primero.
  // Si no caben todos, los que se quedan fuera son los de la cola.
  const trozos = [];
  let gastado = 0;
  for (const [i, a] of articulos.entries()) {
    const trozo =
      `--- Artículo ${i + 1} ---\nPMID: ${a.pmid}\nTítulo: ${a.titulo}\nRevista: ${a.revista} (${a.anio})\n` +
      `Tipo de publicación: ${a.tipos.join(", ") || "no consta"}\n` +
      `Resumen: ${recortarResumen(a.resumen) || "(sin resumen disponible)"}`;
    if (gastado + trozo.length > TOPE_TEXTOS && trozos.length) break;
    trozos.push(trozo);
    gastado += trozo.length;
  }
  const textos = trozos.join("\n\n");

  return (
    `Test: ${test}\nEntidad clínica: ${entidad}\n` +
    (esAgrupacion ? exigenciaAgrupacion() : "") +
    `\nTextos disponibles:\n\n${textos}`
  );
}
