// Interpretación de un resultado. Cálculo local y determinista: ni red, ni
// modelo, ni coste. Por eso no gasta cupo.

import { interpretar, acotarParcial, PRE_TEST } from "../../dominio/probabilidad.js";
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

  // Con una sola de las dos cifras no hay probabilidad post-test, pero sí hay
  // un límite: lo más que ese resultado puede llegar a aportar.
  const tieneSn = typeof sn === "number";
  const tieneSp = typeof sp === "number";
  if (tieneSn !== tieneSp) {
    return json({ parcial: true, ...acotarParcial({ nivelPreTest, sn, sp, resultado }) });
  }

  return json(interpretar({ nivelPreTest, sn, sp, resultado }));
};

export const config = { path: "/api/interpretar" };
