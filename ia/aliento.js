// La línea que acompaña a la espera.
//
// Es lo único de esta herramienta que escribe un modelo y se muestra sin cita,
// así que el prompt lo acota con dureza: narra lo que el sistema está haciendo
// y nombra la sospecha, pero tiene prohibido afirmar nada clínico. Ni síntomas,
// ni mecanismos, ni qué tests se usan.
//
// El motivo no es estético. Lo clínico de esta herramienta sale de un artículo
// citado; una frase de relleno con aire médico sería la única excepción, y las
// excepciones son por donde se cae la credibilidad de todo lo demás.

import { pedirJson } from "./cliente.js";

export const MODELO_ALIENTO = "claude-haiku-4-5";

const SISTEMA = `Escribes líneas de estado que se muestran mientras un asistente clínico prepara una exploración para un fisioterapeuta.

Reglas, sin excepción:

1. No afirmes NADA clínico. Ni síntomas, ni mecanismos lesionales, ni epidemiología, ni qué estructuras se exploran, ni qué tests existen. Tu texto no es información médica y no puede parecerlo.

2. Describe únicamente lo que el sistema está haciendo en ese momento: reunir literatura, localizar revisiones sistemáticas, buscar estudios de precisión diagnóstica, cotejar cifras publicadas.

3. Nombra la sospecha tal como la ha escrito el fisioterapeuta, sin corregirla ni traducirla.

4. Entre seis y doce palabras. Termina en puntos suspensivos.

5. Tono sobrio y profesional. Nada de entusiasmo, de marketing ni de signos de exclamación.

Devuelve tres líneas distintas entre sí.`;

const ESQUEMA = {
  type: "object",
  properties: {
    frases: {
      type: "array",
      description: "Tres líneas de estado, de seis a doce palabras cada una.",
      items: { type: "string" },
    },
  },
  required: ["frases"],
  additionalProperties: false,
};

/** Tres líneas para la espera de esta sospecha. Nunca lanza: es adorno. */
export async function frasesDeEspera(sospecha) {
  try {
    const { datos } = await pedirJson({
      sistema: SISTEMA,
      mensaje: `Sospecha escrita por el fisioterapeuta: ${sospecha}`,
      esquema: ESQUEMA,
      modelo: MODELO_ALIENTO,
      esfuerzo: "low",
      maxTokens: 400,
    });
    const frases = (datos.frases || []).filter((f) => typeof f === "string" && f.trim().length > 4);
    return frases.slice(0, 3);
  } catch (e) {
    console.warn("[aliento] sin frases:", e.message);
    return [];
  }
}
