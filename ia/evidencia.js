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
import { comprobarCita, problemasDeCita } from "../dominio/trazabilidad.js";
import { comprobarAgrupacion } from "../dominio/agrupaciones.js";
import { depurarFuentes, rangoPublicado, comparableConCitado } from "../dominio/fuentes.js";
import { clasificacionesDe, recordarClasificaciones, avisoClasificadas } from "./clasificacion.js";

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
/**
 * Cuánto sirve una extracción para la pregunta del fisioterapeuta. Es el mismo
 * orden que se le pide al modelo al elegir: primero las dos cifras, después que
 * sean de la entidad preguntada, y al final lo que responde a otra pregunta.
 */
const UTILIDAD_MAXIMA = 5;
export function utilidad(d) {
  if (!d?.encontrado) return 0;
  const cifras = (typeof d.sn === "number" ? 1 : 0) + (typeof d.sp === "number" ? 1 : 0);
  if (!cifras) return 0;
  if (d.otraPregunta) return 1;
  const directa = d.mismaEntidad !== false;
  if (cifras === 2) return directa ? 5 : 4;
  return directa ? 3 : 2;
}

/**
 * ¿Son coherentes entre sí las cifras de una extracción? Con media cifra se
 * comprueba el rango; con las dos, además, que las razones de verosimilitud
 * declaradas cuadren con sensibilidad y especificidad. Si no cuadran, casi
 * siempre es que salen de filas o de estudios distintos.
 */
export function coherencia(d) {
  const conProporcion = (x) => (typeof x === "number" && x > 1 && x <= 100 ? x / 100 : x);
  const sn = conProporcion(d?.sn);
  const sp = conProporcion(d?.sp);
  const haySn = typeof sn === "number";
  const haySp = typeof sp === "number";
  if (!haySn && !haySp) return { valido: false, problemas: ["No hay ninguna cifra."] };
  if (!haySn || !haySp) return validarParcial({ sn: haySn ? sn : null, sp: haySp ? sp : null });
  return validarPrecision({
    sn,
    sp,
    lrPositiva: d.lrPositiva ?? undefined,
    lrNegativa: d.lrNegativa ?? undefined,
  });
}

/**
 * ¿Aparecen las cifras en la frase que el modelo dice haber copiado? Sin eso
 * no se sabe de dónde salen: en el Drop arm, el modelo las calculó él mismo a
 * partir de recuentos de una tabla, con las columnas al revés.
 */
export function trazable(d) {
  return comprobarCita(d?.citaLiteral, { sn: d?.sn, sp: d?.sp }).verificada;
}

/**
 * En qué orden se abren los textos completos: primero los que más prometen.
 * Antes se seguía el orden de PubMed y se probaban los cuatro primeros; en el
 * arco doloroso, el estudio que tenía la cifra estaba el decimoquinto.
 */
export function ordenarPorPromesa(articulos, { nombresTest = [], terminos = [] }) {
  const norma = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const palabras = (lista) => lista.map(norma).filter(Boolean);
  const tests = palabras(nombresTest);
  const entidad = palabras(terminos);
  const puntos = (a) => {
    const texto = norma(`${a.titulo} ${a.resumen || ""}`);
    let p = 0;
    if (tests.some((t) => texto.includes(t))) p += 3;
    if (entidad.some((t) => texto.includes(t))) p += 2;
    if (/sensitiv|specific|diagnostic accuracy|likelihood ratio|clinical tests?/.test(texto)) p += 1;
    return p;
  };
  return articulos
    .map((a, i) => ({ a, i, p: puntos(a) }))
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .map((x) => x.a);
}

/** Cuántos textos completos se abren para mejorar algo que ya se tiene. */
const INTENTOS_MEJORA = 6;

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
  // Cuáles se pueden comparar con la citada: lo decide el dominio, una vez.
  const otrasFuentes = (ev.otrasFuentes || []).map((o) => ({ ...o, comparable: comparableConCitado(o, ev) }));

  if (typeof ev.sn !== "number" || typeof ev.sp !== "number") {
    return { ...ev, otrasFuentes, rv: null, rango };
  }

  const lr = razonesDeVerosimilitud(ev.sn, ev.sp);
  return {
    ...ev,
    otrasFuentes,
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

  // Lo que ya se decidió en otros tests sobre qué mide cada artículo. Es una
  // pista para el modelo, no una imposición: una revisión puede dar cifras de
  // pinzamiento para un test y de rotura para otro, y lo que manda es la fila
  // que se cita. Imponerla le quitó al Jobe su metaanálisis.
  const conocidas = await clasificacionesDe(articulos.map((a) => a.pmid), termino).catch(() => new Map());
  const yaClasificadas = avisoClasificadas(conocidas, articulos.map((a) => a.pmid));

  // Lo que tiene que cumplir la frase citada para publicar la cifra: que no sea
  // una probabilidad de tener la patología y que nombre el test.
  const nombres = [test, consulta, ...(nombresTest || [])].filter(Boolean);
  const problemasCita = (d) => problemasDeCita(d?.citaLiteral, { nombres, esAgrupacion });
  const aceptable = (d) => trazable(d) && !problemasCita(d).length;
  // Cuánto vale una extracción: lo que no se puede publicar no vale nada.
  const valor = (d) => (problemasCita(d).length ? 0 : utilidad(d));

  const antesDeExtraer = Date.now();
  let datos;
  try {
    ({ datos } = await pedirJson({
      sistema: SISTEMA_EXTRACCION,
      mensaje: mensajeExtraccion({ test, entidad: nombreEntidad, articulos, esAgrupacion }) + yaClasificadas,
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
          mensaje: mensajeExtraccionCompleta({ test, entidad: nombreEntidad, articulo: fuente, texto: completo.texto, esAgrupacion }) +
            avisoClasificadas(conocidas, [fuente.pmid]),
          esquema: ESQUEMA_EXTRACCION,
          senal: conPlazo(),
        });
        // Solo se adopta si sigue encontrando el dato: el texto completo está
        // para afinar la valoración, no para perder una cifra que ya teníamos.
        // Y si sus cifras son coherentes: una segunda lectura que mezcla filas
        // no puede tirar una primera que estaba bien.
        if (segunda.datos?.encontrado && coherencia(segunda.datos).valido && aceptable(segunda.datos)) {
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
  //
  // Y no solo cuando no hay ninguna cifra. Si lo mejor del resumen es indirecto,
  // media cifra o responde a otra pregunta, también se abren los textos
  // completos: la cifra directa suele estar en una tabla. En la rotura del
  // manguito, el estudio de Van Kampen estaba entre los leídos, con las cifras
  // del Neer y del arco doloroso en su tabla 4, y se citaba en su lugar una
  // revisión sobre pinzamiento porque su resumen sí traía números.
  let deRescate = null;
  const sinCifras = !datos.encontrado || (!tieneSn && !tieneSp);
  const utilidadInicial = valor(datos);
  const buscarMejor = utilidadInicial < UTILIDAD_MAXIMA;
  // Con algo ya en la mano, se prueban unos pocos: es mejorar, no rescatar.
  const tope = sinCifras ? Infinity : INTENTOS_MEJORA;
  let probados = 0;

  if (buscarMejor && !cabeOtraExtraccion()) {
    console.warn(
      `[rescate] ${test}: no se abre ningún artículo, quedan ${queda()} ms y una extracción cuesta ${costeExtraccion}`,
    );
  }

  if (buscarMejor && cabeOtraExtraccion()) {
    const disponibles = await abiertos(articulos.map((a) => a.pmid), senal);
    // Se prueban tantos como quepan. Cuántos son no lo decide un número escrito
    // a mano, sino lo que queda de presupuesto frente a lo que acaba de costar
    // la primera extracción: si el límite real resulta ser más generoso, se
    // aprovecha solo, y si es más corto, no se pasa.
    const candidatos = ordenarPorPromesa(
      articulos.filter((a) => disponibles.has(a.pmid)),
      { nombresTest: [test, consulta, ...(nombresTest || [])], terminos: lista },
    );

    if (!candidatos.length) {
      console.warn(`[rescate] ${test}: ninguno de los ${articulos.length} artículos está en abierto`);
    }

    for (const fuente of candidatos) {
      if (probados >= tope) break;
      if (!cabeOtraExtraccion()) {
        console.warn(`[rescate] ${test}: se para tras quedarse sin tiempo, quedan ${queda()} ms`);
        break;
      }
      try {
        const completo = await textoCompletoAbierto(disponibles.get(fuente.pmid), senal, TOPE_RESCATE);
        if (!completo) continue;
        probados += 1;
        const otra = await pedirJson({
          sistema: SISTEMA_EXTRACCION,
          mensaje: mensajeExtraccionCompleta({ test, entidad: nombreEntidad, articulo: fuente, texto: completo.texto, esAgrupacion }) +
            avisoClasificadas(conocidas, [fuente.pmid]),
          esquema: ESQUEMA_EXTRACCION,
          senal: conPlazo(),
        });
        // Solo se adopta si es más útil que lo que había: un texto completo
        // que trae lo mismo, o algo peor, deja el resultado como estaba.
        const u = utilidad(otra.datos);
        if (u > valor(datos) && coherencia(otra.datos).valido && aceptable(otra.datos)) {
          // Las otras fuentes que ya se habían visto en los resúmenes no se
          // pierden: la extracción nueva solo ha leído un artículo.
          // Tampoco el que se había elegido: pasa a estar entre los otros. Si
          // el nuevo mide una parte, lo que decían de "la misma parte" se
          // refería al anterior, así que no se da por comparable.
          const nuevaEsParte = otra.datos?.mismaEntidad === false;
          const anterior = datos.pmid && (typeof datos.sn === "number" || typeof datos.sp === "number")
            ? [{
                pmid: datos.pmid, sn: datos.sn, sp: datos.sp, tipoEstudio: datos.tipoEstudio,
                numeroEstudios: datos.numeroEstudios, mismaEntidad: datos.mismaEntidad,
                entidadDeLasCifras: datos.entidadDeLasCifras, mismaParteQueElElegido: false,
                citaLiteral: datos.citaLiteral,
              }]
            : [];
          const previas = [...anterior, ...(datos.otrasFuentes || [])]
            .map((o) => (nuevaEsParte ? { ...o, mismaParteQueElElegido: false } : o));
          datos = normalizar(otra.datos);
          datos.otrasFuentes = [...(datos.otrasFuentes || []), ...previas];
          deRescate = completo.pmcid;
          console.warn(`[rescate] ${test}: el texto completo de ${fuente.pmid} mejora lo que había (${utilidadInicial} → ${u})`);
          if (u === UTILIDAD_MAXIMA) break;
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

  // Cifras que responden a otra pregunta diagnóstica no entran en el cálculo:
  // darían un porcentaje que no es el de la sospecha del fisioterapeuta. El
  // estudio queda entre los leídos, y el motivo, a la vista.
  if (datos.otraPregunta) {
    const vacio = {
      ...sinDatos(
        "Las cifras que hemos encontrado no sirven para esta sospecha: " +
          (datos.otraPreguntaMotivo || "el estudio responde a otra pregunta diagnóstica.") +
          " Que no haya cifras aplicables no significa que el test no tenga utilidad clínica.",
        articulos,
      ),
      otraPregunta: true,
    };
    await anotar(vacio);
    return vacio;
  }

  let tieneSnFinal = typeof datos.sn === "number";
  let tieneSpFinal = typeof datos.sp === "number";

  // Solo una de las dos. Ocurre mucho en patologías que se diagnostican por
  // clínica, donde los estudios no tienen grupo control sin la enfermedad y por
  // tanto no pueden calcular la especificidad. No permite concluir, pero decir
  // "sin cifras" cuando existe una sensibilidad publicada es peor: da a entender
  // que no se sabe nada.
  let parcial = !tieneSnFinal || !tieneSpFinal;

  let validacion = parcial
    ? validarParcial({ sn: datos.sn, sp: datos.sp })
    : validarPrecision({
        sn: datos.sn,
        sp: datos.sp,
        lrPositiva: datos.lrPositiva ?? undefined,
        lrNegativa: datos.lrNegativa ?? undefined,
      });

  // La frase citada tampoco puede ser una probabilidad ni dejar sin nombrar el
  // test: se trata igual que una incoherencia, con un segundo intento.
  const conProblemasDeCita = (v, d) => {
    const p = problemasCita(d);
    return p.length ? { valido: false, problemas: [...(v.valido ? [] : v.problemas || []), ...p] } : v;
  };
  validacion = conProblemasDeCita(validacion, datos);

  // Incoherente: se pide otra vez sobre los mismos resúmenes, diciéndole al
  // modelo qué no cuadra. Antes se tiraba el test entero a la primera, y en la
  // rotura del manguito se perdieron así el Jobe, el Drop arm y el External
  // rotation lag sign, que tenían cifras publicadas.
  if (!validacion.valido && !deRescate && cabeOtraExtraccion()) {
    try {
      const aviso =
        `\n\nTu respuesta anterior no se ha podido usar: ${validacion.problemas.join(" ")} ` +
        "Sensibilidad, especificidad y razones de verosimilitud tienen que salir del mismo estudio, de la misma fila y del mismo grupo de pacientes. " +
        "Si no encuentras las razones de verosimilitud en esa misma fila, déjalas en null. " +
        "La frase citada tiene que nombrar el test y dar su sensibilidad o su especificidad; si no hay ninguna así, devuelve encontrado en falso. Vuelve a extraer.";
      const otra = await pedirJson({
        sistema: SISTEMA_EXTRACCION,
        mensaje: mensajeExtraccion({ test, entidad: nombreEntidad, articulos, esAgrupacion }) + yaClasificadas + aviso,
        esquema: ESQUEMA_EXTRACCION,
        senal: conPlazo(),
      });
      if (otra.datos?.encontrado && coherencia(otra.datos).valido && !problemasCita(otra.datos).length) {
        console.warn(`[coherencia] ${test}: la segunda extracción sí es coherente`);
        datos = normalizar(otra.datos);
        tieneSnFinal = typeof datos.sn === "number";
        tieneSpFinal = typeof datos.sp === "number";
        parcial = !tieneSnFinal || !tieneSpFinal;
        validacion = conProblemasDeCita(coherencia(datos), datos);
      }
    } catch (e) {
      console.warn(`[coherencia] ${test}: ${e.message}`);
    }
  }

  if (!validacion.valido) {
    const rechazado = sinDatos(
      `Se localizaron cifras pero se han descartado: ${validacion.problemas.join(" ")}`,
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
    nombres,
    esAgrupacion,
  });

  // Lo que se ha decidido aquí sobre qué mide cada artículo pasa a valer para
  // los demás tests de esta patología.
  await recordarClasificaciones(
    [{ pmid: fuente?.pmid, mismaEntidad: !indirecta, entidadDeLasCifras: datos.entidadDeLasCifras }, ...otrasFuentes],
    termino,
    conocidas,
  ).catch(() => null);

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
