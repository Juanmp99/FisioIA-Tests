// Los dos tiempos de la herramienta, sin nada de transporte.
//
// Vive aquí, y no en el servidor, porque hay dos transportes: el servidor HTTP
// para desarrollo local y las funciones de Netlify en producción. Si la lógica
// estuviera en uno de los dos, el otro acabaría siendo una copia que se queda
// atrás.

import { pedirJson } from "../ia/cliente.js";
import { SISTEMA_BATERIA, ESQUEMA_BATERIA } from "../ia/prompts.js";
import { evidenciaDe } from "../ia/evidencia.js";
import * as registro from "../ia/entidades.js";
import { banderasPara, ADVERTENCIA } from "../dominio/banderas.js";

/* ============ primer tiempo: la batería ============ */

export async function bateria(sospecha) {
  // Capa 1: la misma frase devuelve la misma batería, sin llamar al modelo.
  const yaVista = await registro.porTexto(sospecha);
  if (yaVista) return { ...yaVista, deRegistro: true, uso: { entrada: 0, salida: 0 } };

  const { datos, uso } = await pedirJson({
    sistema: SISTEMA_BATERIA,
    mensaje: `Sospecha del fisioterapeuta: ${sospecha}`,
    esquema: ESQUEMA_BATERIA,
  });

  if (!datos.reconocida) {
    return {
      estado: "no_reconocida",
      mensaje:
        "No he identificado ninguna entidad del aparato locomotor en lo que has escrito. Prueba con el nombre clínico de la sospecha.",
      uso,
    };
  }

  if (datos.ambigua) {
    return {
      estado: "ambigua",
      mensaje: "Eso describe una región o un síndrome, no una entidad concreta. ¿Cuál de estas te planteas?",
      alternativas: datos.alternativas,
      uso,
    };
  }

  // Capa 2: si alguno de los términos ya identifica una entidad registrada, se
  // adopta aquella en lugar de crear una variante nueva de lo mismo.
  const canonica = await registro.porTerminos(datos.terminosBusqueda);
  if (canonica) {
    await registro.registrar(sospecha, canonica);
    return { ...canonica, deRegistro: true, uso };
  }

  const resuelta = {
    estado: "ok",
    entidad: datos.entidad,
    // La literatura está en inglés y usa varios nombres para lo mismo. El
    // término en español sirve para mostrar; los ingleses, todos a la vez,
    // para buscar. Con uno solo perdíamos la mayoría de los artículos.
    terminosBusqueda: datos.terminosBusqueda,
    region: datos.region,
    // Las agrupaciones llegan aquí como propuesta del modelo. Hasta que la
    // búsqueda en literatura no las respalde se marcan como no verificadas, y
    // la interfaz no debe presentarlas como validadas.
    agrupaciones: datos.agrupaciones.map((a) => ({ ...a, verificada: false })),
    tests: datos.tests,
    banderas: banderasPara(datos.region),
    advertenciaBanderas: ADVERTENCIA,
  };

  await registro.registrar(sospecha, resuelta);
  return { ...resuelta, uso };
}

/* ============ segundo tiempo: la evidencia ============ */

/**
 * Evidencia de UN test.
 *
 * Antes se pedían todos los de la batería en una sola llamada y se resolvían
 * en serie: cada uno son varias consultas a PubMed más una extracción del
 * modelo, así que la primera búsqueda de una entidad nueva tardaba minutos.
 * Eso no cabe en los 60 segundos de una función de Netlify, y sobre todo deja
 * al fisioterapeuta mirando una pantalla en blanco sin saber si avanza.
 *
 * De uno en uno, el navegador los pide en paralelo y va pintando cada test en
 * cuanto llega.
 */
export async function evidencia({ entidad, terminos, elemento, senal }) {
  try {
    const ev = await evidenciaDe({
      test: elemento.nombre,
      busqueda: elemento.busqueda,
      // Los otros nombres del test en la literatura inglesa. Sin ellos se
      // perdían los artículos que llaman al mismo test de otra manera.
      nombresTest: Array.isArray(elemento.nombresBusqueda) ? elemento.nombresBusqueda.slice(0, 3) : [],
      entidad,
      terminos,
      senal,
    });
    return { nombre: elemento.nombre, tipo: elemento.tipo || "test", ...ev };
  } catch (e) {
    return {
      nombre: elemento.nombre,
      tipo: elemento.tipo || "test",
      hayCifras: false,
      error: e.message,
    };
  }
}
