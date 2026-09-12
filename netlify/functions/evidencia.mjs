// Segundo tiempo: la evidencia de UN test.
//
// Un test por llamada. El navegador pide varios a la vez y pinta cada uno en
// cuanto llega, en lugar de esperar a que estén todos.

import { evidencia } from "../../lib/asistente.js";
import { json, error, cuerpoJson, conAcceso, cobrar, devolver } from "../../lib/http.js";

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
  if (!entidad || !elemento?.nombre) {
    return error("Faltan la entidad o el test que consultar.");
  }

  const cupo = await cobrar(puerta.registro);
  if (cupo.respuesta) return cupo.respuesta;

  try {
    const r = await evidencia({
      entidad,
      terminos: Array.isArray(cuerpo.terminosBusqueda) ? cuerpo.terminosBusqueda : [],
      elemento,
    });

    // De la caché: ni PubMed ni modelo, así que no se cobra.
    if (r.deCache) {
      await devolver(puerta.registro);
      return json({ evidencia: r });
    }

    return json({ evidencia: r, restantes: cupo.restantes });
  } catch (e) {
    console.error("[evidencia]", e);
    await devolver(puerta.registro);
    return error(e.message || "No se ha podido completar la operación.", e.status || 502);
  }
};

export const config = { path: "/api/evidencia" };
