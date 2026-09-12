// Interpretación de un resultado. Cálculo local y determinista: ni red, ni
// modelo, ni coste. Por eso no gasta cupo.

import { interpretar, PRE_TEST } from "../../dominio/probabilidad.js";
import { json, error, cuerpoJson, conAcceso } from "../../lib/http.js";

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  // No se cobra: esto es aritmética local, no cuesta nada.
  const puerta = await conAcceso(req);
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch (e) {
    return error(e.message);
  }

  const { nivelPreTest, sn, sp, resultado } = cuerpo;
  if (!PRE_TEST[nivelPreTest]) return error("Nivel de sospecha no válido.");
  if (resultado !== "positivo" && resultado !== "negativo") {
    return error("El resultado debe ser positivo o negativo.");
  }

  return json(interpretar({ nivelPreTest, sn, sp, resultado }));
};

export const config = { path: "/api/interpretar" };
