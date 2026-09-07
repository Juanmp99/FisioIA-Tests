// Semáforo de calidad de la evidencia.
//
// Los instrumentos son los que corresponden a estudios de precisión diagnóstica:
// QUADAS-2 para el riesgo de sesgo de los estudios primarios, AMSTAR-2 para
// juzgar revisiones sistemáticas y metaanálisis, y GRADE como marco para la
// certeza del conjunto. La escala PEDro queda fuera a propósito: valora ensayos
// aleatorizados de intervención y no aplica aquí.
//
// La decisión es determinista: el modelo rellena la ficha de valoración, pero el
// color lo calcula esta función siempre igual.

export const COLORES = {
  verde: {
    id: "verde",
    etiqueta: "Evidencia sólida",
    permiteConclusion: true,
  },
  ambar: {
    id: "ambar",
    etiqueta: "Evidencia limitada",
    permiteConclusion: true,
  },
  rojo: {
    id: "rojo",
    etiqueta: "Sin evidencia suficiente",
    permiteConclusion: false,
  },
};

/**
 * @param {object} ficha
 * @param {"revision_sistematica"|"estudio_primario"|"ninguno"} ficha.tipoEstudio
 * @param {"alta"|"moderada"|"baja"|"criticamente_baja"|null} ficha.amstar2
 * @param {"bajo"|"dudoso"|"alto"|null} ficha.quadas2
 * @param {"consistente"|"discrepante"|"desconocida"} ficha.consistencia
 * @param {"estrecho"|"amplio"|"desconocido"} ficha.intervalos
 * @param {number} ficha.numeroEstudios
 */
export function semaforo(ficha) {
  const motivos = [];

  // Evidencia indirecta: cifras del test correcto medidas sobre una entidad
  // relacionada pero distinta. Sirve, pero nunca puede considerarse sólida para
  // la sospecha que se está verificando.
  const indirecta = ficha.indirecta === true;

  // Solo una de las dos cifras. Sirve para orientar, nunca para concluir.
  // Se anota antes que nada para que el motivo no se pierda si más abajo
  // alguna descalificación devuelve rojo por otra razón.
  const parcial = ficha.parcial === true;
  if (parcial) {
    motivos.push(
      ficha.falta === "especificidad"
        ? "La literatura publica la sensibilidad pero no la especificidad, así que no puede calcularse la probabilidad tras el test."
        : "La literatura publica la especificidad pero no la sensibilidad, así que no puede calcularse la probabilidad tras el test.",
    );
  }

  if (ficha.tipoEstudio === "ninguno") {
    return {
      ...COLORES.rojo,
      motivos: ["No se han localizado estudios de precisión diagnóstica para este test."],
    };
  }

  // Descalificaciones directas: por buenos que sean los demás indicadores, un
  // riesgo de sesgo alto o una revisión críticamente baja no sostienen una
  // conclusión probabilística.
  if (ficha.quadas2 === "alto") {
    motivos.push("Riesgo de sesgo alto en la valoración QUADAS-2 de los estudios disponibles.");
    return { ...COLORES.rojo, motivos };
  }
  if (ficha.tipoEstudio === "revision_sistematica" && ficha.amstar2 === "criticamente_baja") {
    motivos.push("La revisión sistemática localizada tiene una calidad críticamente baja según AMSTAR-2.");
    return { ...COLORES.rojo, motivos };
  }

  const esRevisionBuena =
    ficha.tipoEstudio === "revision_sistematica" &&
    (ficha.amstar2 === "alta" || ficha.amstar2 === "moderada");

  if (
    !indirecta &&
    !parcial &&
    esRevisionBuena &&
    ficha.quadas2 === "bajo" &&
    ficha.consistencia === "consistente" &&
    ficha.intervalos === "estrecho"
  ) {
    return {
      ...COLORES.verde,
      motivos: [
        "Revisión sistemática de calidad suficiente según AMSTAR-2.",
        "Estudios primarios con bajo riesgo de sesgo en QUADAS-2.",
        "Resultados consistentes entre estudios y con intervalos de confianza estrechos.",
      ],
    };
  }

  // Todo lo demás es ámbar, con el motivo concreto de por qué no llega a verde.
  if (indirecta) {
    motivos.push(
      `Las cifras no se midieron sobre esta sospecha, sino sobre ${ficha.entidadDeLasCifras || "una entidad relacionada"}.`,
    );
  }
  if (!esRevisionBuena && ficha.tipoEstudio === "estudio_primario") {
    motivos.push(
      ficha.numeroEstudios > 1
        ? "Solo se dispone de estudios primarios, sin revisión sistemática que los sintetice."
        : "Se dispone de un único estudio primario.",
    );
  }
  if (ficha.consistencia === "discrepante") motivos.push("Los estudios discrepan entre sí.");
  if (ficha.consistencia === "desconocida") motivos.push("No se ha podido valorar la consistencia entre estudios.");
  if (ficha.intervalos === "amplio") motivos.push("Los intervalos de confianza son amplios: la estimación es imprecisa.");
  if (ficha.intervalos === "desconocido") motivos.push("Los intervalos de confianza no constan.");
  if (ficha.quadas2 === "dudoso") motivos.push("Hay dudas en algún dominio de la valoración QUADAS-2.");
  if (!ficha.quadas2 || ficha.quadas2 === "no_valorable") {
    motivos.push("El resumen no aporta datos suficientes para valorar el riesgo de sesgo con QUADAS-2.");
  }
  if (ficha.amstar2 === "baja") motivos.push("La revisión localizada tiene calidad baja según AMSTAR-2.");

  if (!motivos.length) motivos.push("La evidencia disponible no reúne todos los criterios para considerarse sólida.");

  return { ...COLORES.ambar, motivos };
}
