// Las líneas que acompañan a la espera. Adorno con límites: si falla, la
// interfaz se queda con las suyas fijas y no pasa nada.

import { frasesDeEspera } from "../../ia/aliento.js";
import { leer, escribir } from "../../lib/almacen.js";
import { normalizar } from "../../ia/entidades.js";
import { json, error, cuerpoJson, conAcceso } from "../../lib/http.js";

const ALMACEN = "aliento";

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  // No cobra cupo: es una llamada a Haiku que cuesta una millonésima, y cobrar
  // por ella castigaría al fisioterapeuta por un adorno que no ha pedido.
  const puerta = await conAcceso(req);
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch (e) {
    return error(e.message);
  }

  const sospecha = String(cuerpo.sospecha || "").trim();
  if (sospecha.length < 3 || sospecha.length > 300) return json({ frases: [] });

  const clave = normalizar(sospecha);
  const guardado = await leer(ALMACEN, clave);
  if (guardado?.frases?.length) return json({ frases: guardado.frases });

  const frases = await frasesDeEspera(sospecha);
  if (frases.length) await escribir(ALMACEN, clave, { frases, fecha: new Date().toISOString() });

  return json({ frases });
};

export const config = { path: "/api/aliento" };
