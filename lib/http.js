// Piezas comunes a todas las funciones: respuestas, lectura del cuerpo y la
// comprobación del acceso.

import { vigente, anotarConsulta, devolverConsulta, LIMITE_DIARIO } from "./acceso.js";

export const json = (cuerpo, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export const error = (mensaje, estado = 400) => json({ error: mensaje }, estado);

/** El cuerpo de una petición, con tope de tamaño. */
export async function cuerpoJson(req, limite = 256 * 1024) {
  const texto = await req.text();
  if (texto.length > limite) throw new Error("La petición es demasiado grande.");
  try {
    return JSON.parse(texto || "{}");
  } catch {
    throw new Error("Petición mal formada.");
  }
}

export const tokenDe = (req) =>
  req.headers.get("x-acceso") || new URL(req.url).searchParams.get("acceso") || "";

/**
 * Identifica a quien llama. No cobra nada: separar identificar de cobrar es lo
 * que permite rechazar una petición mal formada sin gastarle el cupo a nadie.
 *
 * Devuelve o bien `{ registro }` para seguir, o bien `{ respuesta }` ya hecha.
 */
export async function conAcceso(req) {
  // Atajo de desarrollo: permite usar la herramienta en local sin montar el
  // alta por correo. Se ignora en Netlify a propósito, para que dejarlo puesto
  // por descuido en el panel no abra la puerta en producción.
  if (process.env.ACCESO_LIBRE === "1" && !process.env.NETLIFY) {
    return { registro: { correo: "local", token: "local", consumo: {}, libre: true } };
  }

  const registro = await vigente(tokenDe(req));
  if (!registro) {
    return {
      respuesta: json(
        { error: "Necesitas un acceso válido. Pide el tuyo en la página de entrada.", acceso: "invalido" },
        401,
      ),
    };
  }
  return { registro };
}

/**
 * Reserva una consulta con coste. Se llama después de validar la petición y
 * antes de trabajar: después ya sería tarde para negar el servicio.
 *
 * Devuelve `{ respuesta }` si no queda cupo, o `{ restantes }` si lo hay.
 */
export async function cobrar(registro) {
  if (registro.libre) return { restantes: null };

  const cupo = await anotarConsulta(registro);
  if (cupo.permitido) return { restantes: cupo.restantes };

  const mensaje =
    cupo.motivo === "cupo_global"
      ? "La herramienta ha alcanzado su límite de consultas de hoy. Vuelve mañana."
      : `Has llegado a tu límite de ${LIMITE_DIARIO} consultas por día. Se renueva mañana.`;
  return { respuesta: json({ error: mensaje, acceso: "sin_cupo" }, 429) };
}

/** Deshace la reserva cuando la consulta no ha llegado a costar nada. */
export async function devolver(registro) {
  if (!registro.libre) await devolverConsulta(registro);
}
