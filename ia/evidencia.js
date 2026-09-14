// Adquisición de evidencia: caché, búsqueda, extracción y validación.
//
// La búsqueda en vivo no es una dependencia en tiempo de ejecución sino la
// forma de construir la base: se busca la primera vez y a partir de ahí el dato
// queda congelado con su cita. La segunda consulta del mismo test es instantánea
// e idéntica a la primera, que es lo que hace la herramienta reproducible.

import { leer, escribir, cuantos } from "../lib/almacen.js";
import { buscarPrecision, urlPubmed } from "./pubmed.js";
import { textoCompleto } from "./pmc.js";
import { pedirJson } from "./cliente.js";
import { SISTEMA_EXTRACCION, ESQUEMA_EXTRACCION, mensajeExtraccion, mensajeExtraccionCompleta } from "./prompts.js";
import { validarPrecision, validarParcial } from "../dominio/probabilidad.js";
import { semaforo } from "../dominio/calidad.js";
import { comprobarCita } from "../dominio/trazabilidad.js";

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
 * Hasta cuándo se puede empezar la segunda pasada.
 *
 * Una función de Netlify muere a los 60 s. Para cuando llega esta decisión ya
 * se han gastado la búsqueda en PubMed y la primera extracción, que juntas
 * suelen irse a la treintena de segundos. El primer valor que puse aquí fueron
 * 25 s, medidos desde el principio de la función: el umbral quedaba por debajo
 * de lo que ya se había consumido, así que la escalada no se disparó ni una
 * sola vez. La auditoría lo cantó con un "leídas del texto completo: 0".
 *
 * Ahora son 32 s, que dejan 28 para bajar el artículo y volver a extraer.
 */
const MARGEN_ESCALADA = 32000;

/** Días tras los cuales se vuelve a intentar una búsqueda que no encontró nada. */
const CADUCIDAD_NEGATIVOS = 30;

const diasDesde = (iso) => (Date.now() - new Date(iso).getTime()) / 86400000;

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
export async function evidenciaDe({ test, busqueda, entidad, terminos, senal }) {
  const inicio = Date.now();
  const consulta = busqueda || test;
  const lista = (Array.isArray(terminos) && terminos.length ? terminos : [entidad]).filter(Boolean);
  const termino = lista[0];
  const k = clave(consulta, termino);
  const anotar = (valor) => guardar(k, valor, { test: consulta, entidad: termino });

  const guardado = await leer(ALMACEN, k);
  if (guardado) {
    const caducado =
      !guardado.hayCifras && guardado.fecha && diasDesde(guardado.fecha) > CADUCIDAD_NEGATIVOS;
    if (!caducado) return { ...guardado, deCache: true };
  }

  let articulos = [];
  let estrategia = "sin_resultados";
  try {
    const hallazgo = await buscarPrecision({ test: consulta, terminos: lista, senal });
    articulos = hallazgo.articulos;
    estrategia = hallazgo.estrategia;
  } catch (e) {
    // Un fallo de red no se guarda: puede haber datos y conviene reintentar luego.
    return { ...sinDatos(`No se ha podido consultar PubMed: ${e.message}`), transitorio: true };
  }

  if (!articulos.length) {
    const vacio = sinDatos("No se han localizado artículos de precisión diagnóstica para este test y esta entidad.");
    await anotar(vacio);
    return vacio;
  }

  const nombreEntidad = `${entidad} (${lista.join("; ")})`;

  let { datos } = await pedirJson({
    sistema: SISTEMA_EXTRACCION,
    mensaje: mensajeExtraccion({ test, entidad: nombreEntidad, articulos }),
    esquema: ESQUEMA_EXTRACCION,
  });

  // Segunda pasada con el artículo entero, cuando el resumen se ha quedado
  // corto justo en lo que decide el color del semáforo.
  let pmcid = null;
  if (mereceTextoCompleto(datos)) {
    const gastado = Date.now() - inicio;
    if (gastado >= MARGEN_ESCALADA) {
      // Se deja constancia: sin esto, una escalada que nunca ocurre es
      // indistinguible de una que ocurre y no cambia nada.
      console.warn(`[pmc] ${test}: se salta el texto completo, ya van ${Math.round(gastado / 1000)} s`);
    }
  }
  if (mereceTextoCompleto(datos) && Date.now() - inicio < MARGEN_ESCALADA) {
    const fuente = articulos.find((a) => a.pmid === datos.pmid) || articulos[0];
    try {
      const completo = await textoCompleto(fuente.pmid, senal);
      if (completo) {
        const segunda = await pedirJson({
          sistema: SISTEMA_EXTRACCION,
          mensaje: mensajeExtraccionCompleta({ test, entidad: nombreEntidad, articulo: fuente, texto: completo.texto }),
          esquema: ESQUEMA_EXTRACCION,
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

  const snCruda = datos.sn;
  const spCruda = datos.sp;
  datos.sn = aProporcion(datos.sn);
  datos.sp = aProporcion(datos.sp);
  const normalizada = datos.sn !== snCruda || datos.sp !== spCruda;

  const tieneSn = typeof datos.sn === "number";
  const tieneSp = typeof datos.sp === "number";

  if (!datos.encontrado || (!tieneSn && !tieneSp)) {
    const vacio = sinDatos(
      datos.notas || "Los artículos localizados no aportan sensibilidad ni especificidad para este test.",
      articulos,
    );
    await anotar(vacio);
    return vacio;
  }

  // Solo una de las dos. Ocurre mucho en patologías que se diagnostican por
  // clínica, donde los estudios no tienen grupo control sin la enfermedad y por
  // tanto no pueden calcular la especificidad. No permite concluir, pero decir
  // "sin cifras" cuando existe una sensibilidad publicada es peor: da a entender
  // que no se sabe nada.
  const parcial = !tieneSn || !tieneSp;

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

  const resultado = {
    hayCifras: true,
    // Solo se puede calcular probabilidad post-test con las dos cifras.
    interpretable: !parcial,
    parcial,
    falta: parcial ? (tieneSn ? "especificidad" : "sensibilidad") : null,
    sn: tieneSn ? datos.sn : null,
    sp: tieneSp ? datos.sp : null,
    indirecta,
    entidadDeLasCifras: indirecta ? datos.entidadDeLasCifras : null,
    calidad: semaforo({
      tipoEstudio: datos.tipoEstudio,
      amstar2: datos.amstar2,
      quadas2: datos.quadas2,
      consistencia: datos.consistencia,
      intervalos: datos.intervalos,
      numeroEstudios: datos.numeroEstudios || 1,
      indirecta,
      entidadDeLasCifras: datos.entidadDeLasCifras,
      parcial,
      falta: parcial ? (tieneSn ? "especificidad" : "sensibilidad") : null,
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

  await anotar(resultado);
  return resultado;
}

export async function tamanoCache() {
  return cuantos(ALMACEN);
}
