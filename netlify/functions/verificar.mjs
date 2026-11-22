// Canje del enlace del correo. La primera visita deja el acceso verificado;
// a partir de ahí el navegador guarda el token y entra solo.

import { verificar } from "../../lib/acceso.js";
import { json, error, tokenDe } from "../../lib/http.js";
import { enviarEvento } from "../../lib/meta.js";
import { avisarCrm, esPrueba } from "../../lib/crm.js";

export default async (req, context) => {
  const token = tokenDe(req);
  if (!token) return error("Falta el acceso.", 400);

  const registro = await verificar(token);
  if (!registro) return error("Este enlace de acceso no es válido.", 401);

  // Registro completado para Meta, y primer uso para el CRM: la primera vez
  // que se abre el enlace, que es cuando alguien pasa de dejar su correo a
  // usar la herramienta.
  if (registro.primeraVez) {
    const q = new URL(req.url).searchParams;
    await Promise.all([
      enviarEvento({
        evento: "CompleteRegistration",
        idEvento: q.get("id_evento"),
        correo: registro.correo,
        ip: context?.ip,
        navegador: req.headers.get("user-agent"),
        fbp: q.get("fbp"),
        url: `${new URL(req.url).origin}/app`,
      }),
      avisarCrm({
        id: `copiloto-primer-uso-${registro.correo}`,
        tipo: "primer_uso",
        correo: registro.correo,
        resumen: "Entró por primera vez al copiloto",
        prueba: esPrueba({ correo: registro.correo, registro }),
      }),
    ]);
  }

  return json({ ok: true, correo: registro.correo, primeraVez: Boolean(registro.primeraVez) });
};

export const config = { path: "/api/verificar" };
