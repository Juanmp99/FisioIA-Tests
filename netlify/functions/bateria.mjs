// Primer tiempo: de la sospecha a la batería de tests.

import { bateria } from "../../lib/asistente.js";
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

  const sospecha = String(cuerpo.sospecha || "").trim();
  if (sospecha.length < 3) return error("Escribe la sospecha diagnóstica.");
  if (sospecha.length > 300) return error("La sospecha es demasiado larga.");

  const cupo = await cobrar(puerta.registro);
  if (cupo.respuesta) return cupo.respuesta;

  try {
    const r = await bateria(sospecha);

    // La sospecha ya estaba en el registro: no se ha llamado al modelo y no ha
    // costado nada, así que se devuelve la consulta reservada.
    if (r.deRegistro) {
      await devolver(puerta.registro);
      return json(r);
    }

    return json({ ...r, restantes: cupo.restantes });
  } catch (e) {
    console.error("[bateria]", e);
    await devolver(puerta.registro);
    return error(e.message || "No se ha podido completar la operación.", e.status || 502);
  }
};

export const config = { path: "/api/bateria" };
