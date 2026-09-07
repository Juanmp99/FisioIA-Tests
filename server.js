import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pedirJson, hayCredencial, MODELO } from "./ia/cliente.js";
import { SISTEMA_BATERIA, ESQUEMA_BATERIA } from "./ia/prompts.js";
import { evidenciaDe, tamanoCache } from "./ia/evidencia.js";
import * as registro from "./ia/entidades.js";
import { interpretar, PRE_TEST } from "./dominio/probabilidad.js";
import { banderasPara, ADVERTENCIA } from "./dominio/banderas.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT) || 3200;
const APP = path.join(RAIZ, "publico", "index.html");

function json(res, codigo, cuerpo) {
  const datos = JSON.stringify(cuerpo);
  res.writeHead(codigo, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(datos),
  });
  res.end(datos);
}

function leerCuerpo(req, limite = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const trozos = [];
    req.on("data", (t) => {
      total += t.length;
      if (total > limite) {
        reject(new Error("La petición es demasiado grande."));
        req.destroy();
        return;
      }
      trozos.push(t);
    });
    req.on("end", () => resolve(Buffer.concat(trozos).toString("utf8")));
    req.on("error", reject);
  });
}

/* ============ primer tiempo: la batería ============ */

async function bateria(sospecha) {
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
      mensaje: "No he identificado ninguna entidad del aparato locomotor en lo que has escrito. Prueba con el nombre clínico de la sospecha.",
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

async function evidencias({ entidad, terminos, elementos }, senal) {
  const salida = [];
  for (const el of elementos) {
    try {
      const ev = await evidenciaDe({ test: el.nombre, busqueda: el.busqueda, entidad, terminos, senal });
      salida.push({ nombre: el.nombre, tipo: el.tipo || "test", ...ev });
    } catch (e) {
      salida.push({
        nombre: el.nombre,
        tipo: el.tipo || "test",
        hayCifras: false,
        error: e.message,
      });
    }
  }
  return salida;
}

/* ============ servidor ============ */

const servidor = http.createServer(async (req, res) => {
  const ruta = new URL(req.url, `http://${req.headers.host}`).pathname;

  if (req.method === "GET" && (ruta === "/" || ruta === "/index.html")) {
    try {
      const html = await fs.readFile(APP);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500).end("No se encuentra publico/index.html");
    }
    return;
  }

  if (req.method === "GET" && ruta === "/api/estado") {
    return json(res, 200, {
      modelo: MODELO,
      credencial: hayCredencial(),
      enCache: await tamanoCache(),
      registro: await registro.tamano(),
      niveles: PRE_TEST,
    });
  }

  if (req.method !== "POST") return json(res, 404, { error: "Ruta no encontrada." });

  let cuerpo;
  try {
    cuerpo = JSON.parse(await leerCuerpo(req));
  } catch (e) {
    return json(res, 400, { error: e.message || "Petición mal formada." });
  }

  try {
    if (ruta === "/api/bateria") {
      const sospecha = String(cuerpo.sospecha || "").trim();
      if (sospecha.length < 3) return json(res, 400, { error: "Escribe la sospecha diagnóstica." });
      if (sospecha.length > 300) return json(res, 400, { error: "La sospecha es demasiado larga." });

      const r = await bateria(sospecha);
      console.log(
        `[bateria] "${sospecha}" -> ${r.estado}` +
          (r.deRegistro ? " · del registro" : ` · ${r.uso.entrada}/${r.uso.salida} tokens`),
      );
      return json(res, 200, r);
    }

    if (ruta === "/api/evidencia") {
      const entidad = String(cuerpo.entidad || "").trim();
      const elementos = Array.isArray(cuerpo.elementos) ? cuerpo.elementos.slice(0, 10) : [];
      if (!entidad || !elementos.length) {
        return json(res, 400, { error: "Faltan la entidad o los tests que consultar." });
      }

      const r = await evidencias({ entidad, terminos: Array.isArray(cuerpo.terminosBusqueda) ? cuerpo.terminosBusqueda : [], elementos });
      const conCifras = r.filter((x) => x.hayCifras).length;
      console.log(`[evidencia] ${entidad} · ${r.length} elementos, ${conCifras} con cifras`);
      return json(res, 200, { evidencias: r });
    }

    if (ruta === "/api/interpretar") {
      // Cálculo local y determinista: ni red, ni modelo, ni coste.
      const { nivelPreTest, sn, sp, resultado } = cuerpo;
      if (!PRE_TEST[nivelPreTest]) return json(res, 400, { error: "Nivel de sospecha no válido." });
      if (resultado !== "positivo" && resultado !== "negativo") {
        return json(res, 400, { error: "El resultado debe ser positivo o negativo." });
      }
      return json(res, 200, interpretar({ nivelPreTest, sn, sp, resultado }));
    }

    return json(res, 404, { error: "Ruta no encontrada." });
  } catch (e) {
    console.error("Fallo:", e);
    const codigo = e.status || (e?.status === 429 ? 429 : 502);
    return json(res, codigo, { error: e.message || "No se ha podido completar la operación." });
  }
});

servidor.listen(PUERTO, async () => {
  console.log(`FisioIA · asistente de tests → http://localhost:${PUERTO}`);
  console.log(`Modelo: ${MODELO} · ${await tamanoCache()} elementos en caché`);
  if (!hayCredencial()) {
    console.log("Aviso: ANTHROPIC_API_KEY no está definida. La búsqueda y la batería devolverán error.");
  }
});
