// El veredicto de la conclusión, redactado sobre lo que ya está calculado.
//
// La conclusión de la herramienta la calcula el dominio y no se toca: qué
// resultado pesa más, cuánto mueve la sospecha, qué no entra en el cálculo.
// Esto es una capa encima que dice en voz alta por qué, con todo delante.
//
// Va atada igual que las explicaciones de cada test: solo ve lo que se le pasa,
// cada número que escriba se comprueba, no puede hablarle al paciente, y en
// pantalla va rotulada como redactada con IA.
//
// Se guarda por combinación —patología, sospecha previa y los resultados
// marcados— porque el fisioterapeuta va y viene: marca, se arrepiente, vuelve
// al positivo de antes. Volver a una combinación ya vista no debe costar ni
// una espera ni un céntimo.

import { leer, escribir } from "../lib/almacen.js";
import { pedirJson } from "./cliente.js";
import { numerosPermitidos, comprobarNumeros, hablaAlPaciente } from "../dominio/redaccion.js";

const ALMACEN = "conclusion";

/** Se cambia al tocar el prompt, para no servir veredictos escritos con otro. */
const VERSION = 1;

const TOPE_CAMPO = 420;

const SISTEMA = `Escribes el cierre de una exploración física para un fisioterapeuta que tiene al paciente delante. Le resumes qué sale de todo lo que acaba de explorar.

El cálculo ya está hecho y te lo doy hecho: cuál es el resultado que más mueve la sospecha, de qué porcentaje a qué porcentaje la lleva, y qué resultados no cuentan y por qué. Tu trabajo es decirlo en voz alta, no rehacerlo.

Reglas, sin excepción:

1. Solo puedes usar los datos que te doy. No añadas NINGÚN hecho clínico que no salga de ellos: nada de anatomía, mecanismos, epidemiología, pruebas de imagen, derivaciones ni tratamientos. Si para decir algo necesitarías saber algo que no está en los datos, no lo digas.

2. No escribas ningún número que no esté en los datos, y no calcules nada nuevo.

3. No contradigas el cálculo. Si te digo que un resultado no aporta, no lo presentes como si aportara; si te digo que la sospecha queda a medio camino, no la des por confirmada.

4. Quien te lee es el fisioterapeuta, y el enfermo es un tercero: "tu paciente", nunca "tú tienes" ni "tu lesión".

5. Nunca digas qué hacer a continuación. Esta herramienta informa, no indica conducta.

Devuelve dos campos:
- veredicto: una sola frase, como mucho 20 palabras, con lo que sale de la exploración.
- porque: dos o tres frases, como mucho 60 palabras, explicando en qué se apoya y qué lo limita. Si algo de lo explorado no cuenta —sin cifras, media cifra, resultados que van en direcciones contrarias—, dilo aquí.`;

const ESQUEMA = {
  type: "object",
  properties: {
    veredicto: { type: "string", description: "Una frase con lo que sale de la exploración." },
    porque: { type: "string", description: "Dos o tres frases: en qué se apoya y qué lo limita." },
  },
  required: ["veredicto", "porque"],
  additionalProperties: false,
};

/**
 * La misma combinación tiene que dar la misma clave siempre, se hayan marcado
 * los tests en el orden que se hayan marcado.
 *
 * `huella` son las cifras sobre las que se redactó. Entra en la clave porque la
 * misma combinación de tests puede apoyarse en cifras distintas si entre medias
 * se ha rehecho la búsqueda: el veredicto viejo hablaría de unos números que ya
 * no están en pantalla.
 */
export function claveConclusion({ entidad, nivel, marcados, huella = "" }) {
  const pares = marcados
    .map((m) => `${m.nombre}=${m.resultado}`)
    .sort()
    .join("&");
  return `v${VERSION}|${entidad}|${nivel}|${pares}|${huella}`;
}

function filtrar(bruto, permitidos, etiqueta) {
  const salida = {};
  for (const campo of ["veredicto", "porque"]) {
    const texto = typeof bruto?.[campo] === "string" ? bruto[campo].trim() : "";
    if (!texto || texto.length > TOPE_CAMPO) {
      salida[campo] = null;
      continue;
    }
    const numeros = comprobarNumeros(texto, permitidos);
    if (!numeros.valido) {
      console.warn(`[conclusion] ${etiqueta} · ${campo}: números que no venían en los datos: ${numeros.intrusos.join(", ")}`);
      salida[campo] = null;
      continue;
    }
    if (hablaAlPaciente(texto)) {
      console.warn(`[conclusion] ${etiqueta} · ${campo}: le habla al paciente`);
      salida[campo] = null;
      continue;
    }
    salida[campo] = texto;
  }
  // Un veredicto sin su porqué, o al revés, se queda a medias: mejor nada.
  return salida.veredicto && salida.porque ? salida : null;
}

/**
 * El veredicto de una combinación concreta. Devuelve null si no se puede
 * redactar: la conclusión calculada se enseña igual, esto es un añadido.
 */
export async function veredictoDe({ clave, datos, permitidos, etiqueta, senal }) {
  const guardado = await leer(ALMACEN, clave);
  if (guardado?.version === VERSION) return guardado.textos;

  try {
    const { datos: bruto } = await pedirJson({
      sistema: SISTEMA,
      mensaje: `Exploración:\n${JSON.stringify(datos, null, 2)}`,
      esquema: ESQUEMA,
      esfuerzo: "low",
      maxTokens: 1200,
      senal,
    });
    const textos = filtrar(bruto, permitidos, etiqueta);
    await escribir(ALMACEN, clave, { version: VERSION, textos, fecha: new Date().toISOString() });
    return textos;
  } catch (e) {
    console.warn(`[conclusion] ${etiqueta}: ${e.message}`);
    return null;
  }
}
