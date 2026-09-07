// Auditoría de la base de evidencia.
//
// Pone cada cifra publicada al lado de la frase del artículo de la que dice
// venir, y del enlace a PubMed. Convierte "confía en que la extracción es
// correcta" en "compruébalo tú en dos segundos".
//
//   node auditoria.js            informe completo
//   node auditoria.js --dudosas  solo lo que no ha pasado la comprobación
//
// La comprobación automática busca los números en la frase citada. Lo que no
// puede comprobar ninguna máquina es si esa frase se refiere de verdad al test
// y a la patología que preguntamos. Eso es lo que hay que mirar a mano, y por
// eso el informe existe.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { comprobarCita } from "./dominio/trazabilidad.js";
import { razonesDeVerosimilitud } from "./dominio/probabilidad.js";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const soloDudosas = process.argv.includes("--dudosas");

const num = (x) => (typeof x === "number" ? x.toFixed(2).replace(".", ",") : "no publicada");

const base = JSON.parse(await fs.readFile(path.join(RAIZ, "datos", "cache.json"), "utf8"));

const conCifras = [];
const sinCifras = [];

for (const [clave, v] of Object.entries(base)) {
  const [test, entidad] = clave.split("|");
  (v.hayCifras ? conCifras : sinCifras).push({ test, entidad, ...v });
}

// Se recalcula la comprobación en el momento, para que el informe no dependa de
// lo que se guardó: si cambia el criterio, cambia la auditoría.
for (const e of conCifras) {
  e.check = e.citaLiteral === undefined
    ? { verificada: false, ausentes: ["extraído antes de exigir cita literal"], antiguo: true }
    : comprobarCita(e.citaLiteral, { sn: e.sn, sp: e.sp });
}

const dudosas = conCifras.filter((e) => !e.check.verificada);
const limpias = conCifras.filter((e) => e.check.verificada);

console.log("\n" + "=".repeat(78));
console.log("AUDITORÍA DE LA BASE DE EVIDENCIA");
console.log("=".repeat(78));
console.log(`\n  Entradas totales:            ${conCifras.length + sinCifras.length}`);
console.log(`  Con cifras publicadas:       ${conCifras.length}`);
console.log(`  Sin cifras:                  ${sinCifras.length}`);
console.log(`  Con cita comprobada:         ${limpias.length}`);
console.log(`  Pendientes de revisar:       ${dudosas.length}`);

function ficha(e) {
  console.log("\n" + "-".repeat(78));
  console.log(`${e.test.toUpperCase()}  ·  ${e.entidad}`);
  console.log(`  Sn ${num(e.sn)}   Sp ${num(e.sp)}` + (e.parcial ? "   [cifra parcial]" : "") + (e.indirecta ? `   [indirecta: ${e.entidadDeLasCifras}]` : ""));

  if (typeof e.sn === "number" && typeof e.sp === "number") {
    const lr = razonesDeVerosimilitud(e.sn, e.sp);
    console.log(`  RV+ ${lr.positiva.toFixed(2)}   RV− ${lr.negativa.toFixed(2)}   (derivadas, no extraídas)`);
  }

  console.log(`  Calidad: ${e.calidad?.etiqueta || "—"}`);
  (e.calidad?.motivos || []).forEach((m) => console.log(`    · ${m}`));

  if (e.cita) {
    console.log(`  Fuente: ${e.cita.titulo}`);
    console.log(`          ${e.cita.revista} ${e.cita.anio}`);
    console.log(`          ${e.cita.url}`);
  }

  if (e.citaLiteral) {
    console.log(`  Frase citada:`);
    console.log(`    "${e.citaLiteral}"`);
  }

  if (e.check.verificada) {
    console.log(`  ✓ Las cifras aparecen en la frase citada.`);
  } else {
    console.log(`  ! REVISAR: ${e.check.ausentes.join(", ")}`);
  }
}

if (dudosas.length) {
  console.log("\n\n" + "#".repeat(78));
  console.log("PENDIENTES DE REVISAR — empieza por aquí");
  console.log("#".repeat(78));
  dudosas.forEach(ficha);
}

if (!soloDudosas && limpias.length) {
  console.log("\n\n" + "#".repeat(78));
  console.log("CON CITA COMPROBADA — muestrea las que quieras");
  console.log("#".repeat(78));
  limpias.forEach(ficha);
}

console.log("\n" + "=".repeat(78));
console.log("Qué comprobar a mano en cada ficha:");
console.log("  1. Que la frase citada dice lo que dice, abriendo el enlace de PubMed.");
console.log("  2. Que esa frase se refiere a ESE test, y no a otro del mismo artículo.");
console.log("  3. Que se refiere a ESA patología, y no a una parecida.");
console.log("=".repeat(78) + "\n");
