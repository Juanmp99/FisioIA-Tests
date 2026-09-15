// Canje del enlace del correo. La primera visita deja el acceso verificado;
// a partir de ahí el navegador guarda el token y entra solo.

import { verificar } from "../../lib/acceso.js";
import { json, error, tokenDe } from "../../lib/http.js";

export default async (req) => {
  const token = tokenDe(req);
  if (!token) return error("Falta el acceso.", 400);

  const registro = await verificar(token);
  if (!registro) return error("Este enlace de acceso no es válido.", 401);

  return json({ ok: true, correo: registro.correo });
};

export const config = { path: "/api/verificar" };
