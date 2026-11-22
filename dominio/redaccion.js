// El candado de los textos que redacta el modelo.
//
// Todo lo clínico de esta herramienta sale de un artículo citado. Las
// explicaciones personalizadas son la excepción consciente: las escribe un
// modelo para que se lean con naturalidad. Por eso no se le deja inventar, y no
// basta con pedírselo: se comprueba.
//
// Lo que se puede comprobar de forma mecánica son los números, que es también
// donde un error hace más daño: un "sube al 80%" inventado se lee exactamente
// igual que uno calculado. Así que cada número del texto tiene que estar entre
// los que se le dieron, en alguna de sus formas razonables (0,77 · 77 · 77%).
// Un texto con un número de fuera se descarta entero y la pantalla se queda con
// la explicación fija, que no depende de ningún modelo.
//
// Lo que no se puede comprobar mecánicamente —que no añada hechos clínicos sin
// número— lo acota el prompt, y lo delata la etiqueta "redactado con IA" en
// pantalla.

/** Números que un texto puede usar sin haberlos recibido: son del idioma, no del dato. */
const SIEMPRE = ["1", "2", "3", "10", "100"];

const normalizar = (n) => {
  const x = Number(String(n).replace(",", "."));
  if (!Number.isFinite(x)) return null;
  // Redondeado a dos decimales, que es la precisión con la que se enseña todo.
  return String(Math.round(x * 100) / 100);
};

/**
 * Todas las formas aceptables de los números de partida.
 *
 * Una proporción se puede escribir como tal o como porcentaje, y una razón de
 * verosimilitud con uno o dos decimales. Se admiten todas; lo que no se admite
 * es un número que no salga de ninguna.
 */
export function numerosPermitidos({ proporciones = [], razones = [], otros = [] }) {
  const permitidos = new Set(SIEMPRE);
  const anadir = (x) => {
    const n = normalizar(x);
    if (n !== null) permitidos.add(n);
  };

  for (const p of proporciones) {
    if (typeof p !== "number") continue;
    anadir(p);
    anadir(Math.round(p * 100));
    anadir(Math.round(p * 1000) / 10);
  }
  for (const r of razones) {
    if (typeof r !== "number" || !Number.isFinite(r)) continue;
    anadir(r);
    anadir(Math.round(r * 10) / 10);
    anadir(Math.round(r));
  }
  for (const o of otros) anadir(o);
  return permitidos;
}

/** Los números que aparecen escritos en un texto. */
export function numerosEn(texto) {
  return (String(texto || "").match(/\d+(?:[.,]\d+)?/g) || []).map(normalizar).filter((n) => n !== null);
}

/**
 * Frases que delatan que el texto se dirige al paciente y no al fisioterapeuta.
 *
 * Quien lee es quien explora, y el enfermo es un tercero: "aumenta la
 * probabilidad de que tu paciente lo tenga", nunca "de que tengas". El modelo
 * se despista con facilidad porque el resto del texto tutea, así que además de
 * pedírselo se comprueba. "Tu sospecha" y "tu paciente" son correctos y tienen
 * que seguir pasando.
 */
const AL_PACIENTE = [
  /\bque\s+(t[úu]\s+)?(tengas|tienes|padeces|padezcas|sufres|sufras)\b/i,
  /\btu\s+(lesi[óo]n|enfermedad|patolog[íi]a|dolor|s[íi]ntomas?|afecci[óo]n)\b/i,
  /\bsi\s+(t[úu]\s+)?(tienes|tuvieras|padeces)\b/i,
];

/** ¿Le está hablando al paciente en vez de al fisioterapeuta? */
export function hablaAlPaciente(texto) {
  return AL_PACIENTE.some((r) => r.test(String(texto || "")));
}

/**
 * ¿Se puede enseñar este texto?
 *
 * @returns {{ valido: boolean, intrusos: string[] }} los números que no venían en los datos.
 */
export function comprobarNumeros(texto, permitidos) {
  const intrusos = numerosEn(texto).filter((n) => !permitidos.has(n));
  return { valido: intrusos.length === 0, intrusos };
}
