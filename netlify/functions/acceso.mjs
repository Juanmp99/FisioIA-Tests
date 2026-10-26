// Alta: guarda el contacto y manda el enlace de acceso.
//
// El orden importa. Primero Brevo, después el correo: si el envío falla, el
// contacto ya está captado, que es para lo que existe esta herramienta. Al
// revés se perderían contactos por un fallo del proveedor de correo.

import { emitir, correoValido, normalizarCorreo } from "../../lib/acceso.js";
import { guardarContacto, desbloquearTransaccional, envioBloqueado } from "../../lib/contactos.js";
import { enviarAcceso, proveedorCorreo } from "../../lib/correo.js";
import { leer, escribir, limpiar } from "../../lib/almacen.js";
import { json, error, cuerpoJson } from "../../lib/http.js";
import { enviarEvento } from "../../lib/meta.js";
import { avisarCrm, esPrueba } from "../../lib/crm.js";

/** Altas por dirección IP y día. Frena el registro automatizado masivo. */
const ALTAS_POR_IP = Number(process.env.ALTAS_POR_IP) || 8;

/**
 * Los recuentos de altas por IP viven en su propio almacén, con el día al
 * principio de la clave, y solo se conservan el de hoy y el de ayer: sirven
 * para frenar registros automatizados en el día, y la política de privacidad
 * dice que no se usan para nada más. Guardarlos para siempre sería guardar una
 * lista de IPs que nadie necesita.
 */
const ALTAS_IP = "altas-ip";

async function limpiarAltasViejas(hoy) {
  try {
    const ayer = new Date(Date.parse(hoy) - 864e5).toISOString().slice(0, 10);
    await limpiar(ALTAS_IP, (k) => k.startsWith(hoy) || k.startsWith(ayer));

    // Antes se guardaban en el almacén de accesos. Se retiran una sola vez.
    if (!(await leer("acceso", "mantenimiento:altas-legado"))) {
      await limpiar("acceso", (k) => !k.startsWith("altas-"));
      await escribir("acceso", "mantenimiento:altas-legado", { hecho: new Date().toISOString() });
    }
  } catch (e) {
    console.warn("[acceso] No se pudieron limpiar los recuentos por IP:", e.message);
  }
}

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
  const previas = (await leer(ALTAS_IP, `${dia}:${ip}`)) || { altas: 0 };
  if (previas.altas >= ALTAS_POR_IP) {
    return error("Se han hecho demasiados registros desde esta conexión. Inténtalo mañana.", 429);
  }

  try {
    const { token } = await emitir(correo);

    await guardarContacto({ correo, token });
    await escribir(ALTAS_IP, `${dia}:${ip}`, { altas: previas.altas + 1 });
    await limpiarAltasViejas(dia);

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

    const origen = ORIGENES.has(cuerpo.origen) ? cuerpo.origen : "otro";
    await contarOrigen(origen, dia);

    // Cliente potencial para Meta, desde el servidor: llega aunque la persona
    // no aceptara cookies o tenga un bloqueador. El navegador manda el mismo
    // identificador con el píxel, si lo tiene, y Meta se queda con uno.
    //
    // Y el alta al CRM de FisioIA. Las dos a la vez: ninguna lanza y cada una
    // tiene su propio tope de tiempo.
    const meta = cuerpo.meta || {};
    await Promise.all([
      enviarEvento({
        evento: "Lead",
        idEvento: meta.id,
        correo,
        ip,
        navegador: req.headers.get("user-agent"),
        fbc: meta.fbc,
        fbp: meta.fbp,
        url: meta.url,
      }),
      avisarCrm({
        id: `copiloto-registro-${correo}`,
        tipo: "registro",
        correo,
        resumen: "Pidió acceso al copiloto de exploración",
        datos: { origen },
        prueba: esPrueba({ correo }),
      }),
    ]);

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
