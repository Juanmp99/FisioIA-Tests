// Revisión periódica de la evidencia guardada.
//
// Lo que tiene cifras se guarda y no caduca: es lo que hace que la misma
// pregunta dé siempre la misma respuesta. El precio es que, si la primera
// búsqueda no dio con el mejor estudio —al Jobe le tocó un estudio primario
// teniendo un metaanálisis entre los leídos—, se quedaba así para siempre.
//
// Aquí cada test lleva la cuenta de cuántas veces se ha consultado. Cada
// CADA_CONSULTAS, y como mucho una vez cada DIAS_MINIMOS, se lanza por detrás
// una búsqueda que va más allá de la primera: revisiones primero, lo publicado
// desde la última vez y sin parar al primer resultado completo. Quien hace la
// consulta no espera nada: recibe lo guardado, y el que se beneficia es el
// siguiente.
//
// Lo nuevo no sustituye a lo que había por ser nuevo. Se comparan los dos con
// el mismo orden que usa la búsqueda para elegir, y solo se cambia si lo nuevo
// es estrictamente mejor. Lo que había pasa a "otros estudios", el cambio queda
// registrado y la versión anterior se guarda para poder deshacerlo.

import { leer, escribir } from "../lib/almacen.js";
import { deLaBase, evidenciaDe, guardarEvidencia, supera } from "./evidencia.js";

const ALMACEN = "revision";

/** Cada cuántas consultas de un test se busca algo mejor. */
export const CADA_CONSULTAS = 15;

/** Y como mucho una vez cada tantos días: los estudios no salen tan deprisa. */
export const DIAS_MINIMOS = 30;

/** Si una revisión lanzada no ha terminado en este tiempo, se da por muerta. */
const CADUCIDAD_PENDIENTE = 20 * 60 * 1000;

/**
 * Tras un intento fallido, cuánto se espera antes de volver a probar. Sin esta
 * espera, un test que fallara siempre relanzaría una búsqueda cara en cada
 * consulta, porque el contador sigue por encima del umbral.
 */
const ESPERA_TRAS_FALLO_DIAS = 1;

/** A partir de tantos fallos seguidos, se espera ya al mes siguiente. */
const FALLOS_MAXIMOS = 3;

/** Cuántos cambios se recuerdan por test. */
const HISTORIAL_MAX = 10;

/**
 * ¿Toca revisar? Es puro para poder probarlo: recibe el estado del contador y
 * lo guardado, y dice si hay que lanzar la revisión.
 */
export function tocaRevisar(estado, guardado, ahora = Date.now()) {
  if (!guardado?.hayCifras) return false;
  if ((estado?.consultas || 0) < CADA_CONSULTAS) return false;
  const desde = estado?.ultima || guardado.fecha;
  if (desde && (ahora - new Date(desde).getTime()) / 86400000 < DIAS_MINIMOS) return false;
  if (estado?.pendiente && ahora - new Date(estado.pendiente).getTime() < CADUCIDAD_PENDIENTE) return false;
  if (estado?.ultimoFallo) {
    const dias = (ahora - new Date(estado.ultimoFallo).getTime()) / 86400000;
    const espera = (estado.fallos || 0) >= FALLOS_MAXIMOS ? DIAS_MINIMOS : ESPERA_TRAS_FALLO_DIAS;
    if (dias < espera) return false;
  }
  return true;
}

/**
 * Una revisión lanzada que no terminó —el trabajador murió sin avisar— cuenta
 * como un fallo más, con la fecha en que se lanzó. Así también ella espera.
 */
export function conPendienteCaducada(estado, ahora = Date.now()) {
  if (!estado?.pendiente || ahora - new Date(estado.pendiente).getTime() < CADUCIDAD_PENDIENTE) return estado || {};
  return { ...estado, pendiente: null, fallos: (estado.fallos || 0) + 1, ultimoFallo: estado.pendiente };
}

/**
 * Cuenta una consulta de un test que ya estaba en la base. Devuelve verdadero
 * si con esta toca revisar, y en ese caso la deja marcada como pendiente: el
 * trabajador solo revisa lo que el despachador ha marcado, así que llamarlo a
 * mano no lanza búsquedas.
 *
 * La cuenta es aproximada a propósito: dos consultas del mismo test en el
 * mismo instante pueden contar como una. Para decidir cada cuántas se revisa,
 * da igual.
 */
export async function contarConsulta(k, guardado) {
  const estado = conPendienteCaducada(await leer(ALMACEN, k));
  const consultas = (estado.consultas || 0) + 1;
  const toca = tocaRevisar({ ...estado, consultas }, guardado);
  await escribir(ALMACEN, k, {
    ...estado,
    // La clave va dentro para que la auditoría pueda decir cuál deshacer.
    clave: k,
    test: guardado?.test || estado.test || null,
    entidad: guardado?.entidad || estado.entidad || null,
    consultas,
    ...(toca ? { pendiente: new Date().toISOString() } : {}),
  });
  return toca;
}

/**
 * Las otras fuentes del resultado que se queda: las del nuevo, después el
 * estudio que se citaba antes y después las que ya había. Sin repetir, sin el
 * que ahora se cita y como mucho tres, como en la búsqueda.
 */
export function juntarFuentes(nuevo, viejo) {
  const citado = String(nuevo?.cita?.pmid || "");
  const anterior = viejo?.cita?.pmid
    ? [{
        pmid: String(viejo.cita.pmid),
        titulo: viejo.cita.titulo,
        revista: viejo.cita.revista,
        anio: viejo.cita.anio,
        url: viejo.cita.url,
        sn: viejo.sn,
        sp: viejo.sp,
        tipoEstudio: viejo.valoracion?.tipoEstudio || null,
        numeroEstudios: viejo.valoracion?.numeroEstudios || null,
        mismaEntidad: !viejo.indirecta,
        entidadDeLasCifras: viejo.indirecta ? viejo.entidadDeLasCifras : null,
        mismaParteQueElCitado: false,
        citaLiteral: viejo.citaLiteral || "",
      }]
    : [];
  const vistos = new Set([citado]);
  const salida = [];
  for (const o of [...(nuevo?.otrasFuentes || []), ...anterior, ...(viejo?.otrasFuentes || [])]) {
    const pmid = String(o?.pmid || "");
    if (!pmid || vistos.has(pmid)) continue;
    vistos.add(pmid);
    salida.push(o);
    if (salida.length >= 3) break;
  }
  return salida;
}

const resumen = (ev) =>
  ev?.hayCifras
    ? {
        pmid: ev.cita?.pmid || null,
        titulo: ev.cita?.titulo || null,
        sn: ev.sn ?? null,
        sp: ev.sp ?? null,
        tipoEstudio: ev.valoracion?.tipoEstudio || null,
        numeroEstudios: ev.valoracion?.numeroEstudios || null,
        calidad: ev.calidad?.id || null,
        indirecta: Boolean(ev.indirecta),
      }
    : null;

/**
 * La revisión en sí. La llama el trabajador en segundo plano. No hace nada si
 * el test no estaba marcado como pendiente.
 */
export async function revisar(k, { test, busqueda, nombresTest, entidad, terminos, tipo, componentes, bateria }) {
  const estado = (await leer(ALMACEN, k)) || {};
  if (!estado.pendiente) return { hecho: false, motivo: "no estaba pendiente" };

  const cerrar = (extra) =>
    escribir(ALMACEN, k, {
      ...estado,
      ...extra,
      consultas: 0,
      pendiente: null,
      fallos: 0,
      ultimoFallo: null,
      ultima: new Date().toISOString(),
    });

  const viejo = await deLaBase(k);
  if (!viejo?.hayCifras) {
    await cerrar({});
    return { hecho: false, motivo: "no hay nada con cifras que revisar" };
  }

  let nuevo = null;
  try {
    nuevo = await evidenciaDe({
      test, busqueda, nombresTest, entidad, terminos, tipo, componentes, bateria,
      revision: { desde: estado.ultima || viejo.fecha },
    });
  } catch (e) {
    console.warn(`[revision] ${test}: ${e.message}`);
  }

  // Un corte por plazo no es un resultado: lo que había se queda, y se vuelve
  // a probar más adelante, no en la consulta siguiente.
  if (!nuevo || nuevo.transitorio) {
    await escribir(ALMACEN, k, {
      ...estado,
      pendiente: null,
      fallos: (estado.fallos || 0) + 1,
      ultimoFallo: new Date().toISOString(),
    });
    return { hecho: false, motivo: "la búsqueda no ha terminado" };
  }

  const mismoEstudio = String(nuevo.cita?.pmid || "") === String(viejo.cita?.pmid || "");
  const cambia = !mismoEstudio && supera(nuevo, viejo);
  const entrada = {
    fecha: new Date().toISOString(),
    cambia,
    antes: resumen(viejo),
    despues: cambia ? resumen(nuevo) : null,
    candidato: cambia ? null : resumen(nuevo),
  };
  const historial = [entrada, ...(estado.historial || [])].slice(0, HISTORIAL_MAX);

  if (!cambia) {
    await cerrar({ historial });
    console.log(`[revision] ${test}: se queda lo que había`);
    return { hecho: true, cambia: false };
  }

  const revisado = {
    ...nuevo,
    otrasFuentes: juntarFuentes(nuevo, viejo),
    revisadaEl: entrada.fecha,
  };
  delete revisado.deCache;
  await guardarEvidencia(k, revisado);
  // La versión anterior, entera, para poder deshacer el cambio.
  await cerrar({ historial, anterior: viejo });
  console.log(
    `[revision] ${test}: ${viejo.cita?.pmid} → ${nuevo.cita?.pmid} ` +
      `(${viejo.valoracion?.tipoEstudio} → ${nuevo.valoracion?.tipoEstudio})`,
  );
  return { hecho: true, cambia: true };
}

/** Deshace el último cambio de un test: vuelve a poner lo que había. */
export async function deshacer(k) {
  const estado = await leer(ALMACEN, k);
  if (!estado?.anterior) return false;
  await guardarEvidencia(k, estado.anterior);
  await escribir(ALMACEN, k, {
    ...estado,
    anterior: null,
    historial: [{ fecha: new Date().toISOString(), deshecho: true }, ...(estado.historial || [])].slice(0, HISTORIAL_MAX),
  });
  return true;
}
