// Vaciado de la base construida con el uso.
//
// Lo guardado se congela con su cita a propósito: es lo que hace que la misma
// pregunta dé siempre la misma respuesta. El precio es que una mejora en la
// forma de buscar no alcanza a lo que ya está dentro. Este comando existe para
// eso, y solo para eso.
//
//   npm run limpiar -- evidencia registro
//
// Vaciar no cuesta nada por sí mismo. El coste llega después, cuando alguien
// vuelva a preguntar por una patología y haya que buscarla de cero.

import { vaciar, cuantos } from "./lib/almacen.js";

/** Nunca, bajo ningún argumento. Aquí viven los accesos de quien se registró. */
const INTOCABLES = new Set(["acceso"]);

const CONOCIDOS = {
  evidencia: "las cifras de cada test con su cita",
  registro: "las baterías ya resueltas y sus entidades",
  aliento: "las frases de la pantalla de espera",
};

const pedidos = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const confirmado = process.argv.includes("--si");

if (!pedidos.length) {
  console.log("\nQué se puede vaciar:\n");
  for (const [nombre, que] of Object.entries(CONOCIDOS)) {
    console.log(`  ${nombre.padEnd(12)} ${que}`);
  }
  console.log("\n  acceso       PROTEGIDO: los accesos de quien se registró. No se toca.\n");
  console.log("Uso:  npm run limpiar -- evidencia registro --si\n");
  process.exit(0);
}

for (const nombre of pedidos) {
  if (INTOCABLES.has(nombre)) {
    console.error(`\nNo. "${nombre}" guarda los accesos de quien se ha registrado.`);
    console.error("Vaciarlo dejaría fuera a toda esa gente y tendrían que pedir el enlace otra vez.\n");
    process.exit(1);
  }
  if (!CONOCIDOS[nombre]) {
    console.error(`\nNo conozco el almacén "${nombre}". Ejecuta el comando sin argumentos para ver cuáles hay.\n`);
    process.exit(1);
  }
}

console.log("");
let total = 0;
for (const nombre of pedidos) {
  const hay = await cuantos(nombre);
  total += hay;
  console.log(`  ${nombre.padEnd(12)} ${String(hay).padStart(5)} elementos  ·  ${CONOCIDOS[nombre]}`);
}

if (!confirmado) {
  console.log(`\nSe borrarían ${total} elementos. Añade --si para hacerlo de verdad.\n`);
  process.exit(0);
}

console.log("");
for (const nombre of pedidos) {
  const borrados = await vaciar(nombre);
  console.log(`  ${nombre.padEnd(12)} ${String(borrados).padStart(5)} borrados`);
}
console.log("\nHecho. La próxima consulta de cada patología se buscará de cero.\n");
