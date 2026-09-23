// Adquisición de evidencia: caché, búsqueda, extracción y validación.
//
// La búsqueda en vivo no es una dependencia en tiempo de ejecución sino la
// forma de construir la base: se busca la primera vez y a partir de ahí el dato
// queda congelado con su cita. La segunda consulta del mismo test es instantánea
// e idéntica a la primera, que es lo que hace la herramienta reproducible.

import { leer, escribir, cuantos } from "../lib/almacen.js";
import { buscarPrecision, urlPubmed } from "./pubmed.js";
import { textoCompleto } from "./pmc.js";
import { abiertos, textoCompletoAbierto } from "./europepmc.js";
import { pedirJson } from "./cliente.js";
import { SISTEMA_EXTRACCION, ESQUEMA_EXTRACCION, mensajeExtraccion, mensajeExtraccionCompleta } from "./prompts.js";
import { validarPrecision, validarParcial, razonesDeVerosimilitud, magnitud } from "../dominio/probabilidad.js";
import { semaforo } from "../dominio/calidad.js";
import { comprobarCita } from "../dominio/trazabilidad.js";
import { comprobarAgrupacion } from "../dominio/agrupaciones.js";
import { depurarFuentes, rangoPublicado } from "../dominio/fuentes.js";

const ALMACEN = "evidencia";

const normalizar = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const clave = (test, entidad) => `${normalizar(test)}|${normalizar(entidad)}`;

// La identidad va dentro del valor y no solo en la clave: la clave se limpia
// para poder ser un nombre de archivo, así que no se puede volver a leer de
// ella qué test y qué entidad eran. La auditoría los necesita.
const guardar = (k, valor, identidad) =>
  escribir(ALMACEN, k, { ...identidad, ...valor, fecha: new Date().toISOString() });

/** Sin evidencia utilizable: es un desenlace normal, no un error. */
function sinDatos(motivo, articulos = []) {
  return {
    hayCifras: false,
    calidad: semaforo({
      tipoEstudio: "ninguno",
      amstar2: null,
      quadas2: null,
      consistencia: "desconocida",
      intervalos: "desconocido",
      numeroEstudios: 0,
    }),
    motivo,
    consultados: articulos.map((a) => ({ pmid: a.pmid, titulo: a.titulo, url: urlPubmed(a.pmid) })),
  };
}

/**
 * ¿Merece la pena leer el artículo entero?
 *
 * Solo si puede cambiar el veredicto. Un estudio primario no llega a verde
 * jamás, por bien que esté hecho, así que leerlo entero sería gastar por
 * gastar. En una revisión sistemática a la que solo le faltan los intervalos o
 * la valoración del sesgo, en cambio, es exactamente lo que le falta.
 */
export function mereceTextoCompleto(datos) {
  if (!datos.encontrado || datos.tipoEstudio !== "revision_sistematica") return false;
  const sinIntervalos = datos.intervalos !== "estrecho" && datos.intervalos !== "amplio";
  const sinSesgo = !datos.quadas2 || datos.quadas2 === "no_valorable";
  return sinIntervalos || sinSesgo;
}

/**
 * Cuánto puede durar una búsqueda entera.
 *
 * Este número tiene historia. Fue 60 porque lo decía un comentario, y con 60 se
 * cortaban las peticiones. Fue 26 y entonces el presupuesto se agotaba antes de
 * empezar: se leían líneas de "quedan -6827 ms". Fue 50 y volvieron los cortes.
 * Fue 34, que era lo máximo que producción había demostrado aguantar, y con 34
 * la auditoría daba cero lecturas de texto completo: la búsqueda se comía doce
 * segundos, una extracción entre quince y veintiocho, y nunca sobraba para una
 * segunda.
 *
 * Todas esas peleas eran contra el mismo muro, que no era nuestro: el tope de
 * una función de Netlify que responde en directo. Ahora esto corre en segundo
 * plano, donde el tope son quince minutos, y el número deja de ser un
 * equilibrio imposible para ser lo que siempre debió: un freno por si algo se
 * atasca.
 *
 * Tres minutos. Nada va a tardar tanto, porque cada paso sigue comprobando si
 * cabe antes de empezar; está por si un día algo se queda esperando a un
 * servidor que no contesta.
 */
const LIMITE_FUNCION = Number(process.env.LIMITE_FUNCION ?? 180000);

/** Lo que se aparta para guardar el resultado y responder. */
const RESERVA = 3000;

/** Lo que tarda en bajarse un artículo entero. Medido, no supuesto. */
const COSTE_DESCARGA = 3000;

/**
 * Cuánto se lee de cada artículo en el rescate.
 *
 * Ocho mil caracteres en lugar de los quince mil de la escalada. Las tablas van
 * las primeras, que es donde están las cifras: recortar quita discusión, no
 * números, y a cambio la extracción tarda bastante menos, que es lo que decide
 * si caben dos intentos o ninguno.
 */
const TOPE_RESCATE = 8000;

/** Días tras los cuales se vuelve a intentar una búsqueda que no encontró nada. */
const CADUCIDAD_NEGATIVOS = 30;

const diasDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

const terminosUtiles = ({ entidad, terminos }) =>
  (Array.isArray(terminos) && terminos.length ? terminos : [entidad]).filter(Boolean);

/**
 * La clave con la que se guarda una evidencia.
 *
 * Se exporta porque, con el trabajo en segundo plano, quien recibe la petición
 * ya no es quien hace el trabajo: el despachador necesita mirar en la base y en
 * el registro de trabajos en curso antes de decidir si lanza a nadie, y tiene
 * que llegar exactamente a la misma clave que llegará el trabajador. Si las dos
 * se calcularan por separado, un día dejarían de coincidir y el resultado se
 * guardaría donde nadie lo busca.
 */
export function claveDe({ test, busqueda, entidad, terminos }) {
  return clave(busqueda || test, terminosUtiles({ entidad, terminos })[0]);
}

/**
 * La evidencia tal como se entrega, con lo que se deriva de ella.
 *
 * Cuánto confirma un positivo y cuánto descarta un negativo se calcula aquí,
 * con el dominio, y no se guarda: así llega también a lo que ya estaba en la
 * base, y el navegador no rehace una aritmética que acabaría divergiendo de la
 * del servidor. Lo necesitan las explicaciones de cada cifra.
 */
export function enriquecer(ev) {
  if (!ev || !ev.hayCifras) return ev;

  // Entre qué valores se mueve cada cifra contando las demás fuentes. Se calcula
  // aquí, con el dominio, en lugar de en el navegador: una segunda
  // implementación acabaría divergiendo de esta.
  const rango = rangoPublicado({ principal: ev, otras: ev.otrasFuentes });

  if (typeof ev.sn !== "number" || typeof ev.sp !== "number") {
    return { ...ev, rv: null, rango };
  }

  const lr = razonesDeVerosimilitud(ev.sn, ev.sp);
  return {
    ...ev,
    rango,
    rv: {
      positiva: lr.positiva,
      negativa: lr.negativa,
      magnitudPositiva: magnitud(lr.positiva).nivel,
      magnitudNegativa: magnitud(lr.negativa).nivel,
    },
  };
}

/**
 * Lo que hay en la base para esa clave, o null.
 *
 * Los resultados sin cifras caducan: la literatura crece, y lo que hoy no se
 * encuentra puede publicarse mañana. Los que sí las tienen no caducan nunca,
 * que es lo que hace que la misma pregunta dé siempre la misma respuesta.
 */
export async function deLaBase(k) {
  const guardado = await leer(ALMACEN, k);
  if (!guardado) return null;
  const caducado =
    !guardado.hayCifras && guardado.fecha && diasDesde(guardado.fecha) > CADUCIDAD_NEGATIVOS;
  return caducado ? null : guardado;
}

/**
 * Evidencia de un test para una entidad. Va a la caché primero; si no está,
 * busca, extrae, valida y guarda el resultado.
 *
 * `entidad` es el nombre en español, que solo se usa para mostrar y para acotar
 * la extracción. `consulta` es el término en inglés con el que se busca en
 * PubMed, y es también la clave de caché: así el dato es el mismo aunque alguien
 * escriba la sospecha de otra manera en español.
 *
 * Los resultados sin cifras también se guardan, para no repetir una búsqueda
 * infructuosa en cada consulta, pero caducan: la literatura crece.
 */
export async function evidenciaDe({ test, busqueda, nombresTest, entidad, terminos, tipo, componentes, bateria, senal }) {
  const esAgrupacion = tipo === "agrupacion";
  const inicio = Date.now();

  /** Milisegundos que quedan antes de tener que responder. */
  const queda = () => LIMITE_FUNCION - RESERVA - (Date.now() - inicio);

  /**
   * Una señal que corta al agotarse el plazo.
   *
   * Es la diferencia entre responder mal y no responder. Sin ella, lo que se
   * alargue se lleva la petición entera y quien contesta es la pasarela con una
   * página de error; con ella, la función llega a tiempo de decir que no ha
   * podido, y el test queda pendiente en vez de roto.
   *
   * Nace aquí, con la función, y no más abajo. Antes solo cubría la llamada al
   * modelo, y la búsqueda —que son siete peticiones a PubMed con sus pausas,
   * más una a Europe PMC— quedaba fuera de plazo y sin ningún tope. Se notó en
   * que el mensaje que llegaba a la ficha era el del navegador y no el del
   * servidor: señal de que no habíamos abortado nada, nos habían matado.
   */
  const conPlazo = () => {
    const plazo = AbortSignal.timeout(Math.max(1000, queda()));
    return senal ? AbortSignal.any([senal, plazo]) : plazo;
  };

  const consulta = busqueda || test;
  const lista = terminosUtiles({ entidad, terminos });
  const termino = lista[0];
  const k = clave(consulta, termino);
  const anotar = (valor) => guardar(k, valor, { test: consulta, entidad: termino });

  const guardado = await deLaBase(k);
  if (guardado) return { ...guardado, deCache: true };

  let articulos = [];
  let estrategia = "sin_resultados";
  try {
    const hallazgo = await buscarPrecision({ test: consulta, nombresTest, terminos: lista, senal: conPlazo() });
    articulos = hallazgo.articulos;
    estrategia = hallazgo.estrategia;
  } catch (e) {
    // Ni un fallo de red ni un corte por plazo se guardan: puede haber datos y
    // conviene reintentar luego. Sellar esto como "sin cifras" sería dar por
    // mirado lo que no se ha llegado a mirar.
    const porPlazo = e?.name === "AbortError" || e?.name === "TimeoutError";
    if (porPlazo) console.warn(`[plazo] ${test}: la búsqueda se ha cortado tras ${Date.now() - inicio} ms`);
    return {
      ...sinDatos(
        porPlazo
          ? "La búsqueda de este test no ha cabido en el tiempo disponible. Vuelve a intentarlo."
          : `No se ha podido consultar PubMed: ${e.message}`,
      ),
      transitorio: true,
    };
  }

  if (!articulos.length) {
    const vacio = sinDatos("No se han localizado artículos de precisión diagnóstica para este test y esta entidad.");
    await anotar(vacio);
    return vacio;
  }

  const nombreEntidad = `${entidad} (${lista.join("; ")})`;

  const antesDeExtraer = Date.now();
  let datos;
  try {
    ({ datos } = await pedirJson({
      sistema: SISTEMA_EXTRACCION,
      mensaje: mensajeExtraccion({ test, entidad: nombreEntidad, articulos, esAgrupacion }),
      esquema: ESQUEMA_EXTRACCION,
      senal: conPlazo(),
    }));
  } catch (e) {
    if (!e.porPlazo) throw e;
    // No se guarda: no es que no haya cifras, es que no ha dado tiempo a
    // buscarlas. Guardarlo sellaría como "sin cifras" algo que no se ha mirado.
    console.warn(`[plazo] ${test}: la extracción se ha cortado tras ${Date.now() - inicio} ms`);
    return {
      ...sinDatos("La búsqueda de este test no ha cabido en el tiempo disponible. Vuelve a intentarlo.", articulos),
      transitorio: true,
    };
  }

  // Lo que cuesta una extracción, medido en esta misma petición y con este
  // mismo modelo. Es la mejor estimación posible de lo que va a costar la
  // siguiente, y es lo que decide cuántas veces se puede volver a intentar sin
  // pasarse. Antes ese número estaba escrito a mano y por eso se pasó.
  const costeExtraccion = Date.now() - antesDeExtraer;
  const cabeOtraExtraccion = () => queda() > costeExtraccion + COSTE_DESCARGA;

  // Segunda pasada con el artículo entero, cuando el resumen se ha quedado
  // corto justo en lo que decide el color del semáforo.
  let pmcid = null;
  if (mereceTextoCompleto(datos) && !cabeOtraExtraccion()) {
    // Se deja constancia: sin esto, una escalada que nunca ocurre es
    // indistinguible de una que ocurre y no cambia nada.
    console.warn(
      `[pmc] ${test}: se salta el texto completo, quedan ${queda()} ms y una extracción cuesta ${costeExtraccion}`,
    );
  }
  if (mereceTextoCompleto(datos) && cabeOtraExtraccion()) {
    const fuente = articulos.find((a) => a.pmid === datos.pmid) || articulos[0];
    try {
      const completo = await textoCompleto(fuente.pmid, senal);
      if (completo) {
        const segunda = await pedirJson({
          sistema: SISTEMA_EXTRACCION,
          mensaje: mensajeExtraccionCompleta({ test, entidad: nombreEntidad, articulo: fuente, texto: completo.texto, esAgrupacion }),
          esquema: ESQUEMA_EXTRACCION,
          senal: conPlazo(),
        });
        // Solo se adopta si sigue encontrando el dato: el texto completo está
        // para afinar la valoración, no para perder una cifra que ya teníamos.
        if (segunda.datos?.encontrado) {
          datos = segunda.datos;
          pmcid = completo.pmcid;
        }
      }
    } catch (e) {
      console.warn(`[pmc] ${test}: ${e.message}`);
    }
  }

  // El modelo devuelve a veces la cifra en porcentaje pese a pedírsela como
  // proporción. Rechazarla sería tirar un dato bueno por un problema de unidades:
  // por encima de 1 solo puede ser un porcentaje, así que se convierte y se deja
  // constancia de que se ha tocado.
  const aProporcion = (x) => (typeof x === "number" && x > 1 && x <= 100 ? x / 100 : x);

  // Se aplica a toda extracción que llegue a adoptarse, también a la del
  // rescate: la bandera tiene que hablar de las cifras que se acaban
  // publicando, no de las de un intento que se descartó.
  let normalizada = false;
  const normalizar = (d) => {
    const snCruda = d.sn;
    const spCruda = d.sp;
    d.sn = aProporcion(d.sn);
    d.sp = aProporcion(d.sp);
    normalizada = d.sn !== snCruda || d.sp !== spCruda;
    return d;
  };
  normalizar(datos);

  const tieneSn = typeof datos.sn === "number";
  const tieneSp = typeof datos.sp === "number";

  // Rescate: el resumen no trae las cifras, pero el artículo puede traerlas.
  //
  // Es el caso más frecuente de la base, con diferencia: veinte de cuarenta y
  // cinco entradas se quedaban en "sin cifras publicadas". Y la mayoría de las
  // veces no es que no estén publicadas, es que no están en el resumen: un
  // estudio que compara ocho maniobras resume las dos mejores y deja las otras
  // seis en una tabla. Hasta ahora solo se bajaba al texto completo para afinar
  // el color de una revisión que ya tenía cifras, que es la situación en la que
  // menos falta hace.
  //
  // Se abre el artículo que más promete de los que están en abierto. Solo se
  // adopta si encuentra algo: un texto completo que tampoco da cifras deja el
  // resultado exactamente como estaba.
  let deRescate = null;
  const sinCifras = !datos.encontrado || (!tieneSn && !tieneSp);

  if (sinCifras && !cabeOtraExtraccion()) {
    console.warn(
      `[rescate] ${test}: no se abre ningún artículo, quedan ${queda()} ms y una extracción cuesta ${costeExtraccion}`,
    );
  }

  if (sinCifras && cabeOtraExtraccion()) {
    const disponibles = await abiertos(articulos.map((a) => a.pmid), senal);
    // Se prueban tantos como quepan. Cuántos son no lo decide un número escrito
    // a mano, sino lo que queda de presupuesto frente a lo que acaba de costar
    // la primera extracción: si el límite real resulta ser más generoso, se
    // aprovecha solo, y si es más corto, no se pasa.
    const candidatos = articulos.filter((a) => disponibles.has(a.pmid));

    if (!candidatos.length) {
      console.warn(`[rescate] ${test}: ninguno de los ${articulos.length} artículos está en abierto`);
    }

    for (const fuente of candidatos) {
      if (!cabeOtraExtraccion()) {
        console.warn(`[rescate] ${test}: se para tras quedarse sin tiempo, quedan ${queda()} ms`);
        break;
      }
      try {
        const completo = await textoCompletoAbierto(disponibles.get(fuente.pmid), senal, TOPE_RESCATE);
        if (!completo) continue;
        const otra = await pedirJson({
          sistema: SISTEMA_EXTRACCION,
          mensaje: mensajeExtraccionCompleta({ test, entidad: nombreEntidad, articulo: fuente, texto: completo.texto, esAgrupacion }),
          esquema: ESQUEMA_EXTRACCION,
          senal: conPlazo(),
        });
        if (otra.datos?.encontrado && (typeof otra.datos.sn === "number" || typeof otra.datos.sp === "number")) {
          datos = normalizar(otra.datos);
          deRescate = completo.pmcid;
          break;
        }
      } catch (e) {
        console.warn(`[rescate] ${test}: ${e.message}`);
      }
    }
  }

  if (deRescate) {
    pmcid = deRescate;
  } else if (!datos.encontrado || (!tieneSn && !tieneSp)) {
    const vacio = sinDatos(
      datos.notas || "Los artículos localizados no aportan sensibilidad ni especificidad para este test.",
      articulos,
    );
    await anotar(vacio);
    return vacio;
  }

  const tieneSnFinal = typeof datos.sn === "number";
  const tieneSpFinal = typeof datos.sp === "number";

  // Solo una de las dos. Ocurre mucho en patologías que se diagnostican por
  // clínica, donde los estudios no tienen grupo control sin la enfermedad y por
  // tanto no pueden calcular la especificidad. No permite concluir, pero decir
  // "sin cifras" cuando existe una sensibilidad publicada es peor: da a entender
  // que no se sabe nada.
  const parcial = !tieneSnFinal || !tieneSpFinal;

  const validacion = parcial
    ? validarParcial({ sn: datos.sn, sp: datos.sp })
    : validarPrecision({
        sn: datos.sn,
        sp: datos.sp,
        lrPositiva: datos.lrPositiva ?? undefined,
        lrNegativa: datos.lrNegativa ?? undefined,
      });

  if (!validacion.valido) {
    const rechazado = sinDatos(
      `Se localizaron cifras pero se han descartado por incoherencia: ${validacion.problemas.join(" ")}`,
      articulos,
    );
    await anotar(rechazado);
    return rechazado;
  }

  const fuente = articulos.find((a) => a.pmid === datos.pmid) || articulos[0];

  const indirecta = datos.mismaEntidad === false;

  // Comprobación de trazabilidad: los números que vamos a publicar tienen que
  // aparecer en la frase que el modelo dice haber copiado del artículo.
  const trazabilidad = comprobarCita(datos.citaLiteral, { sn: datos.sn, sp: datos.sp });

  // La ficha de valoración que rellena el modelo, tal cual, antes de que el
  // semáforo la resuma en un color. Se guarda junto al resultado porque el
  // color solo dice "no llega a verde", y la auditoría necesita saber por cuál
  // de los cinco criterios se queda fuera. Mientras no se guardó, el apartado
  // "qué impide el verde" contaba campos inexistentes y le salía el total en
  // todas las filas.
  const valoracion = {
    tipoEstudio: datos.tipoEstudio,
    amstar2: datos.amstar2,
    quadas2: datos.quadas2,
    consistencia: datos.consistencia,
    intervalos: datos.intervalos,
    numeroEstudios: datos.numeroEstudios || 1,
  };

  // Una agrupación solo puede llamarse validada si el artículo del que salen
  // las cifras describe esta misma combinación de tests y dice con qué regla
  // la da por positiva. Lo compara el código, no el modelo.
  const agrupacion = esAgrupacion
    ? comprobarAgrupacion({
        propuestos: componentes,
        delArticulo: datos.componentes,
        criterio: datos.criterioDelArticulo,
        bateria,
      })
    : null;

  // Las otras cifras publicadas del mismo test. No entran en el cálculo: la
  // sensibilidad y la especificidad salen de la misma tabla, y combinarlas
  // entre estudios daría un número que nadie ha medido. Se enseñan al lado para
  // que se vea entre qué valores se mueve la literatura, que es lo que una
  // cifra sola esconde.
  const otrasFuentes = depurarFuentes({
    candidatas: datos.otrasFuentes,
    articulos,
    pmidPrincipal: fuente?.pmid,
  });

  // La regla de elección pone por delante al estudio que publica las dos
  // cifras. Si aun así se cita uno con media cifra habiendo otro completo, el
  // modelo se la ha saltado: no se corrige aquí —faltarían la valoración de
  // calidad de ese otro estudio—, pero queda anotado para verlo en la revisión.
  if (parcial && otrasFuentes.some((o) => typeof o.sn === "number" && typeof o.sp === "number")) {
    console.warn(`[eleccion] ${test}: se cita un estudio con una sola cifra habiendo otro que publica las dos`);
  }

  const resultado = {
    hayCifras: true,
    agrupacion,
    otrasFuentes,
    // Solo se puede calcular probabilidad post-test con las dos cifras.
    interpretable: !parcial,
    parcial,
    falta: parcial ? (tieneSnFinal ? "especificidad" : "sensibilidad") : null,
    sn: tieneSnFinal ? datos.sn : null,
    sp: tieneSpFinal ? datos.sp : null,
    indirecta,
    entidadDeLasCifras: indirecta ? datos.entidadDeLasCifras : null,
    valoracion,
    calidad: semaforo({
      ...valoracion,
      indirecta,
      entidadDeLasCifras: datos.entidadDeLasCifras,
      parcial,
      falta: parcial ? (tieneSnFinal ? "especificidad" : "sensibilidad") : null,
    }),
    cita: {
      pmid: fuente.pmid,
      titulo: fuente.titulo,
      revista: fuente.revista,
      anio: fuente.anio,
      url: urlPubmed(fuente.pmid),
    },
    notas: datos.notas,
    // Deja constancia de que la valoración salió del artículo entero y no del
    // resumen: la auditoría necesita poder distinguirlo.
    deTextoCompleto: Boolean(pmcid),
    pmcid,
    citaLiteral: datos.citaLiteral || "",
    normalizadaDesdePorcentaje: normalizada,
    trazable: trazabilidad.verificada,
    trazabilidad,
    estrategia,
    consultados: articulos.map((a) => ({ pmid: a.pmid, titulo: a.titulo, url: urlPubmed(a.pmid) })),
  };

  // Cuánto ha costado de verdad. Es la única forma de saber si LIMITE_FUNCION
  // está puesto donde toca, porque el límite real de la pasarela no se puede
  // consultar desde dentro.
  console.log(
    `[tiempos] ${test}: total ${Date.now() - inicio} ms · extracción ${costeExtraccion} ms · ` +
      `${articulos.length} artículos · ${pmcid ? "con" : "sin"} texto completo`,
  );

  await anotar(resultado);
  return resultado;
}

export async function tamanoCache() {
  return cuantos(ALMACEN);
}
