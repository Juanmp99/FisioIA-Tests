// Estado de la instalación. No expone nada sensible: sirve para que la
// interfaz sepa qué modelo hay detrás y cuánta base construida existe.

import { MODELO, hayCredencial } from "../../ia/cliente.js";
import { tamanoCache } from "../../ia/evidencia.js";
import { PRE_TEST } from "../../dominio/probabilidad.js";
import { json } from "../../lib/http.js";

export default async () => {
  return json({
    modelo: MODELO,
    credencial: hayCredencial(),
    enCache: await tamanoCache(),
    niveles: PRE_TEST,
  });
};

export const config = { path: "/api/estado" };
