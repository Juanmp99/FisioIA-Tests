// Aviso de cookies y píxel de Meta.
//
// El píxel solo se carga si la persona acepta: antes no sale ni una petición
// hacia Meta. La elección se guarda en este navegador (fisioia.cookies) y se
// puede cambiar desde «Configurar cookies», en el pie de cada página.
//
// El resto del código mide con window.fisioiaMedir(evento, datos), que no hace
// nada si no hay permiso. Así las páginas no tienen que saber nada del aviso.

(function () {
  "use strict";

  var PIXEL = "1202847511931978";
  var CLAVE = "fisioia.cookies";

  function leer() {
    try { return localStorage.getItem(CLAVE); } catch (e) { return null; }
  }
  function guardar(valor) {
    try { localStorage.setItem(CLAVE, valor); } catch (e) {}
  }

  var cargado = false;
  function cargarPixel() {
    if (cargado) return;
    cargado = true;
    /* Código base del píxel de Meta, tal como lo da Meta. */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0";
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    window.fbq("init", PIXEL);
    window.fbq("track", "PageView");
  }

  // `opciones.eventID` es el mismo identificador que manda el servidor por la
  // API de conversiones: así Meta sabe que es un solo evento y no lo cuenta
  // dos veces.
  window.fisioiaMedir = function (evento, datos, opciones) {
    if (leer() !== "si" || !window.fbq) return;
    window.fbq("track", evento, datos || {}, opciones || {});
  };

  // Lo que el servidor necesita para que Meta sepa de qué anuncio viene cada
  // alta. El fbclid llega en la dirección cuando se entra desde un anuncio; se
  // lee de ahí, sin guardarlo en ningún sitio. Las cookies _fbp y _fbc solo
  // existen si se aceptó el píxel.
  var fbclid = new URLSearchParams(location.search).get("fbclid");
  var llegada = Date.now();
  function galleta(nombre) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + nombre + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  window.fisioiaDatosMeta = function () {
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
    return {
      id: id,
      fbc: galleta("_fbc") || (fbclid ? "fb.1." + llegada + "." + fbclid : null),
      fbp: galleta("_fbp"),
      url: location.origin + location.pathname
    };
  };

  // ---- el aviso ----

  var ESTILO = [
    ".aviso-cookies{position:fixed;left:16px;right:16px;bottom:16px;z-index:90;max-width:460px;",
    "padding:18px 18px 16px;border-radius:18px;font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;",
    "color:#a3b2c9;background:#121a29;border:1px solid #2b3a52;box-shadow:0 24px 60px -20px rgba(0,0,0,.8);",
    "transform:translateY(20px);opacity:0;transition:transform .45s cubic-bezier(.16,1,.3,1),opacity .35s}",
    ".aviso-cookies.ve{transform:none;opacity:1}",
    ".aviso-cookies b{display:block;margin-bottom:4px;color:#e9eff8;font-size:15px}",
    ".aviso-cookies p{margin:0}",
    ".aviso-cookies a{color:#2fd6a6;text-underline-offset:2px}",
    ".aviso-cookies-botones{display:flex;gap:10px;margin-top:14px}",
    ".aviso-cookies button{flex:1;padding:11px 14px;border-radius:11px;font:inherit;font-weight:700;cursor:pointer;",
    "border:1px solid #2b3a52;background:#182234;color:#e9eff8}",
    ".aviso-cookies button:hover{border-color:#2fd6a6}",
    "body.con-aviso-cookies .barra-fija{display:none}"
  ].join("");

  function mostrarAviso() {
    if (document.querySelector(".aviso-cookies")) return;
    if (!document.getElementById("estilo-aviso-cookies")) {
      var st = document.createElement("style");
      st.id = "estilo-aviso-cookies";
      st.textContent = ESTILO;
      document.head.appendChild(st);
    }
    var caja = document.createElement("div");
    caja.className = "aviso-cookies";
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-label", "Aviso de cookies");
    // Aceptar y rechazar, con el mismo peso: rechazar tiene que ser igual de
    // fácil que aceptar.
    caja.innerHTML =
      "<b>¿Nos dejas medir nuestros anuncios?</b>" +
      "<p>Con tu permiso usamos cookies de Meta para saber qué anuncios funcionan. " +
      'Sin él, no se activa nada. <a href="/cookies">Más información</a></p>' +
      '<div class="aviso-cookies-botones">' +
      '<button type="button" data-cookies="no">Rechazar</button>' +
      '<button type="button" data-cookies="si">Aceptar</button>' +
      "</div>";
    caja.addEventListener("click", function (e) {
      var eleccion = e.target.getAttribute && e.target.getAttribute("data-cookies");
      if (!eleccion) return;
      var antes = leer();
      guardar(eleccion);
      caja.classList.remove("ve");
      document.body.classList.remove("con-aviso-cookies");
      setTimeout(function () { caja.remove(); }, 400);
      if (eleccion === "si") cargarPixel();
      // Retirar el permiso: el píxel ya cargado sigue en memoria hasta que se
      // recarga la página, así que se recarga para que deje de medir.
      else if (antes === "si") location.reload();
    });
    document.body.appendChild(caja);
    document.body.classList.add("con-aviso-cookies");
    requestAnimationFrame(function () { requestAnimationFrame(function () { caja.classList.add("ve"); }); });
  }

  // «Configurar cookies», desde el pie.
  window.fisioiaCookies = mostrarAviso;

  function empezar() {
    var eleccion = leer();
    if (eleccion === "si") cargarPixel();
    else if (eleccion !== "no") mostrarAviso();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", empezar);
  else empezar();
})();
