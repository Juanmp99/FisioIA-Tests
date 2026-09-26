// El despachador: dice en qué punto está la evidencia de un test.
//
// Antes esta función hacía el trabajo y tardaba entre quince y treinta y cinco
// segundos, que es justo lo que no cabe en una función de Netlify. De ahí venían
// los cortes: quien acababa respondiendo era la pasarela, con una página de
// error en HTML, y el fisioterapeuta leía "Unexpected token '<'" en la ficha.
//
// Ahora contesta en milisegundos una de tres cosas: aquí tienes, se está
// haciendo, o no ha podido ser. El trabajo vive en evidencia-background, que
// tiene quince minutos. El navegador vuelve a preguntar cada dos segundos.
//
// El cambio de fondo no es de rendimiento: es que deja de existir un techo. La
// lectura del texto completo se saltaba "por falta de tiempo" en casi todas las
// consultas, y no porque no mereciera la pena, sino porque no cabía.

import { claveDe, deLaBase, enriquecer } from "../../ia/evidencia.js";
import { estadoDe, marcarEnCurso, olvidar } from "../../lib/encurso.js";
import { contarConsulta } from "../../ia/revision.js";
import { json, error, cuerpoJson, conAcceso, tokenDe } from "../../lib/http.js";

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  const puerta = await conAcceso(req);
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch (e) {
    return error(e.message);
  }

  const entidad = String(cuerpo.entidad || "").trim();
  const elemento = cuerpo.elemento;
  const terminos = Array.isArray(cuerpo.terminosBusqueda) ? cuerpo.terminosBusqueda : [];
  if (!entidad || !elemento?.nombre) {
    return error("Faltan la entidad o el test que consultar.");
  }

  const k = claveDe({ test: elemento.nombre, busqueda: elemento.busqueda, entidad, terminos });

  // 1. ¿Está ya? Es el caso más frecuente con diferencia, porque la base se
  //    construye una vez y se consulta muchas.
  const guardado = await deLaBase(k);
  if (guardado) {
    await olvidar(k);
    // Se cuenta la consulta y, cada tantas, se lanza por detrás una búsqueda
    // que intenta superar lo guardado. Quien pregunta no espera a nada de eso,
    // y si falla, lo guardado sigue ahí.
    try {
      if (await contarConsulta(k, guardado)) {
        const destino = new URL("/api/evidencia-trabajo", req.url).toString();
        await fetch(destino, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-acceso": tokenDe(req) },
          body: JSON.stringify({ entidad, terminosBusqueda: terminos, elemento, revisar: true }),
        });
      }
    } catch (e) {
      console.warn("[revision] no se ha podido lanzar", e?.message);
    }
    return json({ estado: "listo", evidencia: enriquecer({ ...guardado, deCache: true }) });
  }

  // 2. ¿Se está haciendo, o se intentó y no pudo ser?
  const marca = await estadoDe(k);
  if (marca?.estado === "fallo") {
    // Se cuenta una sola vez: después se olvida, para que el siguiente intento
    // empiece de cero en vez de heredar el fracaso del anterior.
    await olvidar(k);
    return json({ estado: "fallo", motivo: marca.motivo, reintentable: marca.reintentable !== false });
  }
  if (marca?.estado === "en_curso") {
    return json({ estado: "en_curso", desde: marca.desde });
  }

  // 3. Nadie se está ocupando. La marca va antes de lanzar, no después: si el
  //    navegador vuelve a preguntar mientras el trabajador arranca, tiene que
  //    encontrarse con que ya hay alguien.
  await marcarEnCurso(k, { test: elemento.nombre, entidad });

  const destino = new URL("/api/evidencia-trabajo", req.url).toString();
  try {
    // No se espera la respuesta a propósito: un trabajo en segundo plano
    // contesta 202 al instante y sigue por su cuenta. Lo único que importa de
    // esta llamada es que llegue.
    const r = await fetch(destino, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-acceso": tokenDe(req) },
      body: JSON.stringify({ entidad, terminosBusqueda: terminos, elemento }),
    });
    if (!r.ok && r.status !== 202) throw new Error(`el trabajo respondió ${r.status}`);
  } catch (e) {
    // Si ni siquiera ha arrancado, la marca miente y hay que quitarla: dejarla
    // haría que el navegador esperase cinco minutos a nadie.
    await olvidar(k);
    console.error("[evidencia] no se ha podido lanzar el trabajo", e);
    return error("No se ha podido iniciar la búsqueda de este test.", 502);
  }

  return json({ estado: "en_curso" });
};

export const config = { path: "/api/evidencia" };
