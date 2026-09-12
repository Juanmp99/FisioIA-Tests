// Control de acceso y consumo.
//
// La herramienta es un imán de contactos: se publica abierta y cada consulta
// gasta dinero real en la API de Anthropic. Sin puerta, la primera persona que
// comparta la URL en un grupo deja la factura abierta a desconocidos.
//
// La puerta es un token por persona, entregado por correo. No es autenticación
// —no hay contraseñas ni sesiones— sino una llave larga e irrepetible que
// permite dos cosas que una URL secreta compartida no permitiría: poner un
// tope de consumo a cada uno, y anular a quien abuse sin cerrar la puerta a
// los demás.

import crypto from "node:crypto";

import { leer, escribir } from "./almacen.js";

const ALMACEN = "acceso";

/** Consultas con coste (batería y evidencia) que puede hacer una persona al día. */
export const LIMITE_DIARIO = Number(process.env.LIMITE_DIARIO) || 40;

/** Tope de toda la aplicación por día. Cortafuegos de la factura. */
export const CUPO_GLOBAL = Number(process.env.CUPO_DIARIO_GLOBAL) || 2000;

const hoy = () => new Date().toISOString().slice(0, 10);

export const normalizarCorreo = (s) => String(s || "").trim().toLowerCase();

/**
 * Comprobación deliberadamente laxa. Validar direcciones con precisión es
 * imposible y rechazar una válida por exceso de celo cuesta un contacto; quien
 * escriba una falsa no recibirá el correo y no entrará, que es toda la
 * verificación que necesitamos.
 */
export function correoValido(correo) {
  const c = normalizarCorreo(correo);
  return c.length >= 6 && c.length <= 254 && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(c);
}

export const nuevoToken = () => crypto.randomBytes(24).toString("base64url");

/**
 * Emite (o recupera) el acceso de una dirección. Repetir el alta no crea un
 * token nuevo: quien vuelva a pedirlo recibe el mismo enlace de siempre, y los
 * enlaces ya enviados siguen valiendo.
 */
export async function emitir(correo) {
  const c = normalizarCorreo(correo);
  const existente = await leer(ALMACEN, `correo:${c}`);
  if (existente?.token) {
    const registro = await leer(ALMACEN, `token:${existente.token}`);
    if (registro && !registro.anulado) return { token: existente.token, nuevo: false, registro };
  }

  const token = nuevoToken();
  const registro = {
    correo: c,
    token,
    creado: new Date().toISOString(),
    verificado: false,
    anulado: false,
    consumo: {},
  };
  await escribir(ALMACEN, `token:${token}`, registro);
  await escribir(ALMACEN, `correo:${c}`, { token });
  return { token, nuevo: true, registro };
}

/** El enlace del correo. Al usarlo por primera vez, el acceso queda verificado. */
export async function verificar(token) {
  const registro = await leer(ALMACEN, `token:${token}`);
  if (!registro || registro.anulado) return null;
  if (!registro.verificado) {
    registro.verificado = true;
    registro.verificadoEn = new Date().toISOString();
    await escribir(ALMACEN, `token:${token}`, registro);
  }
  return registro;
}

/** Acceso válido y ya verificado. Lo exigen todas las rutas con coste. */
export async function vigente(token) {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  const registro = await leer(ALMACEN, `token:${token}`);
  if (!registro || registro.anulado || !registro.verificado) return null;
  return registro;
}

/**
 * Anota una consulta con coste y dice si queda cupo.
 *
 * Dos peticiones simultáneas del mismo token pueden pisarse el contador y
 * contar una de menos. Se acepta: el margen de error es de unas pocas
 * consultas y el tope no protege de un ataque, sino de un uso desbocado.
 */
export async function anotarConsulta(registro) {
  const dia = hoy();

  const global = (await leer(ALMACEN, `global:${dia}`)) || { consultas: 0 };
  if (global.consultas >= CUPO_GLOBAL) {
    return { permitido: false, motivo: "cupo_global" };
  }

  const usadas = registro.consumo?.[dia] || 0;
  if (usadas >= LIMITE_DIARIO) {
    return { permitido: false, motivo: "limite_personal", limite: LIMITE_DIARIO };
  }

  // Solo se conserva el día en curso: el histórico no se usa para nada.
  registro.consumo = { [dia]: usadas + 1 };
  await escribir(ALMACEN, `token:${registro.token}`, registro);
  await escribir(ALMACEN, `global:${dia}`, { consultas: global.consultas + 1 });

  return { permitido: true, restantes: LIMITE_DIARIO - usadas - 1 };
}

/**
 * Devuelve una consulta ya anotada.
 *
 * El cupo se reserva antes de trabajar, porque después sería tarde para negar
 * el servicio. Pero hay consultas que acaban sin llamar al modelo —la sospecha
 * ya estaba en el registro— y no han costado nada: cobrar por ellas gastaría el
 * cupo del fisioterapeuta en lo único que es gratis.
 */
export async function devolverConsulta(registro) {
  const dia = hoy();
  const usadas = registro.consumo?.[dia] || 0;
  if (usadas > 0) {
    registro.consumo = { [dia]: usadas - 1 };
    await escribir(ALMACEN, `token:${registro.token}`, registro);
  }

  const global = (await leer(ALMACEN, `global:${dia}`)) || { consultas: 0 };
  if (global.consultas > 0) {
    await escribir(ALMACEN, `global:${dia}`, { consultas: global.consultas - 1 });
  }
}
