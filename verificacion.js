// Verificación independiente del cálculo.
//
// Las pruebas de `pruebas.js` comprueban que el código hace lo que quisimos.
// Esto es otra cosa: comprueba que lo que quisimos es correcto, contrastando
// nuestro resultado contra una derivación que no comparte ni una línea de código
// ni la misma fórmula.
//
// El método es una cohorte simulada. Se toman cien mil pacientes con la
// prevalencia que marca la sospecha pre-test, se reparten según la sensibilidad
// y la especificidad, y se cuenta a mano cuántos de los que dieron positivo
// tenían realmente la lesión. Eso es la probabilidad post-test por definición,
// sin pasar por odds ni por razones de verosimilitud.
//
// Si el atajo por odds que usa la herramienta coincide con el recuento directo
// en miles de combinaciones, el cálculo es correcto. Si no, tenemos un problema.

import assert from "node:assert/strict";
import { postTest, razonesDeVerosimilitud, interpretar, PRE_TEST, pctMostrado } from "./dominio/probabilidad.js";

const COHORTE = 1_000_000;

/** Probabilidad post-test contada sobre una cohorte, sin usar razones de verosimilitud. */
function porRecuento(pre, sn, sp, positivo) {
  const enfermos = COHORTE * pre;
  const sanos = COHORTE - enfermos;

  const verdaderosPositivos = enfermos * sn;
  const falsosNegativos = enfermos - verdaderosPositivos;
  const verdaderosNegativos = sanos * sp;
  const falsosPositivos = sanos - verdaderosNegativos;

  return positivo
    ? verdaderosPositivos / (verdaderosPositivos + falsosPositivos)
    : falsosNegativos / (falsosNegativos + verdaderosNegativos);
}

/** El camino que usa la herramienta: pre-test, razón de verosimilitud, odds. */
function porFormula(pre, sn, sp, positivo) {
  const lr = razonesDeVerosimilitud(sn, sp);
  return postTest(pre, positivo ? lr.positiva : lr.negativa);
}

let comprobaciones = 0;
let peorDesviacion = 0;
let peorCaso = null;

function comparar(pre, sn, sp, positivo) {
  const recuento = porRecuento(pre, sn, sp, positivo);
  const formula = porFormula(pre, sn, sp, positivo);
  const desviacion = Math.abs(recuento - formula);

  if (desviacion > peorDesviacion) {
    peorDesviacion = desviacion;
    peorCaso = { pre, sn, sp, positivo, recuento, formula };
  }

  comprobaciones += 1;
  assert.ok(
    desviacion < 1e-9,
    `Discrepancia con pre ${pre}, Sn ${sn}, Sp ${sp}, ${positivo ? "positivo" : "negativo"}: ` +
      `recuento ${recuento} vs fórmula ${formula}`,
  );
}

console.log("\n1 · Barrido sistemático");

for (let pre = 0.05; pre <= 0.95; pre += 0.05) {
  for (let sn = 0.05; sn <= 0.95; sn += 0.05) {
    for (let sp = 0.05; sp <= 0.95; sp += 0.05) {
      comparar(pre, sn, sp, true);
      comparar(pre, sn, sp, false);
    }
  }
}
console.log(`  ok   ${comprobaciones.toLocaleString("es-ES")} combinaciones coinciden con el recuento directo`);
console.log(`       desviación máxima observada: ${peorDesviacion.toExponential(2)}`);

console.log("\n2 · Cifras reales de la literatura");

// Cifras extraídas por la herramienta en pruebas reales contra PubMed.
const REALES = [
  { test: "External rotation lag sign", sn: 0.56, sp: 0.98 },
  { test: "Hawkins-Kennedy", sn: 0.79, sp: 0.59 },
  { test: "Full can", sn: 0.7, sp: 0.81 },
  { test: "Neer", sn: 0.72, sp: 0.6 },
];

for (const t of REALES) {
  for (const nivel of Object.keys(PRE_TEST)) {
    const pre = PRE_TEST[nivel].valor;
    comparar(pre, t.sn, t.sp, true);
    comparar(pre, t.sn, t.sp, false);
  }
  console.log(`  ok   ${t.test} (Sn ${t.sn} · Sp ${t.sp}) en los tres niveles de sospecha`);
}

console.log("\n3 · Invariantes que deben cumplirse siempre");

function invariante(nombre, fn) {
  try {
    fn();
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    console.error(`  FALLA ${nombre}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

const azar = (min, max) => min + Math.random() * (max - min);

invariante("un resultado positivo nunca baja la sospecha", () => {
  for (let i = 0; i < 20000; i++) {
    const pre = azar(0.02, 0.98);
    const sn = azar(0.02, 0.98);
    const sp = azar(0.02, 0.98);
    // Solo tiene sentido en tests que no estén invertidos, es decir con LR+ >= 1.
    if (razonesDeVerosimilitud(sn, sp).positiva < 1) continue;
    assert.ok(porFormula(pre, sn, sp, true) >= pre - 1e-12);
  }
});

invariante("un resultado negativo nunca sube la sospecha", () => {
  for (let i = 0; i < 20000; i++) {
    const pre = azar(0.02, 0.98);
    const sn = azar(0.02, 0.98);
    const sp = azar(0.02, 0.98);
    if (razonesDeVerosimilitud(sn, sp).negativa > 1) continue;
    assert.ok(porFormula(pre, sn, sp, false) <= pre + 1e-12);
  }
});

invariante("la probabilidad siempre queda entre 0 y 1", () => {
  for (let i = 0; i < 20000; i++) {
    const pre = azar(0.01, 0.99);
    const sn = azar(0.01, 0.99);
    const sp = azar(0.01, 0.99);
    for (const positivo of [true, false]) {
      const p = porFormula(pre, sn, sp, positivo);
      assert.ok(p > 0 && p < 1, `fuera de rango: ${p}`);
    }
  }
});

invariante("a mayor especificidad, un positivo pesa más", () => {
  for (let i = 0; i < 5000; i++) {
    const pre = azar(0.1, 0.9);
    const sn = azar(0.3, 0.9);
    const sp1 = azar(0.3, 0.7);
    const sp2 = azar(0.75, 0.98);
    assert.ok(porFormula(pre, sn, sp2, true) > porFormula(pre, sn, sp1, true));
  }
});

invariante("a mayor sensibilidad, un negativo descarta más", () => {
  for (let i = 0; i < 5000; i++) {
    const pre = azar(0.1, 0.9);
    const sp = azar(0.3, 0.9);
    const sn1 = azar(0.3, 0.7);
    const sn2 = azar(0.75, 0.98);
    assert.ok(porFormula(pre, sn2, sp, false) < porFormula(pre, sn1, sp, false));
  }
});

invariante("un test sin poder discriminante no cambia nada", () => {
  // Sn + Sp = 1 equivale a lanzar una moneda: la razón de verosimilitud vale 1.
  for (let i = 0; i < 2000; i++) {
    const pre = azar(0.05, 0.95);
    const sn = azar(0.05, 0.95);
    const sp = 1 - sn;
    assert.ok(Math.abs(porFormula(pre, sn, sp, true) - pre) < 1e-9);
    assert.ok(Math.abs(porFormula(pre, sn, sp, false) - pre) < 1e-9);
  }
});

console.log("\n4 · Coherencia entre la cifra y la frase que la acompaña");

invariante("nunca dice que confirma si el test no ha aportado", () => {
  for (const nivel of Object.keys(PRE_TEST)) {
    for (let sn = 0.05; sn <= 0.95; sn += 0.05) {
      for (let sp = 0.05; sp <= 0.95; sp += 0.05) {
        for (const resultado of ["positivo", "negativo"]) {
          const r = interpretar({ nivelPreTest: nivel, sn, sp, resultado });
          if (!r.interpretable) continue;
          if (r.detalle.magnitud.nivel === "irrelevante") {
            assert.ok(
              !/[Cc]onfirma|[Dd]escarta/.test(r.lectura),
              `con Sn ${sn.toFixed(2)} Sp ${sp.toFixed(2)} y sospecha ${nivel} dice: ${r.lectura}`,
            );
          }
        }
      }
    }
  }
});

invariante("el porcentaje escrito coincide con el calculado", () => {
  for (const nivel of Object.keys(PRE_TEST)) {
    for (let sn = 0.1; sn <= 0.9; sn += 0.1) {
      for (let sp = 0.1; sp <= 0.9; sp += 0.1) {
        for (const resultado of ["positivo", "negativo"]) {
          const r = interpretar({ nivelPreTest: nivel, sn, sp, resultado });
          if (!r.interpretable) continue;
          const escrito = Number(r.detalle.postTestTexto.replace("%", ""));
          assert.equal(escrito, pctMostrado(r.detalle.postTest));
        }
      }
    }
  }
});

console.log(
  `\nVerificación completa: ${comprobaciones.toLocaleString("es-ES")} comparaciones contra el recuento directo, sin una sola discrepancia.\n`,
);
