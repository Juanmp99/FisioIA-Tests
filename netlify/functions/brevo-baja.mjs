// Aviso de Brevo: alguien se ha dado de baja desde un correo transaccional.
//
// Gmail pone un botón «Darse de baja» junto al remitente también en el correo
// de acceso. Quien lo pulsa quiere dejar de recibir correos de FisioIA, pero
// Brevo solo le bloquea los transaccionales y la newsletter le sigue llegando a
// diario. Este aviso lo marca también como baja de los comerciales, que es lo
// que pidió. Vale para los correos de acceso de todos los imanes de FisioIA:
// el aviso es de la cuenta de Brevo, no de esta herramienta.
//
// Brevo no firma sus avisos, así que se autentica con una clave en la URL que
// solo conocen Brevo y Netlify (BREVO_AVISOS_CLAVE).

import { darDeBajaComercial } from "../../lib/contactos.js";
import { json, error, cuerpoJson } from "../../lib/http.js";

/** Eventos que significan «no quiero correos vuestros». */
const DE_BAJA = new Set(["unsubscribed", "spam"]);

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  const clave = process.env.BREVO_AVISOS_CLAVE;
  if (!clave || new URL(req.url).searchParams.get("clave") !== clave) {
    return error("No autorizado.", 401);
  }

  let aviso;
  try {
    aviso = await cuerpoJson(req, 64 * 1024);
  } catch (e) {
    return error(e.message);
  }

  // Brevo puede mandar un aviso suelto o varios juntos.
  const avisos = Array.isArray(aviso) ? aviso : [aviso];
  const hechos = [];
  for (const a of avisos) {
    const correo = String(a?.email || "").trim().toLowerCase();
    if (!correo || !DE_BAJA.has(a?.event)) continue;
    try {
      const resultado = await darDeBajaComercial(correo);
      console.log(`[baja] ${correo}: ${a.event} en un transaccional → ${resultado}`);
      hechos.push({ correo, resultado });
    } catch (e) {
      // Un 5xx hace que Brevo reintente el aviso más tarde.
      console.error(`[baja] ${correo}: no se pudo marcar la baja`, e.message);
      return error("No se pudo marcar la baja.", 502);
    }
  }

  return json({ ok: true, hechos });
};

export const config = { path: "/api/brevo-baja" };
