// Adquisición de evidencia: caché, búsqueda, extracción y validación.
//
// La búsqueda en vivo no es una dependencia en tiempo de ejecución sino la
// forma de construir la base: se busca la primera vez y a partir de ahí el dato
// queda congelado con su cita. La segunda consulta del mismo test es instantánea
// e idéntica a la primera, que es lo que hace la herramienta reproducible.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buscarPrecision, urlPubmed } from "./pubmed.js";
import { pedirJson } from "./cliente.js";
import { SISTEMA_EXTRACCION, ESQUEMA_EXTRACCION, mensajeExtraccion } from "./prompts.js";
import { validarPrecision, validarParcial } from "../dominio/probabilidad.js";
import { semaforo } from "../dominio/calidad.js";
import { comprobarCita } from "../dominio/trazabilidad.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = path.join(RAIZ, "datos", "cache.json");

const normalizar = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const clave = (test, entidad) => `${normalizar(test)}|${normalizar(entidad)}`;

let memoria = null;

async function cargar() {
  if (memoria) return memoria;
  try {
    memoria = JSON.parse(await fs.readFile(ARCHIVO, "utf8"));
  } catch {
    memoria = {};
  }
  return memoria;
}

async function guardar(k, valor) {
  const base = await cargar();
  base[k] = { ...valor, fecha: new Date().toISOString() };
  await fs.mkdir(path.dirname(ARCHIVO), { recursive: true });
  await fs.writeFile(ARCHIVO, JSON.stringify(base, null, 2), "utf8");
}

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
  const consulta = busqueda || test;
  const lista = (Array.isArray(terminos) && terminos.length ? terminos : [entidad]).filter(Boolean);
  const termino = lista[0];
  const k = clave(consulta, termino);
  const base = await cargar();

  const guardado = base[k];
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
    await guardar(k, vacio);
    return vacio;
  }

  const { datos } = await pedirJson({
    sistema: SISTEMA_EXTRACCION,
    mensaje: mensajeExtraccion({ test, entidad: `${entidad} (${lista.join("; ")})`, articulos }),
    esquema: ESQUEMA_EXTRACCION,
  });

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
    await guardar(k, vacio);
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
    await guardar(k, rechazado);
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
    citaLiteral: datos.citaLiteral || "",
    normalizadaDesdePorcentaje: normalizada,
    trazable: trazabilidad.verificada,
    trazabilidad,
    estrategia,
    consultados: articulos.map((a) => ({ pmid: a.pmid, titulo: a.titulo, url: urlPubmed(a.pmid) })),
  };

  await guardar(k, resultado);
  return resultado;
}

export async function tamanoCache() {
  return Object.keys(await cargar()).length;
}
