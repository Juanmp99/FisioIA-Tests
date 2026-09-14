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

import { todos } from "./lib/almacen.js";
import { comprobarCita } from "./dominio/trazabilidad.js";
import { razonesDeVerosimilitud } from "./dominio/probabilidad.js";

const soloDudosas = process.argv.includes("--dudosas");

const num = (x) => (typeof x === "number" ? x.toFixed(2).replace(".", ",") : "no publicada");

// Con NETLIFY_SITE_ID y NETLIFY_API_TOKEN en el entorno, esto audita la base
// que ha construido producción. Sin ellas, la de desarrollo.
const base = await todos("evidencia");

const conCifras = [];
const sinCifras = [];

for (const v of base) {
  (v.hayCifras ? conCifras : sinCifras).push({ test: v.test || "?", entidad: v.entidad || "?", ...v });
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

// De dónde salió la valoración y en qué se queda el semáforo: es lo que dice
// si merece la pena seguir bajando al texto completo.
const completos = conCifras.filter((e) => e.deTextoCompleto).length;
console.log(`  Leídas del texto completo:   ${completos}`);

const porColor = {};
for (const e of conCifras) {
  const id = e.calidad?.id || "sin valorar";
  porColor[id] = (porColor[id] || 0) + 1;
}
console.log("\n  Semáforo:");
for (const [color, n] of Object.entries(porColor)) console.log(`    ${color.padEnd(12)} ${n}`);

// Por qué cada ficha se queda en ámbar. El semáforo exige los cinco criterios a
// la vez, así que el color por sí solo no dice cuál falla, y sin eso no se sabe
// si lo que falta es buscar mejor o si el listón está donde no se puede llegar.
//
// Cuenta sobre `valoracion`, que es la ficha que rellenó el modelo. Las entradas
// guardadas antes de que eso se almacenase no la tienen, y se apartan en vez de
// contarse como si les faltara todo.
const frena = {};
const sinFicha = [];
const suma = (m) => (frena[m] = (frena[m] || 0) + 1);

for (const e of conCifras) {
  if (e.calidad?.id === "verde") continue;
  const v = e.valoracion;
  if (!v) {
    sinFicha.push(e);
    continue;
  }
  if (e.parcial) suma("solo una de las dos cifras");
  if (e.indirecta) suma("cifras medidas sobre otra entidad");
  if (v.tipoEstudio !== "revision_sistematica") suma("no es revisión sistemática");
  else if (v.amstar2 !== "alta" && v.amstar2 !== "moderada") suma("revisión sistemática de calidad insuficiente (AMSTAR-2)");
  if (v.quadas2 !== "bajo") {
    suma(v.quadas2 === "dudoso" ? "QUADAS-2 dudoso" : "QUADAS-2 no valorable con lo publicado");
  }
  if (v.consistencia !== "consistente") {
    suma(v.consistencia === "discrepante" ? "los estudios discrepan" : "consistencia no valorable");
  }
  if (v.intervalos !== "estrecho") {
    suma(v.intervalos === "amplio" ? "intervalos de confianza amplios" : "intervalos de confianza no publicados");
  }
}

if (Object.keys(frena).length) {
  console.log("\n  Qué impide el verde:");
  for (const [motivo, n] of Object.entries(frena).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${motivo}`);
  }
}
if (sinFicha.length) {
  console.log(`\n    (${sinFicha.length} entradas anteriores al registro de la ficha de valoración: vacía la caché para recontarlas)`);
}

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
