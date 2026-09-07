# FisioIA · Asistente de tests

El fisioterapeuta escribe una sospecha diagnóstica en lenguaje clínico y la herramienta devuelve
la batería de tests con la que verificarla, cómo ejecutar cada uno, y qué permite concluir cada
resultado según la precisión diagnóstica publicada.

## Ponerlo en marcha

Doble clic en **`Abrir Tests.bat`**. Arranca el servidor y abre el navegador en
`http://localhost:3200`. La ventana negra debe quedarse abierta mientras se use.

Desde terminal, el equivalente es:

```bash
npm start
```

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
| `ia/entidades.js` | Registro de entidades: garantiza que la misma sospecha dé siempre la misma respuesta. |
| `server.js` | Servidor HTTP y los tres endpoints. |
| `publico/index.html` | La aplicación. |

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

**La cita siempre visible.** Sin revisor humano, el fisioterapeuta es la última línea de defensa y
no puede serlo si no ve de dónde sale el número.

## Qué falta

- Leer el texto completo en PubMed Central cuando el resumen no traiga las cifras. Hoy más de la
  mitad de los tests salen sin datos y en muchos casos el dato existe, pero está en una tabla.
- Dar el resultado como rango a partir de los intervalos de confianza, no como cifra puntual.
- Paralelizar la búsqueda y mostrar cada test según llega: la primera consulta tarda minutos.
- Ordenar también por aportación real, para responder a «si solo puedo hacer un test, ¿cuál?».
- Un botón para que el fisioterapeuta señale una cifra que no cuadra.
