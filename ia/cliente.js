import Anthropic from "@anthropic-ai/sdk";

export const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// El constructor no falla sin credencial: deja los campos a null y revienta en
// la primera petición. Lo comprobamos al arrancar para poder avisar con un
// mensaje útil en vez de con un error de red.
let cliente = null;
try {
  const c = new Anthropic();
  if (c.apiKey || c.authToken) cliente = c;
} catch {
  cliente = null;
}

export const hayCredencial = () => cliente !== null;

/** Llamada con salida estructurada. Devuelve el objeto ya analizado más el uso. */
export async function pedirJson({ sistema, mensaje, esquema, esfuerzo = "medium", maxTokens = 8000 }) {
  if (!cliente) {
    const e = new Error("El servidor no tiene configurada la clave de API. Define ANTHROPIC_API_KEY y reinícialo.");
    e.status = 503;
    throw e;
  }

  const respuesta = await cliente.messages.create({
    model: MODELO,
    max_tokens: maxTokens,
    system: sistema,
    output_config: { effort: esfuerzo, format: { type: "json_schema", schema: esquema } },
    messages: [{ role: "user", content: mensaje }],
  });

  if (respuesta.stop_reason === "refusal") {
    const e = new Error("El modelo ha declinado responder a esta consulta.");
    e.status = 422;
    throw e;
  }

  const bloque = respuesta.content.find((b) => b.type === "text");
  if (!bloque) throw new Error("El modelo no ha devuelto texto.");

  return {
    datos: JSON.parse(bloque.text),
    modelo: respuesta.model,
    uso: { entrada: respuesta.usage.input_tokens, salida: respuesta.usage.output_tokens },
  };
}
