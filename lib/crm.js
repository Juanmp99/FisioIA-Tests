// Avisos al CRM de FisioIA.
//
// El CRM junta lo que hace cada clínica en todos los productos de FisioIA. De
// esta herramienta le interesan cuatro momentos: el alta, la primera entrada,
// cada batería pedida y la baja de los correos. El contrato completo está en el
// repositorio del CRM (conocimiento/contrato-productos.md).
//
// Aquí no hay base de datos donde guardar una bandeja de salida, así que el
// aviso se manda en el momento, con un tope de 3 segundos. Si el CRM no
// responde, se anota en el log y la función sigue: el fisioterapeuta nunca
// debe notarlo. El `id` de cada evento es estable, así que repetir un aviso
// no duplica nada en el CRM.
//
// Solo datos del fisioterapeuta, nunca de sus pacientes.

const ENTRADA = "https://xjlhqftkblzogzqlngjc.supabase.co/functions/v1/entrada";

/**
 * Correos que son pruebas nuestras (CRM_CORREOS_PRUEBA, separados por comas).
 * Sus eventos llegan marcados como prueba y el CRM los descarta.
 */
const correosPrueba = () =>
  new Set(
    String(process.env.CRM_CORREOS_PRUEBA || "")
      .split(",")
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean),
  );

/**
 * ¿Es un evento de pruebas? Fuera de Netlify (el servidor local) siempre; y
 * también un acceso anulado, el acceso libre de desarrollo o un correo de la
 * lista de pruebas.
 */
export function esPrueba({ correo, registro } = {}) {
  if (!process.env.NETLIFY) return true;
  if (registro?.anulado || registro?.libre) return true;
  return correosPrueba().has(String(correo || "").toLowerCase());
}

/**
 * Manda un evento. Nunca lanza.
 *
 * `prueba` añade `"prueba": true` a los datos; el CRM comprueba la clave y el
 * formato y lo ignora sin guardarlo.
 */
export async function avisarCrm({ id, tipo, correo, resumen, datos = {}, prueba = false }) {
  const clave = process.env.CLAVE_CRM;
  if (!clave || !correo) return "sin clave";

  const evento = {
    id,
    tipo,
    ocurrido_en: new Date().toISOString(),
    email: correo,
    resumen,
    datos: prueba ? { ...datos, prueba: true } : datos,
  };

  try {
    const r = await fetch(ENTRADA, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-clave-crm": clave },
      body: JSON.stringify({ eventos: [evento] }),
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) {
      console.warn(`[crm] ${tipo} rechazado: ${r.status} ${(await r.text()).slice(0, 300)}`);
      return `error ${r.status}`;
    }
    const respuesta = await r.json();
    if (respuesta.errores?.length) {
      console.warn(`[crm] ${tipo} con errores:`, JSON.stringify(respuesta.errores).slice(0, 300));
      return "error";
    }
    return respuesta.ignorados?.includes(id) ? "ignorado" : "aceptado";
  } catch (e) {
    console.warn(`[crm] ${tipo} no enviado: ${e.message}`);
    return `error ${e.message}`;
  }
}
