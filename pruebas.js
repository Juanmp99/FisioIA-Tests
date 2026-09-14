// Pruebas del núcleo determinista. Sin red y sin IA: si esto falla, falla la
// conclusión clínica, y tiene que poder comprobarse en un segundo.

import assert from "node:assert/strict";
import { PRE_TEST, razonesDeVerosimilitud, validarPrecision, postTest, magnitud, interpretar, validarParcial, necesitaCorreccion, pctMostrado, CORRECCION, acotarParcial } from "./dominio/probabilidad.js";
import { semaforo } from "./dominio/calidad.js";
import { banderasPara } from "./dominio/banderas.js";
import { coincidencia } from "./ia/entidades.js";
import { mereceTextoCompleto } from "./ia/evidencia.js";

let pasadas = 0;
const cerca = (a, b, t = 0.01) => Math.abs(a - b) < t;

function prueba(nombre, fn) {
  try {
    fn();
    pasadas += 1;
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    console.error(`  FALLA ${nombre}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("\nRazones de verosimilitud");

prueba("se derivan correctamente de sensibilidad y especificidad", () => {
  // Sn 0,80 y Sp 0,90 -> LR+ = 0,80/0,10 = 8 ; LR- = 0,20/0,90 = 0,22
  const lr = razonesDeVerosimilitud(0.8, 0.9);
  assert.ok(cerca(lr.positiva, 8));
  assert.ok(cerca(lr.negativa, 0.222));
});

console.log("\nDetector de extracciones erróneas");

prueba("acepta cuatro valores coherentes entre sí", () => {
  const r = validarPrecision({ sn: 0.8, sp: 0.9, lrPositiva: 8, lrNegativa: 0.22 });
  assert.equal(r.valido, true);
});

prueba("rechaza una razón de verosimilitud que no cuadra con Sn y Sp", () => {
  // El artículo dice LR+ = 3 pero de Sn 0,8 y Sp 0,9 se deduce 8: algo está mal extraído.
  const r = validarPrecision({ sn: 0.8, sp: 0.9, lrPositiva: 3 });
  assert.equal(r.valido, false);
  assert.match(r.problemas[0], /positiva/);
});

prueba("rechaza una sensibilidad fuera de rango", () => {
  const r = validarPrecision({ sn: 87, sp: 0.9 });
  assert.equal(r.valido, false);
});

prueba("rechaza una razón positiva menor que 1, que invertiría el test", () => {
  const r = validarPrecision({ sn: 0.5, sp: 0.2, lrPositiva: 0.6 });
  assert.equal(r.valido, false);
});

console.log("\nProbabilidad post-test");

prueba("una razón de verosimilitud de 1 no cambia nada", () => {
  assert.ok(cerca(postTest(0.45, 1), 0.45));
});

prueba("caso conocido: pre-test 0,50 con LR+ 10 da post-test 0,91", () => {
  assert.ok(cerca(postTest(0.5, 10), 0.909));
});

prueba("una razón negativa baja hunde la probabilidad", () => {
  assert.ok(postTest(0.45, 0.1) < 0.1);
});

console.log("\nMagnitud del cambio");

prueba("clasifica las bandas en ambos sentidos", () => {
  assert.equal(magnitud(12).nivel, "concluyente");
  assert.equal(magnitud(0.08).nivel, "concluyente");
  assert.equal(magnitud(6).nivel, "moderado");
  assert.equal(magnitud(1.2).nivel, "irrelevante");
});

console.log("\nInterpretación completa");

prueba("test muy específico positivo con sospecha alta confirma", () => {
  const r = interpretar({ nivelPreTest: "alta", sn: 0.7, sp: 0.98, resultado: "positivo" });
  assert.equal(r.interpretable, true);
  assert.match(r.lectura, /[Cc]onfirma/);
});

prueba("test muy sensible negativo con sospecha baja descarta", () => {
  const r = interpretar({ nivelPreTest: "baja", sn: 0.96, sp: 0.6, resultado: "negativo" });
  assert.match(r.lectura, /[Dd]escarta/);
});

prueba("un test mediocre no confirma aunque salga positivo", () => {
  // Jobe y compañía: sensibilidad y especificidad discretas. Positivo con
  // sospecha media no debe leerse como confirmación.
  const r = interpretar({ nivelPreTest: "media", sn: 0.75, sp: 0.62, resultado: "positivo" });
  assert.ok(!/[Cc]onfirma la sospecha/.test(r.lectura), `no debía confirmar: ${r.lectura}`);
  assert.match(r.lectura, /Refuerza|apenas cambia/);
});

prueba("avisa cuando el test es inútil", () => {
  const r = interpretar({ nivelPreTest: "media", sn: 0.55, sp: 0.5, resultado: "positivo" });
  assert.match(r.lectura, /apenas cambia la sospecha/);
});

prueba("un test que no aporta no confirma, aunque la sospecha previa fuera alta", () => {
  // Hawkins-Kennedy real: Sn 0,79 y Sp 0,59 dan una RV de 1,93, que no aporta
  // nada. Con sospecha alta el post-test roza el 85% y el umbral de confirmación
  // se cruza por la sospecha previa, no por el test. No puede decir "confirma".
  const r = interpretar({ nivelPreTest: "alta", sn: 0.79, sp: 0.59, resultado: "positivo" });
  assert.ok(!/[Cc]onfirma/.test(r.lectura), `no debía confirmar: ${r.lectura}`);
  assert.match(r.lectura, /apenas cambia la sospecha/);
  assert.match(r.lectura, /85%/);
});

prueba("un test que no aporta tampoco descarta con sospecha baja", () => {
  const r = interpretar({ nivelPreTest: "baja", sn: 0.55, sp: 0.5, resultado: "negativo" });
  assert.ok(!/[Dd]escarta/.test(r.lectura), `no debía descartar: ${r.lectura}`);
});

prueba("no interpreta si los datos no son válidos", () => {
  const r = interpretar({ nivelPreTest: "media", sn: 1.4, sp: 0.6, resultado: "positivo" });
  assert.equal(r.interpretable, false);
});

prueba("el detalle expone el recorrido completo", () => {
  const r = interpretar({ nivelPreTest: "alta", sn: 0.8, sp: 0.9, resultado: "positivo" });
  assert.ok(cerca(r.detalle.preTest, PRE_TEST.alta.valor));
  assert.ok(cerca(r.detalle.razonDeVerosimilitud, 8));
  assert.ok(r.detalle.postTest > r.detalle.preTest);
});

console.log("\nSemáforo de calidad");

prueba("verde solo con revisión buena, bajo sesgo, consistencia y precisión", () => {
  const s = semaforo({
    tipoEstudio: "revision_sistematica",
    amstar2: "alta",
    quadas2: "bajo",
    consistencia: "consistente",
    intervalos: "estrecho",
    numeroEstudios: 6,
  });
  assert.equal(s.id, "verde");
  assert.equal(s.permiteConclusion, true);
});

prueba("riesgo de sesgo alto manda a rojo aunque lo demás acompañe", () => {
  const s = semaforo({
    tipoEstudio: "revision_sistematica",
    amstar2: "alta",
    quadas2: "alto",
    consistencia: "consistente",
    intervalos: "estrecho",
    numeroEstudios: 6,
  });
  assert.equal(s.id, "rojo");
  assert.equal(s.permiteConclusion, false);
});

prueba("sin estudios es rojo y no permite conclusión", () => {
  const s = semaforo({ tipoEstudio: "ninguno", consistencia: "desconocida", intervalos: "desconocido", numeroEstudios: 0 });
  assert.equal(s.id, "rojo");
});

prueba("un estudio primario aislado es ámbar y explica por qué", () => {
  const s = semaforo({
    tipoEstudio: "estudio_primario",
    amstar2: null,
    quadas2: "bajo",
    consistencia: "desconocida",
    intervalos: "estrecho",
    numeroEstudios: 1,
  });
  assert.equal(s.id, "ambar");
  assert.ok(s.motivos.length > 0);
});

console.log("\nBanderas rojas");

prueba("lumbar incluye cola de caballo y las generales", () => {
  const b = banderasPara("lumbar");
  const ids = b.map((x) => x.id);
  assert.ok(ids.includes("cola-de-caballo"));
  assert.ok(ids.includes("fractura"));
});

prueba("hombro no arrastra banderas de otras regiones", () => {
  const ids = banderasPara("hombro").map((x) => x.id);
  assert.ok(!ids.includes("cola-de-caballo"));
  assert.ok(!ids.includes("trombosis-venosa"));
});

prueba("las urgentes salen primero", () => {
  const b = banderasPara("cervical");
  assert.equal(b[0].prioridad, "urgente");
});

prueba("toda bandera trae señales y acción", () => {
  for (const region of ["cervical", "lumbar", "rodilla", "hombro"]) {
    for (const b of banderasPara(region)) {
      assert.ok(b.senales.length > 0, `${b.id} sin señales`);
      assert.ok(b.accion && b.accion.length > 10, `${b.id} sin acción`);
    }
  }
});

console.log(`\n${pasadas} pruebas correctas.\n`);

console.log("\nCifras parciales");

prueba("valida una sensibilidad sola", () => {
  const r = validarParcial({ sn: 0.91, sp: null });
  assert.equal(r.valido, true);
});

prueba("rechaza una cifra parcial fuera de rango", () => {
  assert.equal(validarParcial({ sn: 91, sp: null }).valido, false);
});

prueba("rechaza que no haya ninguna cifra", () => {
  assert.equal(validarParcial({ sn: null, sp: null }).valido, false);
});

prueba("una cifra parcial nunca llega a verde, por buena que sea la revisión", () => {
  const s = semaforo({
    tipoEstudio: "revision_sistematica",
    amstar2: "alta",
    quadas2: "bajo",
    consistencia: "consistente",
    intervalos: "estrecho",
    numeroEstudios: 6,
    parcial: true,
    falta: "especificidad",
  });
  assert.equal(s.id, "ambar");
  assert.match(s.motivos.join(" "), /no la especificidad/);
});

console.log(`
${pasadas} pruebas correctas.
`);

console.log("\nRegistro de entidades");

prueba("reconoce una entidad por cualquiera de sus sinónimos", () => {
  const canonicas = {
    "tennis elbow": { entidad: "Epicondilalgia lateral" },
    "lateral epicondylitis": { entidad: "Epicondilalgia lateral" },
  };
  const r = coincidencia(["lateral epicondylalgia", "lateral epicondylitis"], canonicas);
  assert.equal(r.entidad, "Epicondilalgia lateral");
});

prueba("respeta el orden: gana el primer término que coincida", () => {
  const canonicas = { "tennis elbow": { entidad: "A" }, "lateral epicondylitis": { entidad: "B" } };
  assert.equal(coincidencia(["tennis elbow", "lateral epicondylitis"], canonicas).entidad, "A");
});

prueba("ignora mayúsculas, acentos y signos", () => {
  const canonicas = { "tennis elbow": { entidad: "A" } };
  assert.equal(coincidencia(["  Tennis-Elbow  "], canonicas).entidad, "A");
});

prueba("devuelve nulo cuando ningún término está registrado", () => {
  assert.equal(coincidencia(["rotator cuff tear"], { "tennis elbow": {} }), null);
});

prueba("no se rompe sin términos", () => {
  assert.equal(coincidencia(undefined, {}), null);
  assert.equal(coincidencia([], {}), null);
});

console.log("\nEscalada al texto completo");

// Leer el artículo entero cuesta dinero y tiempo. Estas reglas deciden cuándo
// vale la pena, así que conviene que no se muevan sin darse cuenta.

const revision = {
  encontrado: true,
  tipoEstudio: "revision_sistematica",
  intervalos: "desconocido",
  quadas2: "no_valorable",
};

prueba("una revisión sin intervalos ni valoración de sesgo merece el texto completo", () => {
  assert.equal(mereceTextoCompleto(revision), true);
});

prueba("le basta con que falte una de las dos cosas", () => {
  assert.equal(mereceTextoCompleto({ ...revision, quadas2: "bajo" }), true);
  assert.equal(mereceTextoCompleto({ ...revision, intervalos: "estrecho" }), true);
});

prueba("una revisión ya completa no se vuelve a leer", () => {
  assert.equal(mereceTextoCompleto({ ...revision, intervalos: "estrecho", quadas2: "bajo" }), false);
  assert.equal(mereceTextoCompleto({ ...revision, intervalos: "amplio", quadas2: "alto" }), false);
});

prueba("un estudio primario no se lee entero: no puede llegar a verde igualmente", () => {
  assert.equal(mereceTextoCompleto({ ...revision, tipoEstudio: "estudio_primario" }), false);
});

prueba("sin cifras encontradas no hay nada que afinar", () => {
  assert.equal(mereceTextoCompleto({ ...revision, encontrado: false }), false);
});

console.log("\nPrecisiones perfectas");

// La literatura publica especificidades de 1,00 con frecuencia, y son justo
// las de los tests más útiles para confirmar. Se rechazaban enteras.

prueba("una especificidad de 1,00 es válida", () => {
  assert.equal(validarPrecision({ sn: 0.72, sp: 1 }).valido, true);
});

prueba("una sensibilidad de 1,00 también", () => {
  assert.equal(validarPrecision({ sn: 1, sp: 0.85 }).valido, true);
});

prueba("lo que está de verdad fuera de rango se sigue rechazando", () => {
  assert.equal(validarPrecision({ sn: 0.7, sp: 1.3 }).valido, false);
  assert.equal(validarPrecision({ sn: 0.7, sp: 0 }).valido, false);
  assert.equal(validarPrecision({ sn: -0.1, sp: 0.8 }).valido, false);
});

prueba("la razón de verosimilitud nunca sale infinita", () => {
  const a = razonesDeVerosimilitud(0.72, 1);
  const b = razonesDeVerosimilitud(1, 0.85);
  assert.ok(Number.isFinite(a.positiva) && Number.isFinite(a.negativa));
  assert.ok(Number.isFinite(b.positiva) && Number.isFinite(b.negativa));
});

prueba("una especificidad perfecta confirma, pero sin prometer certeza", () => {
  const r = interpretar({ nivelPreTest: "media", sn: 0.72, sp: 1, resultado: "positivo" });
  assert.equal(r.interpretable, true);
  assert.equal(r.detalle.corregida, true);
  assert.ok(/[Cc]onfirma/.test(r.lectura));
  assert.ok(r.detalle.postTest < 1, "la probabilidad nunca llega a 1");
});

prueba("se avisa solo cuando alguna cifra es exactamente 1", () => {
  assert.equal(necesitaCorreccion(0.99, 0.99), false);
  assert.equal(necesitaCorreccion(1, 0.5), true);
  assert.equal(necesitaCorreccion(0.5, 1), true);
});

prueba("el porcentaje mostrado nunca es 0 ni 100", () => {
  assert.equal(pctMostrado(0.9999), 99);
  assert.equal(pctMostrado(0.0001), 1);
  assert.equal(pctMostrado(0.46), 46);
});

console.log("\nCota del mejor caso con media cifra");

// Seis de cada diez tests no tienen cifras, y de los que las tienen, muchos
// solo publican una. Con media cifra no hay probabilidad, pero sí hay límite.

prueba("un test sensible que sale negativo acota cuánto puede descartar", () => {
  const r = acotarParcial({ nivelPreTest: "media", sn: 0.91, sp: null, resultado: "negativo" });
  assert.equal(r.acotable, true);
  assert.equal(r.detalle.cual, "negativa");
  // La razón mínima es (1 - Sn), que es lo que se consigue con Sp = 1.
  assert.ok(Math.abs(r.detalle.razonDeVerosimilitud - 0.09) < 1e-9);
  assert.ok(r.detalle.postTest < 0.45, "tiene que bajar la sospecha");
});

prueba("un test específico que sale positivo acota cuánto puede confirmar", () => {
  const r = acotarParcial({ nivelPreTest: "media", sn: null, sp: 0.98, resultado: "positivo" });
  assert.equal(r.acotable, true);
  assert.equal(r.detalle.cual, "positiva");
  assert.ok(Math.abs(r.detalle.razonDeVerosimilitud - 50) < 1e-9);
  assert.ok(r.detalle.postTest > 0.45, "tiene que subir la sospecha");
});

prueba("la cota es siempre lo más lejos que puede llegar, nunca más", () => {
  // Con cualquier especificidad real, el resultado queda entre la sospecha
  // previa y la cota: la cota no se puede superar.
  const cota = acotarParcial({ nivelPreTest: "media", sn: 0.91, sp: null, resultado: "negativo" });
  for (const sp of [0.1, 0.4, 0.7, 0.95, 1]) {
    const real = interpretar({ nivelPreTest: "media", sn: 0.91, sp, resultado: "negativo" });
    assert.ok(
      real.detalle.postTest >= cota.detalle.postTest - 1e-9,
      `con Sp ${sp} el real ${real.detalle.postTest} baja de la cota ${cota.detalle.postTest}`,
    );
  }
});

prueba("las dos combinaciones que no se pueden acotar lo dicen", () => {
  const a = acotarParcial({ nivelPreTest: "media", sn: 0.91, sp: null, resultado: "positivo" });
  const b = acotarParcial({ nivelPreTest: "media", sn: null, sp: 0.9, resultado: "negativo" });
  assert.equal(a.acotable, false);
  assert.equal(b.acotable, false);
  assert.ok(a.motivo.length > 10 && b.motivo.length > 10);
});

prueba("con las dos cifras, o con ninguna, no es su sitio", () => {
  assert.equal(acotarParcial({ nivelPreTest: "media", sn: 0.9, sp: 0.9, resultado: "positivo" }).acotable, false);
  assert.equal(acotarParcial({ nivelPreTest: "media", sn: null, sp: null, resultado: "positivo" }).acotable, false);
});

prueba("una cifra pobre no promete lo que no puede dar", () => {
  const r = acotarParcial({ nivelPreTest: "media", sn: 0.38, sp: null, resultado: "negativo" });
  assert.equal(r.detalle.magnitud.nivel, "irrelevante");
  assert.ok(/[Nn]i en el mejor/.test(r.lectura));
});

prueba("una especificidad perfecta no da una razón infinita", () => {
  const r = acotarParcial({ nivelPreTest: "media", sn: null, sp: 1, resultado: "positivo" });
  assert.ok(Number.isFinite(r.detalle.razonDeVerosimilitud));
  assert.ok(r.detalle.postTest < 1);
});

console.log(`\n${pasadas} pruebas correctas.\n`);
