# FisioIA · Exploración guiada

El fisioterapeuta escribe una sospecha diagnóstica en lenguaje clínico y la herramienta devuelve
la batería de tests con la que verificarla, cómo ejecutar cada uno, y qué permite concluir cada
resultado según la precisión diagnóstica publicada.

La herramienta se publica como imán de contactos: una landing explica qué es y pide el correo,
y el acceso llega por email. Quien no tiene acceso no puede consultar, porque cada consulta
gasta dinero real en la API de Anthropic.

## Ponerlo en marcha

Doble clic en **`Abrir Tests.bat`**. Arranca el servidor y abre el navegador en
`http://localhost:3200`. La ventana negra debe quedarse abierta mientras se use.

Desde terminal, para desarrollar:

```bash
npm run dev
```

`dev` levanta el servidor con `ACCESO_LIBRE=1`, que salta la puerta del correo para no tener
que montar el alta entera en local. La variable se ignora en Netlify a propósito: dejarla
puesta por descuido en el panel no abre la puerta en producción.

Requiere Node 22 o superior y un archivo `.env` con `ANTHROPIC_API_KEY`. Opcionalmente
`ANTHROPIC_MODEL`; por defecto usa `claude-sonnet-5`.

## Comprobar que funciona

Tres comandos, ninguno necesita clave ni red salvo el último.

```bash
npm test
```

Pruebas del núcleo determinista: matemáticas, semáforo, banderas y registro de entidades.

```bash
npm run verificar
```

Verificación independiente del cálculo. Contrasta la probabilidad post-test que da la
herramienta contra un recuento directo sobre una cohorte simulada de un millón de pacientes, que
no comparte fórmula ni código. Barre más de once mil combinaciones de sospecha previa,
sensibilidad y especificidad, comprueba las cifras reales que hemos extraído de la literatura, y
verifica invariantes que deben cumplirse siempre: que un positivo nunca baje la sospecha, que un
test sin poder discriminante no cambie nada, o que la herramienta nunca diga "confirma" cuando el
test no ha aportado.

```bash
npm run auditar
```

Auditoría de la base de evidencia. Pone cada cifra publicada al lado de la frase del artículo de
la que dice venir y del enlace a PubMed, y marca las que no superan la comprobación automática.
Con `--dudosas` muestra solo esas.

**Lo que ninguna máquina puede comprobar** es si la frase citada se refiere de verdad a ese test
y a esa patología. Eso hay que mirarlo a mano, y para eso existe el informe.

## Cómo se usa

1. Escribe la sospecha. Si es un síndrome y no una entidad concreta —"hombro doloroso"—, la
   herramienta no adivina: te ofrece las entidades compatibles para que elijas.
2. Marca con cuánta sospecha llegas: baja, media o alta. Puede hacerse antes o después de
   explorar; al marcarla se interpretan de golpe todos los tests que ya hubieras señalado.
3. Ve marcando **Positivo** o **Negativo** en cada test según exploras. Debajo aparece qué
   significa ese resultado y cómo queda la sospecha.

Cada test se interpreta contra la sospecha inicial, de forma independiente. **Los resultados de
varios tests sueltos no se encadenan**: tests que exploran la misma estructura no aportan
información independiente, y multiplicar sus razones de verosimilitud daría una certeza que la
evidencia no respalda. Solo una agrupación validada como conjunto puede interpretarse en bloque.

## Estructura

| Archivo | Responsabilidad |
| --- | --- |
| `dominio/probabilidad.js` | Razones de verosimilitud, probabilidad post-test y validación de cifras. Sin IA. |
| `dominio/calidad.js` | Valoración de la evidencia con QUADAS-2, AMSTAR-2 y GRADE. |
| `dominio/banderas.js` | Banderas rojas por región. Reglas duras, nunca criterio del modelo. |
| `ia/prompts.js` | Los dos prompts: proponer la batería y extraer cifras de un artículo. |
| `ia/pubmed.js` | Búsqueda en PubMed con sinónimos y ensanchado progresivo. |
| `ia/evidencia.js` | Caché de evidencia, extracción y validación. |
| `ia/pmc.js` | Texto completo desde PubMed Central, cuando el resumen se queda corto. |
| `ia/entidades.js` | Registro de entidades: garantiza que la misma sospecha dé siempre la misma respuesta. |
| `lib/almacen.js` | Persistencia: archivos en local, Netlify Blobs en producción. |
| `lib/asistente.js` | Los dos tiempos —batería y evidencia— sin nada de transporte. |
| `lib/acceso.js` | Tokens de acceso, verificación por correo y topes de consumo. |
| `lib/contactos.js` | Alta del contacto en Brevo. |
| `lib/correo.js` | Envío del enlace de acceso por Brevo transaccional. |
| `netlify/functions/` | Un archivo por endpoint. Cada uno declara su ruta. |
| `server.js` | Servidor de desarrollo: monta esas mismas funciones. |
| `publico/index.html` | La landing y el formulario de acceso. |
| `publico/app.html` | La aplicación. |

## Desplegar

El sitio es estático más funciones sin servidor. No hay proceso permanente, y de ahí las dos
decisiones que gobiernan el resto del código.

**No se puede escribir en disco.** Cada invocación arranca con el sistema de archivos limpio, así
que la caché de evidencia y el registro de entidades viven en Netlify Blobs. Perder el registro
no sería perder velocidad: sería perder la garantía de que la misma sospecha devuelve siempre la
misma batería.

**Nada puede tardar más de 60 segundos.** Antes se pedían todos los tests de la batería en una
sola llamada y se resolvían en serie, y la primera consulta de una entidad nueva tardaba minutos.
Ahora el navegador pide un test por petición, tres a la vez, y pinta cada uno en cuanto llega.

Variables de entorno que hay que configurar en el panel de Netlify:

| Variable | Para qué |
| --- | --- |
| `ANTHROPIC_API_KEY` | Obligatoria. La batería y la extracción de cifras. |
| `BREVO_API_KEY` | Obligatoria. Alta del contacto. |
| `BREVO_LISTA_ID` | Obligatoria. Identificador numérico de la lista (`14`). |
| `CORREO_REMITENTE` | Obligatoria. Remitente verificado: `hola@fisioia.app`. |
| `PROVEEDOR_CORREO` | `brevo` o `resend`. Sin ella gana el que tenga clave. |
| `RESEND_API_KEY` | Solo si algún día se cambia de proveedor de correo. |
| `URL_PUBLICA` | `https://asistente-tests.fisioia.app`, para componer el enlace del correo. |
| `ANTHROPIC_MODEL` | Por defecto `claude-sonnet-5`. |
| `LIMITE_DIARIO` | Consultas con coste por persona y día. Por defecto 40. |
| `CUPO_DIARIO_GLOBAL` | Tope de toda la aplicación por día. Por defecto 2000. |

## La puerta

El acceso es un token por persona que se entrega por correo. No es autenticación —no hay
contraseñas ni sesiones— sino una llave larga e irrepetible.

Podría haber sido una URL secreta compartida por todos, pero una URL secreta deja de serlo en
cuanto alguien la pega en un grupo, y entonces la factura queda abierta a desconocidos. Con un
token por persona se puede poner un tope de consumo a cada uno y anular a quien abuse sin cerrar
la puerta a los demás.

El token no vale hasta que se abre el enlace del correo. Es lo que hace que las direcciones
recogidas sean direcciones reales.

## Principios que no se negocian

**Las cifras nunca salen de la memoria del modelo.** Solo de un artículo recuperado y citado. El
modelo extrae y razona; no recuerda números.

**Toda extracción se comprueba.** Sensibilidad, especificidad y razones de verosimilitud están
ligadas por una identidad matemática: `LR+ = Sn/(1−Sp)` y `LR− = (1−Sn)/Sp`. Si los cuatro valores
no la cumplen, el dato se rechaza en lugar de publicarse. Es la única defensa automática que hay,
porque no existe revisión humana.

**Un test que no aporta no confirma nada.** Antes de decir si un resultado confirma o descarta se
comprueba que el test haya movido realmente la sospecha. Si no, se dice. Con una sospecha previa
alta, un test inútil puede dejar la probabilidad por encima del umbral, y atribuirle ese mérito
sería el peor error posible en esta herramienta.

**Cuando el resumen no basta, se lee el artículo entero.** Un resumen de PubMed casi nunca publica los
intervalos de confianza ni da detalle para juzgar el riesgo de sesgo, y el semáforo exige ambas cosas para
dar verde. El resultado era que ninguna evidencia llegaba nunca a verde: no porque la literatura fuera mala,
sino porque le pedíamos al modelo juzgar un estudio leyendo solo la contraportada.

Ahora, cuando la primera pasada devuelve una revisión sistemática a la que solo le falta eso, se baja al
texto completo en PubMed Central y se vuelve a extraer. Solo en ese caso: un estudio primario no puede
llegar a verde por bien hecho que esté, así que leerlo entero sería gastar por gastar. Y solo si queda
tiempo de sobra en la función, porque perder la respuesta por afinar una valoración sería mal negocio.

**La cita siempre visible.** Sin revisor humano, el fisioterapeuta es la última línea de defensa y
no puede serlo si no ve de dónde sale el número.

## Qué falta

- Dar el resultado como rango a partir de los intervalos de confianza, no como cifra puntual.
- Ordenar también por aportación real, para responder a «si solo puedo hacer un test, ¿cuál?».
- Un botón para que el fisioterapeuta señale una cifra que no cuadra.
- Una clave de NCBI para subir el límite de peticiones a PubMed de tres por segundo a diez.
  Hoy es lo que marca cuántos tests pueden buscarse a la vez.
