// Alta: guarda el contacto y manda el enlace de acceso.
//
// El orden importa. Primero Brevo, después el correo: si el envío falla, el
// contacto ya está captado, que es para lo que existe esta herramienta. Al
// revés se perderían contactos por un fallo del proveedor de correo.

import { emitir, correoValido, normalizarCorreo } from "../../lib/acceso.js";
import { guardarContacto } from "../../lib/contactos.js";
import { enviarAcceso, proveedorCorreo } from "../../lib/correo.js";
import { leer, escribir } from "../../lib/almacen.js";
import { json, error, cuerpoJson } from "../../lib/http.js";

/** Altas por dirección IP y día. Frena el registro automatizado masivo. */
const ALTAS_POR_IP = Number(process.env.ALTAS_POR_IP) || 8;

export default async (req, context) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch (e) {
    return error(e.message);
  }

  const correo = normalizarCorreo(cuerpo.correo);
  if (!correoValido(correo)) return error("Escribe una dirección de correo válida.");

  const ip = context?.ip || "desconocida";
  const dia = new Date().toISOString().slice(0, 10);
  const previas = (await leer("acceso", `altas:${ip}:${dia}`)) || { altas: 0 };
  if (previas.altas >= ALTAS_POR_IP) {
    return error("Se han hecho demasiados registros desde esta conexión. Inténtalo mañana.", 429);
  }

  try {
    const { token } = await emitir(correo);

    await guardarContacto({ correo, token });
    await escribir("acceso", `altas:${ip}:${dia}`, { altas: previas.altas + 1 });

    if (!proveedorCorreo()) {
      return error("El envío de correo no está configurado. Avisa a FisioIA.", 503);
    }

    const base = process.env.URL_PUBLICA || new URL(req.url).origin;
    await enviarAcceso({ correo, enlace: `${base}/app?acceso=${encodeURIComponent(token)}` });

    return json({ ok: true, correo });
  } catch (e) {
    console.error("[acceso]", e);
    return error(
      "No hemos podido completar el registro. Vuelve a intentarlo en un minuto.",
      502,
    );
  }
};

export const config = { path: "/api/acceso" };
