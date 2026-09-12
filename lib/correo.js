// Envío del correo con el enlace de acceso.
//
// Lo manda Brevo por su endpoint transaccional, igual que en los demás imanes
// de contactos de FisioIA: el código le dice a Brevo «manda este correo exacto
// ahora», sin depender de ninguna automatización montada en su panel. Así el
// correo vive en el repositorio y se revisa como cualquier otro código.
//
// Resend queda soportado por si algún día se cambia de proveedor: se elige con
// PROVEEDOR_CORREO y, sin ella, gana el que tenga clave configurada.

const REMITENTE_NOMBRE = process.env.CORREO_NOMBRE || "FisioIA";

function remitente() {
  const direccion = process.env.CORREO_REMITENTE;
  if (!direccion) throw new Error("Falta CORREO_REMITENTE (dirección verificada en el proveedor).");
  return direccion;
}

export function proveedorCorreo() {
  const elegido = (process.env.PROVEEDOR_CORREO || "").toLowerCase();
  if (elegido === "resend" || elegido === "brevo") return elegido;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.BREVO_API_KEY) return "brevo";
  return null;
}

async function porResend({ para, asunto, html, texto }) {
  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${REMITENTE_NOMBRE} <${remitente()}>`,
      to: [para],
      subject: asunto,
      html,
      text: texto,
    }),
  });
  if (!respuesta.ok) {
    throw new Error(`Resend respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
  }
}

async function porBrevo({ para, asunto, html, texto }) {
  const respuesta = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: REMITENTE_NOMBRE, email: remitente() },
      to: [{ email: para }],
      subject: asunto,
      htmlContent: html,
      textContent: texto,
    }),
  });
  if (!respuesta.ok) {
    throw new Error(`Brevo respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
  }
}

export async function enviarAcceso({ correo, enlace }) {
  const proveedor = proveedorCorreo();
  if (!proveedor) throw new Error("No hay proveedor de correo configurado.");

  const asunto = "🎉 Tu acceso al Asistente de Tests está aquí";

  const texto = [
    "¡Ya tienes tu acceso! El Asistente de Tests está listo para que lo uses.",
    "",
    "Entra desde aquí:",
    enlace,
    "",
    "El enlace es personal y no caduca. Al abrirlo, este dispositivo queda",
    "desbloqueado: las próximas veces entrarás directamente.",
    "",
    "Herramienta de apoyo al razonamiento clínico. No emite diagnósticos.",
    "FisioIA",
  ].join("\n");

  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f5f7fb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f2740;">
        <tr><td style="padding-bottom:8px;font-size:22px;font-weight:700;letter-spacing:-.02em;">Fisio<span style="color:#00a97f;">IA</span></td></tr>
        <tr><td style="padding-bottom:24px;font-size:15px;color:#5b6478;">Asistente de tests</td></tr>
        <tr><td style="font-size:20px;font-weight:700;line-height:1.3;padding-bottom:14px;">¡Ya tienes tu acceso! 🎉</td></tr>
        <tr><td style="font-size:15px;line-height:1.6;color:#333b4a;padding-bottom:26px;">
          Escribe tu sospecha diagnóstica y el asistente te devuelve con qué tests verificarla,
          cómo se ejecuta cada uno y qué te permite concluir cada resultado según la precisión
          diagnóstica publicada.
        </td></tr>
        <tr><td align="center" style="padding-bottom:26px;">
          <a href="${enlace}" style="display:inline-block;background:#00a97f;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 30px;border-radius:10px;">Acceder al asistente &rarr;</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.6;color:#5b6478;padding-bottom:20px;">
          El enlace es personal y no caduca. Al abrirlo, este dispositivo queda desbloqueado y
          las próximas veces entrarás directamente. Si el botón no funciona, copia esta dirección:<br>
          <span style="word-break:break-all;color:#004aad;">${enlace}</span>
        </td></tr>
        <tr><td style="border-top:1px solid #e6eaf2;padding-top:18px;font-size:12px;line-height:1.6;color:#8c96aa;">
          Herramienta de apoyo al razonamiento clínico. No emite diagnósticos ni sustituye el
          juicio del profesional.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  if (proveedor === "resend") return porResend({ para: correo, asunto, html, texto });
  return porBrevo({ para: correo, asunto, html, texto });
}
