// Las explicaciones personalizadas de las cifras de UN test.
//
// Los datos que se explican no llegan en la petición: se leen de la base con la
// misma clave que la evidencia. Si se tomaran del cuerpo, cualquiera podría
// mandar cifras inventadas y recibir un texto que parecería salido de la
// herramienta.

import { claveDe, deLaBase, enriquecer } from "../../ia/evidencia.js";
import { explicacionDe } from "../../ia/explicaciones.js";
import { json, error, cuerpoJson, conAcceso } from "../../lib/http.js";

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  // No cobra cupo, como las frases de la espera: se genera una sola vez por
  // test y patología, y solo para evidencias que ya existen en la base.
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
  if (!entidad || !elemento?.nombre) return error("Faltan la entidad o el test.");

  const k = claveDe({ test: elemento.nombre, busqueda: elemento.busqueda, entidad, terminos });
  const ev = enriquecer(await deLaBase(k));
  if (!ev?.hayCifras) return json({ explicacion: null });

  const explicacion = await explicacionDe(k, ev, {
    test: elemento.nombre,
    entidad,
    // La función tiene 60 segundos. Con 45 cabe un segundo intento si el
    // candado descarta algo del primero; si no llega, la pantalla se queda con
    // el texto fijo y no pasa nada.
    senal: AbortSignal.timeout(45000),
  });

  return json({ explicacion });
};

export const config = { path: "/api/explicar" };
