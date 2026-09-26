// El trabajador: resuelve la evidencia de UN test, sin prisa.
//
// El sufijo -background del nombre del fichero no es decorativo: es lo que hace
// que Netlify le dé quince minutos en vez de treinta segundos, y que conteste
// 202 al instante en lugar de esperar al resultado. Todo lo demás de este
// fichero existe por esa segunda parte: como nadie va a esperar su respuesta,
// el resultado tiene que quedar escrito donde el navegador pueda ir a buscarlo.
//
// Y ahí está la suerte de esta arquitectura: ese sitio ya existía. Cada
// evidencia se guarda en su clave desde el primer día, para no repetir
// búsquedas. La caché ya era la cola de resultados sin que nadie lo hubiera
// planeado.

import { evidencia, revisarEvidencia } from "../../lib/asistente.js";
import { claveDe, deLaBase } from "../../ia/evidencia.js";
import { marcarFallo, olvidar } from "../../lib/encurso.js";
import { cuerpoJson, conAcceso, cobrar, devolver } from "../../lib/http.js";

export default async (req) => {
  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch {
    return new Response(null, { status: 202 });
  }

  const entidad = String(cuerpo.entidad || "").trim();
  const elemento = cuerpo.elemento;
  const terminos = Array.isArray(cuerpo.terminosBusqueda) ? cuerpo.terminosBusqueda : [];
  if (!entidad || !elemento?.nombre) return new Response(null, { status: 202 });

  const k = claveDe({ test: elemento.nombre, busqueda: elemento.busqueda, entidad, terminos });

  // El acceso se comprueba también aquí. El despachador ya lo hizo, pero este
  // punto tiene su propia dirección pública y no puede fiarse de que solo se
  // llegue por el camino previsto.
  const puerta = await conAcceso(req);
  if (puerta.respuesta) {
    await marcarFallo(k, "Tu acceso ya no es válido.", false);
    return new Response(null, { status: 202 });
  }

  // La revisión periódica no la paga quien hizo la consulta: es mantenimiento
  // de la base. Tampoco toca las marcas de trabajos en curso, porque el test
  // ya tiene su resultado. Solo se revisa lo que el despachador dejó marcado
  // como pendiente, así que llamar aquí a mano no lanza nada.
  if (cuerpo.revisar) {
    try {
      await revisarEvidencia({ entidad, terminos, elemento });
    } catch (e) {
      console.error("[revision]", e);
    }
    return new Response(null, { status: 202 });
  }

  // Se cobra aquí y no en el despachador: el coste lo genera el trabajo, y el
  // trabajo pasa aquí. Así una petición que solo pregunta "¿ya está?" no cuesta
  // nada por muchas veces que se repita.
  const cupo = await cobrar(puerta.registro);
  if (cupo.respuesta) {
    await marcarFallo(k, "La herramienta ha alcanzado su límite de consultas de hoy. Vuelve mañana.", false);
    return new Response(null, { status: 202 });
  }

  let r = null;
  let fallo = null;
  try {
    r = await evidencia({ entidad, terminos, elemento });
    if (r.deCache || r.transitorio) await devolver(puerta.registro);
  } catch (e) {
    console.error("[evidencia-background]", e);
    await devolver(puerta.registro);
    fallo = e.message;
  }

  // La marca solo se retira si el resultado está de verdad en la base.
  //
  // Se comprueba en vez de deducirse, y la diferencia no es teórica: la primera
  // versión daba por bueno todo lo que no fuese un error lanzado, y resultó que
  // hay un camino —lib/asistente.js se traga el fallo y devuelve un objeto sin
  // cifras— donde no se guarda nada y tampoco se lanza nada. El trabajador
  // borraba la marca, el navegador no encontraba resultado, volvía a pedirlo, y
  // el trabajo se relanzaba en bucle. Se vio porque la fecha de la marca
  // cambiaba entre sondeos.
  //
  // Preguntar a la base cierra ese agujero y todos los que no se me hayan
  // ocurrido: o el dato está, o esto es un fallo.
  if (await deLaBase(k)) {
    await olvidar(k);
  } else {
    await marcarFallo(
      k,
      fallo || r?.motivo || r?.error || "No se ha podido completar la búsqueda de este test.",
    );
  }

  return new Response(null, { status: 202 });
};

export const config = { path: "/api/evidencia-trabajo" };
