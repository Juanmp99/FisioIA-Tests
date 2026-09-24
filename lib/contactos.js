// Alta del contacto en Brevo.
//
// El contacto es lo valioso de esta herramienta, así que el alta está escrita
// para no fallar por cosas accesorias: se guarda aunque el correo de acceso
// falle después, y se guarda aunque los atributos no puedan escribirse.

const API = "https://api.brevo.com/v3/contacts";

export const hayBrevo = () => Boolean(process.env.BREVO_API_KEY);

function enviar(cuerpo) {
  return fetch(API, {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(cuerpo),
  });
}

const cabeceras = () => ({
  "api-key": process.env.BREVO_API_KEY,
  "Content-Type": "application/json",
  Accept: "application/json",
});

/** La lista de la newsletter diaria, a la que acaban todos tras la secuencia. */
const listaNewsletter = () => Number(process.env.BREVO_LISTA_NEWSLETTER_ID) || 10;

/**
 * El contacto tal como está en Brevo antes de este alta, o null si es nuevo.
 * Si Brevo no responde se trata como nuevo: es lo que menos cambia.
 */
export async function contactoPrevio(correo) {
  try {
    const r = await fetch(`${API}/${encodeURIComponent(correo)}`, { headers: cabeceras() });
    if (!r.ok) return null;
    const d = await r.json();
    return { baja: Boolean(d.emailBlacklisted), listas: d.listIds || [] };
  } catch {
    return null;
  }
}

/**
 * ¿Hay que volver a meterlo en la newsletter?
 *
 * Quien ya estuvo en Brevo y hoy vuelve a dejar su correo en un formulario que
 * dice «aceptas unirte a nuestra lista» da un consentimiento nuevo, posterior a
 * su baja. Dos casos:
 *
 * - Se dio de baja de la newsletter: sigue en la lista, marcado como baja. Se le
 *   quita la marca.
 * - Se dio de baja a mitad de la secuencia de bienvenida, antes de llegar a la
 *   newsletter: no está en ella, y como la automatización no deja reentrar,
 *   nunca llegaría. Se le mete directamente.
 *
 * A un contacto nuevo no se le toca: sigue su camino por la secuencia.
 * Solo actúa con REACTIVAR_BAJAS=1, que se enciende cuando la política de
 * privacidad esté enlazada en los formularios.
 */
export function debeReactivar(previo, { activo, newsletter }) {
  if (!activo || !previo) return false;
  return previo.baja || !previo.listas.includes(newsletter);
}

/**
 * Da de alta (o actualiza) el contacto en la lista configurada.
 *
 * `updateEnabled` evita el error de "contacto duplicado" cuando alguien vuelve
 * a registrarse, que es un caso corriente y no un problema.
 *
 * Los atributos van en un segundo plano deliberado: Brevo rechaza la petición
 * entera si alguno no existe en la cuenta, y perder un contacto porque falta
 * una columna en el CRM sería absurdo. Si los rechaza, se reintenta sin ellos.
 *
 * FECHA_CONSENTIMIENTO y ORIGEN son la prueba del consentimiento: cuándo y
 * dónde aceptó por última vez recibir correos.
 */
export async function guardarContacto({ correo, token, origen = "Copiloto de Exploración" }) {
  const clave = process.env.BREVO_API_KEY;
  const lista = Number(process.env.BREVO_LISTA_ID);
  if (!clave) throw new Error("Falta BREVO_API_KEY.");
  if (!lista) throw new Error("Falta BREVO_LISTA_ID.");

  const newsletter = listaNewsletter();
  const previo = await contactoPrevio(correo);
  const reactivar = debeReactivar(previo, { activo: process.env.REACTIVAR_BAJAS === "1", newsletter });

  const contacto = {
    email: correo,
    listIds: reactivar ? [lista, newsletter] : [lista],
    updateEnabled: true,
    ...(reactivar ? { emailBlacklisted: false } : {}),
  };

  // El token también viaja como atributo para que, si algún día el correo se
  // manda desde una automatización de Brevo, la plantilla pueda componer el
  // enlace sin depender de esta aplicación.
  const conAtributos = {
    ...contacto,
    attributes: {
      TOKEN_ACCESO: token,
      ORIGEN: origen,
      FECHA_CONSENTIMIENTO: new Date().toISOString().slice(0, 10),
    },
  };

  const respuesta = await enviar(conAtributos);
  if (respuesta.ok) return { creado: respuesta.status === 201, atributos: true, reactivado: reactivar };

  const detalle = await respuesta.text();

  if (respuesta.status === 400) {
    const segunda = await enviar(contacto);
    if (segunda.ok) {
      console.warn(
        `[brevo] Contacto guardado sin atributos. Crea TOKEN_ACCESO, ORIGEN y FECHA_CONSENTIMIENTO en Brevo para conservarlos. Motivo: ${detalle.slice(0, 200)}`,
      );
      return { creado: segunda.status === 201, atributos: false, reactivado: reactivar };
    }
    throw new Error(`Brevo respondió ${segunda.status}: ${(await segunda.text()).slice(0, 300)}`);
  }

  throw new Error(`Brevo respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
}

/**
 * Saca el correo de la lista de bloqueo de los envíos transaccionales.
 *
 * Brevo mete ahí a quien pulsa «Darse de baja» en cualquier correo, y a quien
 * rebotó alguna vez; desde entonces descarta en silencio todo lo que se le
 * mande, incluido el acceso que acaba de pedir. Pedirlo es querer recibirlo, así
 * que se desbloquea antes de enviar. Si la dirección no existe, rebotará una
 * vez y Brevo la volverá a bloquear sola. La baja de la newsletter va aparte y
 * no se toca aquí.
 */
export async function desbloquearTransaccional(correo) {
  try {
    const r = await fetch(`https://api.brevo.com/v3/smtp/blockedContacts/${encodeURIComponent(correo)}`, {
      method: "DELETE",
      headers: cabeceras(),
    });
    return r.ok ? "desbloqueado" : r.status === 404 ? "no estaba" : `error ${r.status}`;
  } catch (e) {
    return `error ${e.message}`;
  }
}

/**
 * ¿Descartó Brevo el envío? Aceptar la petición no es entregarla: con el
 * correo bloqueado, Brevo responde que sí y luego lo tira. El descarte aparece
 * en sus eventos en el acto, así que se mira un par de veces y se sigue.
 */
export async function envioBloqueado(messageId) {
  if (!messageId) return false;
  for (let intento = 0; intento < 2; intento++) {
    await new Promise((r) => setTimeout(r, 900));
    try {
      const url = `https://api.brevo.com/v3/smtp/statistics/events?messageId=${encodeURIComponent(messageId)}&event=blocked&limit=1`;
      const r = await fetch(url, { headers: cabeceras() });
      if (r.ok && ((await r.json()).events || []).length) return true;
    } catch {
      return false;
    }
  }
  return false;
}
