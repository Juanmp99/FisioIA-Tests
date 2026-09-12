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

/**
 * Da de alta (o actualiza) el contacto en la lista configurada.
 *
 * `updateEnabled` evita el error de "contacto duplicado" cuando alguien vuelve
 * a registrarse, que es un caso corriente y no un problema.
 *
 * Los atributos van en un segundo plano deliberado: Brevo rechaza la petición
 * entera si alguno no existe en la cuenta, y perder un contacto porque falta
 * una columna en el CRM sería absurdo. Si los rechaza, se reintenta sin ellos.
 */
export async function guardarContacto({ correo, token, origen = "Asistente de Tests" }) {
  const clave = process.env.BREVO_API_KEY;
  const lista = Number(process.env.BREVO_LISTA_ID);
  if (!clave) throw new Error("Falta BREVO_API_KEY.");
  if (!lista) throw new Error("Falta BREVO_LISTA_ID.");

  const contacto = { email: correo, listIds: [lista], updateEnabled: true };

  // El token también viaja como atributo para que, si algún día el correo se
  // manda desde una automatización de Brevo, la plantilla pueda componer el
  // enlace sin depender de esta aplicación.
  const conAtributos = { ...contacto, attributes: { TOKEN_ACCESO: token, ORIGEN: origen } };

  const respuesta = await enviar(conAtributos);
  if (respuesta.ok) return { creado: respuesta.status === 201, atributos: true };

  const detalle = await respuesta.text();

  if (respuesta.status === 400) {
    const segunda = await enviar(contacto);
    if (segunda.ok) {
      console.warn(
        `[brevo] Contacto guardado sin atributos. Crea TOKEN_ACCESO y ORIGEN en Brevo para conservarlos. Motivo: ${detalle.slice(0, 200)}`,
      );
      return { creado: segunda.status === 201, atributos: false };
    }
    throw new Error(`Brevo respondió ${segunda.status}: ${(await segunda.text()).slice(0, 300)}`);
  }

  throw new Error(`Brevo respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
}
