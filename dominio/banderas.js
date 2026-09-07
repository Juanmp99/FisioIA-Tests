// Banderas rojas. Capa de reglas duras, no criterio del modelo.
//
// El motivo de que esto no lo decida un modelo de lenguaje es que la advertencia
// tiene que dispararse SIEMPRE y de forma idéntica. Un aviso que aparece unas
// veces sí y otras no es peor que no tenerlo, porque genera confianza injustificada.
//
// El listado es genérico y deliberadamente corto: recoge las banderas más
// comunes por región. La herramienta no pretende detectar banderas rojas ni
// sustituir el cribado, solo recordar las habituales.

/**
 * Advertencia que acompaña siempre al listado. No es una nota legal de relleno:
 * delimita qué hace la herramienta y qué sigue siendo del fisioterapeuta.
 */
export const ADVERTENCIA =
  "Este listado es un recordatorio de las banderas rojas más habituales en esta región. No es exhaustivo y la herramienta no las detecta: es siempre el fisioterapeuta quien debe cribar y descartar activamente estos signos y patologías antes de continuar con la exploración y el tratamiento.";

export const PRIORIDADES = {
  urgente: { orden: 0, etiqueta: "Derivación urgente" },
  prioritaria: { orden: 1, etiqueta: "Derivación preferente" },
  precaucion: { orden: 2, etiqueta: "Precaución" },
};

export const BANDERAS = [
  {
    id: "cola-de-caballo",
    regiones: ["lumbar", "pelvis"],
    prioridad: "urgente",
    titulo: "Síndrome de cola de caballo",
    senales: [
      "Anestesia en silla de montar",
      "Retención urinaria o incontinencia de reciente aparición",
      "Incontinencia fecal o pérdida del tono del esfínter",
      "Déficit motor bilateral progresivo en miembros inferiores",
    ],
    accion: "Derivación inmediata a urgencias. No continuar con la exploración ni con el tratamiento.",
  },
  {
    id: "mielopatia-cervical",
    regiones: ["cervical"],
    prioridad: "urgente",
    titulo: "Mielopatía cervical",
    senales: [
      "Alteración de la marcha o del equilibrio",
      "Torpeza en las manos, dificultad para tareas finas",
      "Hiperreflexia, clonus o signo de Hoffmann",
      "Síntomas en las cuatro extremidades",
    ],
    accion: "Derivación médica urgente. Contraindicada la manipulación cervical.",
  },
  {
    id: "insuficiencia-vertebrobasilar",
    regiones: ["cervical"],
    prioridad: "urgente",
    titulo: "Compromiso arterial cervical",
    senales: [
      "Mareo o vértigo desencadenado por movimientos cervicales",
      "Diplopía, disartria, disfagia",
      "Ataxia, caídas súbitas sin pérdida de consciencia",
      "Cefalea o cervicalgia de inicio súbito y distinta a la habitual",
    ],
    accion: "No manipular ni movilizar en rotación-extensión. Derivación médica urgente.",
  },
  {
    id: "neoplasia",
    regiones: ["cervical", "dorsal", "lumbar", "pelvis", "hombro", "cadera", "general"],
    prioridad: "prioritaria",
    titulo: "Sospecha de origen neoplásico",
    senales: [
      "Antecedente de cáncer",
      "Pérdida de peso no explicada",
      "Dolor nocturno que no cede con el cambio postural ni con el reposo",
      "Edad superior a 50 años con dolor de nueva aparición sin mecanismo claro",
      "Dolor constante, no mecánico, que no varía con la actividad",
    ],
    accion: "Derivación médica preferente antes de iniciar tratamiento.",
  },
  {
    id: "infeccion",
    regiones: ["cervical", "dorsal", "lumbar", "pelvis", "rodilla", "cadera", "general"],
    prioridad: "urgente",
    titulo: "Sospecha de infección",
    senales: [
      "Fiebre, escalofríos o malestar general",
      "Inmunosupresión, diabetes mal controlada o corticoterapia prolongada",
      "Consumo de drogas por vía parenteral",
      "Cirugía o procedimiento invasivo reciente en la zona",
      "Signos inflamatorios locales intensos con impotencia funcional",
    ],
    accion: "Derivación médica urgente. No aplicar terapia manual ni agentes térmicos sobre la zona.",
  },
  {
    id: "fractura",
    regiones: ["general"],
    prioridad: "prioritaria",
    titulo: "Sospecha de fractura",
    senales: [
      "Traumatismo de alta energía",
      "Traumatismo de baja energía en persona mayor u osteoporótica",
      "Dolor localizado intenso a la palpación ósea con impotencia funcional",
      "Corticoterapia prolongada",
      "Deformidad visible o crepitación",
    ],
    accion: "Valorar reglas de decisión clínica aplicables a la región y derivar para prueba de imagen antes de explorar.",
  },
  {
    id: "trombosis-venosa",
    regiones: ["rodilla", "tobillo-pie", "cadera"],
    prioridad: "urgente",
    titulo: "Trombosis venosa profunda",
    senales: [
      "Dolor en pantorrilla con edema unilateral",
      "Aumento de temperatura y enrojecimiento local",
      "Inmovilización reciente, cirugía o viaje prolongado",
      "Antecedentes de trombosis o tratamiento hormonal",
    ],
    accion: "Derivación urgente. No masajear ni movilizar la extremidad.",
  },
  {
    id: "artritis-inflamatoria",
    regiones: ["general"],
    prioridad: "prioritaria",
    titulo: "Artropatía inflamatoria sistémica",
    senales: [
      "Rigidez matutina de más de una hora",
      "Afectación poliarticular y simétrica",
      "Dolor que mejora con la actividad y empeora con el reposo",
      "Manifestaciones extraarticulares: cutáneas, oculares o digestivas",
    ],
    accion: "Derivación a reumatología para valoración diagnóstica.",
  },
  {
    id: "sindrome-compartimental",
    regiones: ["tobillo-pie", "rodilla", "codo", "muneca-mano"],
    prioridad: "urgente",
    titulo: "Síndrome compartimental",
    senales: [
      "Dolor desproporcionado al hallazgo y que aumenta con el estiramiento pasivo",
      "Tensión a la palpación del compartimento",
      "Parestesias distales de aparición reciente",
      "Antecedente de traumatismo, yeso o esfuerzo intenso",
    ],
    accion: "Derivación inmediata a urgencias.",
  },
  {
    id: "anticoagulacion",
    regiones: ["general"],
    prioridad: "precaucion",
    titulo: "Tratamiento anticoagulante",
    senales: ["Toma de anticoagulantes o trastorno de la coagulación conocido"],
    accion: "Contraindicada la punción seca. Precaución con la terapia manual intensa.",
  },
];

/**
 * Devuelve las banderas aplicables a una región, ordenadas por prioridad.
 * Se muestran siempre: no dependen de que el fisioterapeuta haya escrito nada
 * que las sugiera, porque el sentido del aviso es recordar lo que no se ha
 * pensado en preguntar.
 */
export function banderasPara(region) {
  const clave = String(region || "").toLowerCase();

  return BANDERAS.filter((b) => b.regiones.includes(clave) || b.regiones.includes("general")).sort(
    (a, b) => PRIORIDADES[a.prioridad].orden - PRIORIDADES[b.prioridad].orden,
  );
}

/** Regiones reconocidas. El modelo debe normalizar la sospecha a una de estas. */
export const REGIONES = [
  "cervical",
  "dorsal",
  "lumbar",
  "pelvis",
  "hombro",
  "codo",
  "muneca-mano",
  "cadera",
  "rodilla",
  "tobillo-pie",
];
