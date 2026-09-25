// El veredicto de la conclusión.
//
// Como en las explicaciones de cada test, las cifras no llegan en la petición:
// se leen de la base con la misma clave que la evidencia, y el cálculo lo rehace
// aquí el dominio. Lo único que manda el navegador es qué ha marcado el
// fisioterapeuta, que es lo único que solo él sabe.

import { claveDe, deLaBase, enriquecer } from "../../ia/evidencia.js";
import { claveConclusion, veredictoDe } from "../../ia/conclusion.js";
import { interpretar, PRE_TEST, pctMostrado } from "../../dominio/probabilidad.js";
import { numerosPermitidos } from "../../dominio/redaccion.js";
import { json, error, cuerpoJson, conAcceso } from "../../lib/http.js";

/** Cuánto se aleja de 1 una razón de verosimilitud, en cualquier dirección. */
const fuerza = (lr) => (lr >= 1 ? lr : 1 / lr);

export default async (req) => {
  if (req.method !== "POST") return error("Ruta no encontrada.", 404);

  const puerta = await conAcceso(req);
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo;
  try {
    cuerpo = await cuerpoJson(req);
  } catch (e) {
    return error(e.message);
  }

  const entidad = String(cuerpo.entidad || "").trim();
  const nivel = String(cuerpo.nivel || "");
  const terminos = Array.isArray(cuerpo.terminosBusqueda) ? cuerpo.terminosBusqueda : [];
  const marcados = Array.isArray(cuerpo.marcados) ? cuerpo.marcados.slice(0, 40) : [];
  if (!entidad || !PRE_TEST[nivel] || !marcados.length) return json({ conclusion: null });

  // Se rehace el cálculo con lo guardado. Nada de lo que decide el veredicto
  // sale de la petición: de ahí solo viene qué se ha marcado.
  const resultados = [];
  const proporciones = [];
  const razones = [];
  const otros = [PRE_TEST[nivel].valor * 100];
  // De qué cifras concretas sale este veredicto. Si la búsqueda se rehace y
  // cambian, el guardado deja de valer aunque la combinación sea la misma.
  const huella = [];
  let decisivo = null;

  for (const m of marcados) {
    const nombre = String(m.nombre || "");
    const resultado = m.resultado === "positivo" || m.resultado === "negativo" ? m.resultado : null;
    if (!nombre || !resultado) continue;

    const ev = enriquecer(await deLaBase(claveDe({ test: nombre, busqueda: m.busqueda, entidad, terminos })));
    huella.push(`${nombre}:${ev?.sn ?? "-"}/${ev?.sp ?? "-"}@${ev?.cita?.pmid ?? "-"}`);
    if (!ev || !ev.hayCifras) {
      resultados.push({ test: nombre, resultado, estado: "sin cifras publicadas" });
      continue;
    }
    if (ev.parcial) {
      resultados.push({ test: nombre, resultado, estado: `solo consta la ${ev.falta === "especificidad" ? "sensibilidad" : "especificidad"}, no entra en el cálculo` });
      continue;
    }

    const d = interpretar({ nivelPreTest: nivel, sn: ev.sn, sp: ev.sp, resultado });
    if (!d.interpretable) {
      resultados.push({ test: nombre, resultado, estado: "cifras no interpretables" });
      continue;
    }

    proporciones.push(ev.sn, ev.sp);
    // Los puntos que mueve, como se enseñan en pantalla: redondeando antes de restar.
    const mov = Math.round(d.detalle.postTest * 100) - Math.round(d.detalle.preTest * 100);
    otros.push(Math.abs(mov));
    razones.push(d.detalle.razonDeVerosimilitud);
    otros.push(pctMostrado(d.detalle.postTest));

    const ficha = {
      test: nombre,
      resultado,
      sensibilidad: ev.sn,
      especificidad: ev.sp,
      dejaLaSospechaEn: `${pctMostrado(d.detalle.postTest)}%`,
      puntosQueMueve: `${mov > 0 ? "+" : "-"}${Math.abs(mov)} puntos`,
      claseDeSenal: d.detalle.magnitud.texto,
      calidadDelEstudio: ev.calidad?.etiqueta || null,
      medidaSobreOtraPatologia: ev.indirecta ? ev.entidadDeLasCifras : null,
      sube: d.detalle.postTest > d.detalle.preTest,
    };
    resultados.push(ficha);
    if (d.detalle.magnitud.nivel !== "irrelevante") {
      if (!decisivo || fuerza(d.detalle.razonDeVerosimilitud) > fuerza(decisivo.lr)) {
        decisivo = { ficha, lr: d.detalle.razonDeVerosimilitud, lectura: d.lectura };
      }
    }
  }

  const suben = resultados.filter((r) => r.sube === true);
  const bajan = resultados.filter((r) => r.sube === false);

  const datos = {
    patologia: entidad,
    sospechaPrevia: `${PRE_TEST[nivel].etiqueta}, ${PRE_TEST[nivel].detalle}`,
    resultadosMarcados: resultados,
    elQueMasPesa: decisivo ? { ...decisivo.ficha, lecturaCalculada: decisivo.lectura } : null,
    ningunoDecide: !decisivo,
    resultadosEnDireccionesContrarias: suben.length > 0 && bajan.length > 0,
  };

  const { textos, motivo } = await veredictoDe({
    clave: claveConclusion({ entidad, nivel, marcados, huella: huella.sort().join(",") }),
    datos,
    permitidos: numerosPermitidos({ proporciones, razones, otros }),
    etiqueta: `${entidad} · ${marcados.length} marcados`,
    // La función tiene 60 segundos. Cortar a los 22, como se hacía, dejaba sin
    // veredicto las exploraciones largas justo cuando más falta hacía.
    senal: AbortSignal.timeout(45000),
  });

  return json({ conclusion: textos, motivo });
};

export const config = { path: "/api/concluir" };
