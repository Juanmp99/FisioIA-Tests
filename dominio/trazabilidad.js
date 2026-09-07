// Comprobación de que la cifra publicada está de verdad en el texto citado.
//
// El modelo devuelve, además de las cifras, la frase literal del artículo de
// donde las sacó. Aquí se comprueba programáticamente que los números aparecen
// en esa frase. No demuestra que la interpretación sea correcta, pero atrapa el
// fallo más grave posible: una cifra que no está en ninguna parte.
//
// No se rechaza el dato cuando falla, porque la cifra puede estar en una tabla o
// escrita con palabras. Se marca, y la auditoría enseña primero las marcadas.

/** Formas en que un artículo puede escribir una proporción. */
function variantes(x) {
  const pct = x * 100;
  const formas = [
    x.toFixed(2),
    x.toFixed(3).replace(/0$/, ""),
    String(x),
    pct.toFixed(0),
    pct.toFixed(1),
    pct.toFixed(2).replace(/0$/, ""),
  ];
  // Los artículos usan indistintamente punto y coma decimal.
  return [...new Set(formas.flatMap((f) => [f, f.replace(".", ",")]))].filter((f) => f.length > 1);
}

/**
 * @returns {{verificada: boolean, encontradas: string[], ausentes: string[]}}
 */
export function comprobarCita(cita, { sn, sp }) {
  const texto = String(cita || "");
  if (!texto.trim()) {
    return { verificada: false, encontradas: [], ausentes: ["no se aportó cita literal"] };
  }

  const encontradas = [];
  const ausentes = [];

  for (const [nombre, valor] of [["sensibilidad", sn], ["especificidad", sp]]) {
    if (typeof valor !== "number") continue;
    const hallada = variantes(valor).some((v) => texto.includes(v));
    (hallada ? encontradas : ausentes).push(nombre);
  }

  return { verificada: ausentes.length === 0 && encontradas.length > 0, encontradas, ausentes };
}
