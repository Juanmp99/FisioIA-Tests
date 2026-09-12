// Alta del contacto en Brevo.
//
// El contacto se guarda aunque el correo de acceso falle después: el objetivo
// de la herramienta es captar, y perder un contacto porque el proveedor de
// correo tuvo un mal minuto sería el peor de los fallos posibles.

const API = "https://api.brevo.com/v3/contacts";

export const hayBrevo = () => Boolean(process.env.BREVO_API_KEY);

/**
 * Da de alta (o actualiza) el contacto en la lista configurada.
 *
 * `updateEnabled` evita el error 400 de "contacto duplicado" cuando alguien
 * vuelve a registrarse, que es un caso corriente y no un problema.
 */
export async function guardarContacto({ correo, token, origen = "Asistente de Tests" }) {
  const clave = process.env.BREVO_API_KEY;
  const lista = Number(process.env.BREVO_LISTA_ID);
  if (!clave) throw new Error("Falta BREVO_API_KEY.");
  if (!lista) throw new Error("Falta BREVO_LISTA_ID.");

  const respuesta = await fetch(API, {
    method: "POST",
    headers: {
      "api-key": clave,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: correo,
      listIds: [lista],
      updateEnabled: true,
      attributes: {
        // El token también viaja como atributo para que, si algún día el correo
        // se manda desde una automatización de Brevo, la plantilla pueda
        // componer el enlace sin depender de esta aplicación.
        TOKEN_ACCESO: token,
        ORIGEN: origen,
      },
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Brevo respondió ${respuesta.status}: ${detalle.slice(0, 300)}`);
  }

  // Un alta nueva devuelve 201 con cuerpo; una actualización, 204 sin cuerpo.
  return { creado: respuesta.status === 201 };
}
