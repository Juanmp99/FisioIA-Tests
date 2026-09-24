// Alta: guarda el contacto y manda el enlace de acceso.
//
// El orden importa. Primero Brevo, después el correo: si el envío falla, el
// contacto ya está captado, que es para lo que existe esta herramienta. Al
// revés se perderían contactos por un fallo del proveedor de correo.

import { emitir, correoValido, normalizarCorreo } from "../../lib/acceso.js";
import { guardarContacto, desbloquearTransaccional, envioBloqueado } from "../../lib/contactos.js";
import { enviarAcceso, proveedorCorreo } from "../../lib/correo.js";
import { leer, escribir } from "../../lib/almacen.js";
import { json, error, cuerpoJson } from "../../lib/http.js";

/** Altas por dirección IP y día. Frena el registro automatizado masivo. */
const ALTAS_POR_IP = Number(process.env.ALTAS_POR_IP) || 8;

/**
 * Desde qué formulario de la landing llega el alta. Lista cerrada: lo que no
 * esté aquí cuenta como "otro", para que nadie pueda llenar el almacén de
 * claves inventadas.
 */
const ORIGENES = new Set(["arriba", "final", "barra"]);

/**
 * Cuenta el alta por formulario y día, para saber cuál convierte.
 *
 * Va aparte de Brevo a propósito: un atributo que no exista en la cuenta hace
 * que Brevo rechace la petición entera, y el contacto se guardaría sin su
 * token. Y es lo último que se hace y nunca lanza: un recuento perdido no
 * puede costar un alta.
 */
async function contarOrigen(origen, dia) {
  try {
    const clave = `origen:${dia}:${origen}`;
    const previo = (await leer("acceso", clave)) || { altas: 0 };
    await escribir("acceso", clave, { altas: previo.altas + 1 });
  } catch (e) {
    console.warn("[acceso] No se pudo contar el origen:", e.message);
  }
}

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

    // Quien pulsó «Darse de baja» alguna vez está bloqueado para todo lo que
    // mande Brevo, también para el acceso que acaba de pedir.
    if (proveedorCorreo() === "brevo") {
      const bloqueo = await desbloquearTransaccional(correo);
      if (bloqueo === "desbloqueado") console.log(`[acceso] ${correo} estaba bloqueado; desbloqueado para enviarle su acceso.`);
    }

    const base = process.env.URL_PUBLICA || new URL(req.url).origin;
    const envio = await enviarAcceso({ correo, enlace: `${base}/app?acceso=${encodeURIComponent(token)}` });

    // Decir «revisa tu bandeja» cuando el correo no va a llegar es lo peor que
    // puede pasar aquí: el usuario espera algo que nunca aparece.
    if (proveedorCorreo() === "brevo" && (await envioBloqueado(envio?.messageId))) {
      console.error(`[acceso] Brevo bloqueó el envío a ${correo} pese al desbloqueo.`);
      return error(
        "No hemos podido enviarte el correo de acceso. Escríbenos a hola@fisioia.app y te lo mandamos a mano.",
        502,
      );
    }

    await contarOrigen(ORIGENES.has(cuerpo.origen) ? cuerpo.origen : "otro", dia);

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
