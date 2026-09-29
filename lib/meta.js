// Eventos a Meta desde el servidor (API de conversiones).
//
// El píxel del navegador solo mide a quien acepta las cookies, y ni eso si
// tiene un bloqueador. Los dos eventos que importan para las campañas —dejar
// el correo (Lead) y entrar en la herramienta (CompleteRegistration)— pasan
// por nuestro servidor, así que se envían desde aquí: llegan todos. Solo de
// quien ha dejado su correo, nunca de quien solo mira la página.
//
// Si el píxel del navegador también lo manda, los dos llevan el mismo
// event_id y Meta se queda con uno. El correo viaja cifrado (SHA-256), como
// pide Meta.

import crypto from "node:crypto";

const PIXEL = process.env.META_PIXEL_ID || "1202847511931978";
const VERSION = process.env.META_API_VERSION || "v23.0";

// Nombre del producto en los eventos. DEBE coincidir con CONTENT_NAME de
// publico/consentimiento.js (el navegador) y con lo que se le pasó a la
// agencia: sin tilde, tal cual. Con él separan este producto de Nova y del
// resto en un píxel compartido.
const CONTENT_NAME = "Copiloto de exploracion";

export const hayMeta = () => Boolean(process.env.META_CAPI_TOKEN);

const cifrar = (texto) => crypto.createHash("sha256").update(texto.trim().toLowerCase()).digest("hex");

/** Solo lo que parezca un identificador de Meta; lo demás se descarta. */
const limpio = (valor) => (typeof valor === "string" && /^fb\.\d\.\d+\.[\w.-]{1,500}$/.test(valor) ? valor : undefined);

/**
 * Envía un evento. Nunca lanza: si Meta falla, se anota y el alta sigue su
 * curso. Perder una medición no puede costar un registro.
 */
export async function enviarEvento({ evento, idEvento, correo, ip, navegador, fbc, fbp, url, datos = {} }) {
  if (!hayMeta()) return "sin token";

  const usuario = { em: [cifrar(correo)] };
  if (ip && ip !== "desconocida") usuario.client_ip_address = ip;
  if (navegador) usuario.client_user_agent = String(navegador).slice(0, 500);
  if (limpio(fbc)) usuario.fbc = fbc;
  if (limpio(fbp)) usuario.fbp = fbp;

  const cuerpo = {
    data: [{
      event_name: evento,
      event_time: Math.floor(Date.now() / 1000),
      ...(idEvento ? { event_id: String(idEvento).slice(0, 100) } : {}),
      action_source: "website",
      ...(url ? { event_source_url: String(url).slice(0, 1000) } : {}),
      user_data: usuario,
      custom_data: { content_name: CONTENT_NAME, ...datos },
    }],
    // Con META_TEST_CODE puesto, los eventos aparecen en «Probar eventos» del
    // Administrador de eventos y no cuentan como reales.
    ...(process.env.META_TEST_CODE ? { test_event_code: process.env.META_TEST_CODE } : {}),
  };

  try {
    const r = await fetch(
      `https://graph.facebook.com/${VERSION}/${PIXEL}/events?access_token=${encodeURIComponent(process.env.META_CAPI_TOKEN)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(4000),
      },
    );
    if (r.ok) return "enviado";
    console.warn(`[meta] ${evento} rechazado: ${r.status} ${(await r.text()).slice(0, 300)}`);
    return `error ${r.status}`;
  } catch (e) {
    console.warn(`[meta] ${evento} no enviado: ${e.message}`);
    return `error ${e.message}`;
  }
}
