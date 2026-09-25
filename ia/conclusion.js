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
const VERSION = 3;

const TOPE_CAMPO = 420;

const SISTEMA = `Escribes el cierre de una exploración física para un fisioterapeuta que tiene al paciente delante. Le resumes qué sale de todo lo que acaba de explorar.

El cálculo ya está hecho y te lo doy hecho: cuál es el resultado que más mueve la sospecha, de qué porcentaje a qué porcentaje la lleva, y qué resultados no cuentan y por qué. Tu trabajo es decirlo en voz alta, no rehacerlo.

Reglas, sin excepción:

1. Solo puedes usar los datos que te doy. No añadas NINGÚN hecho clínico que no salga de ellos: nada de anatomía, mecanismos, epidemiología, pruebas de imagen, derivaciones ni tratamientos. Si para decir algo necesitarías saber algo que no está en los datos, no lo digas.

2. No escribas ningún número que no esté en los datos, y no calcules nada nuevo.

3. No contradigas el cálculo. Si te digo que un resultado no aporta, no lo presentes como si aportara; si te digo que la sospecha queda a medio camino, no la des por confirmada.

4. Quien te lee es el fisioterapeuta, y el enfermo es un tercero: "tu paciente", nunca "tú tienes" ni "tu lesión".

5. Nunca digas qué hacer a continuación. Esta herramienta informa, no indica conducta.

6. Cada resultado trae dos cosas distintas, y no las mezcles. puntosQueMueve es cuánto ha cambiado la sospecha en este paciente: úsalo para hablar del cambio. claseDeSenal es una propiedad del test (señal muy clara, señal clara, señal débil o no sirve como señal): úsala con esas mismas palabras, que son las que el fisioterapeuta ve en pantalla, y no hables de "poder diagnóstico". Nunca llames "pequeño" a un cambio de muchos puntos solo porque la señal sea débil.

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

/**
 * Pasa el candado a los dos campos. Devuelve los textos si los dos valen, y en
 * cualquier caso los motivos de lo descartado, dichos para el modelo: se le
 * devuelven en el siguiente intento para que corrija justo eso.
 */
function filtrar(bruto, permitidos, etiqueta) {
  const salida = {};
  const motivos = [];
  for (const campo of ["veredicto", "porque"]) {
    const texto = typeof bruto?.[campo] === "string" ? bruto[campo].trim() : "";
    if (!texto) {
      salida[campo] = null;
      motivos.push(`el campo ${campo} venía vacío`);
      continue;
    }
    if (texto.length > TOPE_CAMPO) {
      salida[campo] = null;
      motivos.push(`el campo ${campo} era demasiado largo; respeta el tope de palabras`);
      continue;
    }
    const numeros = comprobarNumeros(texto, permitidos);
    if (!numeros.valido) {
      console.warn(`[conclusion] ${etiqueta} · ${campo}: números que no venían en los datos: ${numeros.intrusos.join(", ")}`);
      salida[campo] = null;
      motivos.push(`en ${campo} escribiste ${numeros.intrusos.join(", ")}, que no está en los datos; usa solo los números que te doy`);
      continue;
    }
    if (hablaAlPaciente(texto)) {
      console.warn(`[conclusion] ${etiqueta} · ${campo}: le habla al paciente`);
      salida[campo] = null;
      motivos.push(`en ${campo} te dirigiste al enfermo como si te leyera él; quien lee es el fisioterapeuta, y al enfermo se le llama "tu paciente"`);
      continue;
    }
    salida[campo] = texto;
  }
  // Un veredicto sin su porqué, o al revés, se queda a medias: mejor nada.
  return { textos: salida.veredicto && salida.porque ? salida : null, motivos };
}

/** Cuántas veces se pide antes de rendirse. Cada intento son unos segundos. */
const INTENTOS = 3;

/**
 * El veredicto de una combinación concreta.
 *
 * Devuelve `{ textos, motivo }`. Si no se ha podido redactar, `textos` es null y
 * `motivo` dice por qué: "plazo", "candado" o "error".
 *
 * Si el candado lo descarta, se vuelve a pedir, diciéndole al modelo qué falló.
 * Antes el primer descarte llegaba a la pantalla como un aviso de error, y para
 * quien lo leía era la herramienta rota, cuando un segundo intento casi siempre
 * pasa el control. Solo se guarda lo que sale bien.
 */
export async function veredictoDe({ clave, datos, permitidos, etiqueta, senal }) {
  const guardado = await leer(ALMACEN, clave);
  if (guardado?.version === VERSION && guardado.textos) return { textos: guardado.textos, motivo: null };

  const inicio = Date.now();
  const base = `Exploración:\n${JSON.stringify(datos, null, 2)}`;
  let aviso = "";
  let motivo = "candado";

  for (let intento = 1; intento <= INTENTOS; intento++) {
    if (senal?.aborted) return { textos: null, motivo: "plazo" };
    try {
      const { datos: bruto } = await pedirJson({
        sistema: SISTEMA,
        mensaje: base + aviso,
        esquema: ESQUEMA,
        esfuerzo: "low",
        maxTokens: 1200,
        senal,
      });
      const { textos, motivos } = filtrar(bruto, permitidos, etiqueta);
      if (textos) {
        console.log(`[conclusion] ${etiqueta}: redactado al intento ${intento}, en ${Date.now() - inicio} ms`);
        await escribir(ALMACEN, clave, { version: VERSION, textos, fecha: new Date().toISOString() });
        return { textos, motivo: null };
      }
      motivo = "candado";
      aviso = `\n\nTu respuesta anterior no se ha podido usar: ${motivos.join("; ")}. Vuelve a redactarla corrigiendo eso y respetando todas las reglas.`;
    } catch (e) {
      console.warn(`[conclusion] ${etiqueta}: intento ${intento}: ${e.message} (${Date.now() - inicio} ms)`);
      if (e.porPlazo) return { textos: null, motivo: "plazo" };
      motivo = "error";
    }
  }
  console.warn(`[conclusion] ${etiqueta}: sin veredicto tras ${INTENTOS} intentos (${motivo})`);
  return { textos: null, motivo };
}
