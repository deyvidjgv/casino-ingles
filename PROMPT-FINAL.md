# Random Classroom — Prompt final

Crea una aplicación web llamada **"Random Classroom"**: un "casino educativo" espacial para clases de inglés. El profesor proyecta los juegos en el tablero para elegir al azar estudiantes, parejas, grupos, temas y preguntas, con animaciones de casino. **NO hay dinero ni apuestas reales**, solo puntos de la clase.

El mundo es una **galaxia con islas flotantes**: cada juego es una isla. El estilo de mapa por niveles de juegos móviles como Plants vs Zombies 2 es solo **referencia**: el diseño y la ubicación de las islas son propios.

---

## 1. Stack

- **React + Vite + TypeScript**.
- **GSAP** (timelines y easing) para todas las animaciones: cámara del mapa, rodillos, ruleta, bolita, cartas, dados, cajas y transiciones. Framer Motion solo para micro-interacciones de UI, si hace falta.
- **Firebase**: Authentication, Firestore (tiempo real y persistencia), Realtime Database (canales en vivo y presencia de alta frecuencia) y Hosting.
- **React Router** para navegación, **Zustand** para estado local e **i18next** para idiomas.
- **Howler.js** para sonidos y música.
- **DiceBear** para avatares.
- **Aleatoriedad** con `crypto.getRandomValues`, nunca `Math.random`. **El resultado se decide ANTES de animar**, y la animación se calcula para terminar exactamente en ese resultado. Todo resultado queda registrado en el historial.
- Responsive: **modo proyector** (textos grandes, alto contraste), computador y celular.

### Firebase ya creado
- Proyecto: `random-classroom`. Ya están habilitados Hosting, Firestore y Auth con **Google**, **Correo/contraseña** y **Anónimo**.
- La configuración web va en `.env` (y un `.env.example` sin valores), nunca escrita directo en el código:
  ```
  VITE_FIREBASE_API_KEY=
  VITE_FIREBASE_AUTH_DOMAIN=random-classroom.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=random-classroom
  VITE_FIREBASE_STORAGE_BUCKET=random-classroom.firebasestorage.app
  VITE_FIREBASE_MESSAGING_SENDER_ID=
  VITE_FIREBASE_APP_ID=
  VITE_FIREBASE_MEASUREMENT_ID=
  ```
- Analytics es opcional: solo se inicializa si `isSupported()` devuelve true.

---

## 2. Idiomas

- Selector **EN / ES** siempre visible. **Inglés por defecto.**
- Todos los textos de la interfaz salen de archivos de traducción (`locales/en.json`, `locales/es.json`). Ningún texto queda escrito directo en los componentes.
- El idioma se guarda en el perfil del usuario (o en localStorage si es invitado).
- El contenido que escribe el profesor (nombres, temas, preguntas, frases de los juegos) se muestra tal cual lo escribió.

---

## 3. Cuentas, roles e invitados

- **Registro** con Google o con correo/contraseña. En el primer ingreso el usuario elige su rol, **"Teacher"** o **"Student"**, que se guarda en `users/{uid}`.
- **Teacher:** crea y administra cursos, configura islas y juegos, lanza sesiones y ve el dashboard.
- **Student:** se une a un curso escribiendo el **código del curso** (ej. `ENG-7K2Q`). Sin código no entra a ningún curso. Puede estar en varios cursos.
- **Invitado (sin cuenta):** entra con **nombre + código del curso**, usando Auth anónimo de Firebase. En la lista del profesor aparece con la etiqueta **"Guest"**.
  - **Recuperar por nombre:** si el invitado pierde la sesión (cambió de dispositivo, borró datos) y vuelve a entrar con el mismo nombre y código, el sistema pregunta *"Are you Ana?"*. El profesor recibe una solicitud y la aprueba o la rechaza. Si la aprueba, el invitado recupera sus puntos e historial.
  - **Pasar a cuenta:** el invitado puede vincular su sesión a Google o a correo en cualquier momento (`linkWithPopup` / `linkWithCredential`) y conserva todo su historial.
- El profesor puede regenerar el código del curso, desactivarlo y expulsar estudiantes.

---

## 4. Cursos

- Cada profesor puede tener **varios cursos**, con un selector para cambiar entre ellos.
- Cada curso tiene: nombre (ej. "10A"), código de ingreso, estudiantes, temas, preguntas o retos, islas y su configuración, y tema de color.
- **Estudiantes del curso** = los registrados con el código + los invitados + los **"manuales"** que el profesor agrega a mano (para quien no tiene celular). Los manuales se pueden pegar en bloque, uno por línea.
- Cada estudiante se puede **activar o desactivar** (por ejemplo, si faltó ese día), editar y eliminar.
- Listas de **temas** y **preguntas o retos**: agregar, editar, borrar, pegar en bloque y reordenar.

---

## 5. Mapa principal: "The Galaxy"

La pantalla de inicio del curso es una galaxia animada, construida **100% en código** (canvas + GSAP), con las islas encima.

### 5.1 Fondo (canvas, capas con parallax)
1. **Espacio profundo:** degradado vertical de `#0B0D2A` a `#1A1E4A`, con grano sutil.
2. **Galaxia espiral lejana:** muy grande, con baja opacidad, rotando lentamente (una vuelta cada varios minutos).
3. **Nebulosas:** 3 o 4 nubes suaves y orgánicas en violeta y rosa con bordes cyan, que se desplazan y "respiran" (cambian suave de escala y opacidad).
4. **Estrellas en 3 profundidades:** la mayoría blancas, algunas cyan y pocas doradas con forma de destello de 4 puntas; todas titilan.
5. **Polvo en primer plano:** partículas difusas que se mueven más con el parallax.

**Detalles "cosmic casino":**
- **Estrellas marquesina:** grupos de estrellas doradas y rosas que se encienden en secuencia, como los bombillos de un letrero de casino.
- **Cinturón de monedas:** monedas y fichas flotantes que giran lento, siempre en espacio vacío, nunca encima de una isla.
- **Camino de constelación:** una línea cyan brillante une las islas, con nodos de estrella y un pulso de luz que viaja de isla a isla cada pocos segundos.
- **Estrellas fugaces:** cada 6 a 12 segundos pasa un cometa con cola de rosa a cyan.
- **Easter eggs:** constelaciones tenues con forma de corazón o pica, un dado y una luna creciente.

### 5.2 Cámara, zoom y navegación
Este punto es crítico: el usuario **no se puede perder** en el mapa.
- El mundo mide unas 3 pantallas de ancho (se ajusta según el número de islas). Las islas van en onda, a distintas alturas; las posiciones salen de un array de configuración.
- **Una sola fuente de verdad para la cámara:** un objeto `camera {x, y, zoom}` que escriben los tweens de GSAP y que lee el render loop.
- **Arrastrar para mover** con Pointer Events (mouse, touch y lápiz), con inercia.
- **Rueda del mouse = zoom** centrado en el cursor. Shift+rueda o deslizar horizontal en el trackpad = mover. Pellizcar para zoom en táctil.
- **Controles abajo a la derecha:** `+`, `−` y **"View all"** (encuadra todas las islas).
- **Teclado:** `+` y `−` para zoom, `0` para ver todo, flechas para mover.
- **Rango de zoom:** mínimo = todas las islas visibles con margen; máximo = 2.5x. Todos los movimientos animados con `power3.out`, unos 0.6 s.
- **Parallax con profundidad al hacer zoom:** las capas lejanas escalan menos que las cercanas.
- **Minimapa abajo a la izquierda ("Star Map"):** un punto por isla en su color, más un rectángulo cyan con la vista actual. Clic en un punto = volar a esa isla. Se puede plegar.
- **Flechas `<` y `>` a los lados:** vuelan a la isla anterior o siguiente siguiendo el camino, y muestran el nombre de la isla de destino. Al cargar, `currentIsland = null`.
- **Al cargar:** muestra "View all" y, 1.5 s después, vuela a la primera isla.
- **Carga rápida:** el cielo se muestra de inmediato y los detalles se agregan después. **Nunca una pantalla negra.** Mientras carga, un indicador con los colores de la paleta.
- **Overlay de depuración** (tecla `D`): zoom, cámara x/y e isla actual.
- **El render loop se pausa** cuando la pestaña está oculta.

### 5.3 Islas
- **Imágenes:** en `img/gemini/*.webp`, ya recortadas con fondo transparente:
  - `jackpot-nebula.webp`
  - `lunar-roulette.webp`
  - `card-comet.webp`
  - `dice-asteroid.webp`
  - `mystery-black-hole.webp`
- **Flotación:** cada isla sube y baja suave (GSAP yoyo), con un desfase distinto por isla.
- **Brillo en código:** glow `drop-shadow` del color de la isla, partículas de polvo cósmico y chispas alrededor (canvas o sprites). Las imágenes vienen sin polvo, así que este efecto va siempre en código.
- **Hover:** la isla crece un poco, el glow se intensifica, las estrellas cercanas brillan y aparece el nombre.
- **Mystery Black Hole:** el centro del agujero quedó semitransparente en la imagen. Hay que poner detrás un círculo `#0B0D2A` alineado con el portal.
- **Nombres:** mínimo 16 px en pantalla a cualquier zoom, fuente Orbitron, con glow del color de la isla.
- **Clic en una isla = "warp":** las estrellas se estiran en rayos hacia la isla, la cámara hace zoom, la pantalla se funde a `#0B0D2A` en unos 1.2 s y se abre el juego. `Esc` o "Back to map" invierten la animación y restauran el zoom y la posición previos. Funciones reutilizables: `warpTo(islandId)` y `returnToMap()`.
- **El profesor administra las islas:** puede agregar, quitar, renombrar, reordenar, ocultar y duplicar (por ejemplo, dos ruletas: una de estudiantes y otra de temas). Una isla duplicada o nueva usa la imagen de su tipo de juego, con el color de glow que elija el profesor.
- **Estudiantes en el mapa:** su avatar aparece como un pequeño astronauta en el leaderboard.

### 5.4 Barra superior y paneles
- **Barra superior:** logo, selector de curso, código del curso (se copia con un clic), botón **"Start session"**, EN/ES, silenciar sonido o música y avatar del perfil.
- **Leaderboard plegable** abajo.
- **Solo para el profesor:** "+ Add island" y "Settings".

---

## 6. Sistema de juegos (extensible)

Cada tipo de juego es un **módulo** con este contrato:

```ts
interface GameModule {
  type: string;                // "slot", "roulette", ...
  name: { en: string; es: string };
  icon: string;
  islandImage: string;
  defaultColor: string;
  configSchema: ConfigSchema;  // genera el formulario de configuración
  defaultTexts: Record<string, { en: string; es: string }>;
  Component: React.FC<GameProps>;
}
```

Agregar un juego nuevo = crear un módulo y registrarlo. No se toca el resto de la app.

### 6.1 Configuración editable por el profesor (en cada isla)
- **Fuente de datos:** students, topics, questions o una mezcla.
- **Frases del juego editables, en EN y ES, con variables.** Ejemplo: `"{student1} & {student2}, talk about {topic}!"`.
- **Modo de repetición:** **"Eliminate"** (quien sale se retira hasta reiniciar o hasta que salgan todos) o **"Keep playing"** (puede volver a salir).
- **Puntos** que gana el elegido o el ganador: los define el profesor.
- Sonido on/off, velocidad y duración de la animación.
- **Antes de empezar**, al entrar a una isla aparece una ventana de configuración rápida con estas opciones, precargada con lo último que usó el profesor.
- **El juego sigue hasta que el profesor pulse "End game".** Entonces se muestra un resumen de la ronda y se guarda en el historial.

---

## 7. Los 5 juegos

### 7.1 Jackpot Nebula: Slot Machine
- **3 rodillos por defecto** (configurable de 3 a 5). El profesor define qué muestra cada rodillo: student, topic o question.
- **Presets:**
  - "2 Students + 1 Topic"
  - "1 Student + 1 Topic + 1 Question"
  - "3 Students (group)"
- **Nunca** aparece el mismo estudiante dos veces en una tirada.
- Los rodillos paran uno por uno, de izquierda a derecha, con desaceleración, luces de bombillos y un sonido por rodillo.
- **Al final:** un cartel grande con la frase configurada y una explosión de partículas estelares.
- Modo "Eliminate" / "Keep playing".

### 7.2 Lunar Roulette: Roulette (Dos modos seleccionables)
- **Modo A, "Selector Wheel" (Ruleta de Selección):**
  - Cada sección de la ruleta representa directamente a un estudiante o tema del grupo activo.
  - La cantidad de casillas se adapta dinámicamente al tamaño del pool activo (no hay números vacíos ni safe spots).
  - Puntero superior con efecto tick por sección. En modo "Eliminate", el estudiante elegido es retirado de la ruleta en los siguientes giros.
- **Modo B, "Real Casino Roulette" (Ruleta Europea Real):**
  - 37 casillas en orden oficial europeo: `0` (verde) y 1 al 36 (rojos y negros).
  - Mesa de apuestas interactiva: el estudiante/profesor puede apostar a Color (Rojo/Negro, paga 1x), Paridad (Par/Impar, paga 1x), Rango (1-18 / 19-36, paga 1x), Docenas (1ª, 2ª, 3ª 12, paga 2x) o Número exacto (paga 5x).
  - Física de bolita en contragiro con rebote en deflectores; aleatoriedad 100% crypto (`randomInt`).
- Diseño: anillo planetario dorado, casillas rosa cósmico y azul noche, bolita blanca con glow cyan.

### 7.3 Card Comet: Blackjack Cósmico (Dos modos seleccionables)
- **Zapato de 52 cartas reales sin reemplazo:** Barajado con crypto; se regenera cuando quedan menos de 10 cartas.
- **Modo A, "Card Draw":** Cartas holográficas boca abajo para sorteos rápidos con volteo 3D.
- **Modo B, "Real Blackjack":**
  - 2 estudiantes compiten contra el Dealer Cósmico.
  - Petición de carta (*Hit*): requiere que haya preguntas registradas en la clase. El profesor valida con ✔ o ✘.
  - **Regla Soft:** Si responde mal, no roba carta y pasa el turno de forma segura sin perder sus cartas previas.
  - **Natural Blackjack:** Si un estudiante recibe 21 en el reparto inicial, pasa automáticamente su turno hacia el dealer para no quedar atrapado.
  - Turnos gestionados sin cierres obsoletos (evitando desincronización de estado en React).
  - En modo "Eliminate", ambos estudiantes participantes completan su turno y quedan marcados como jugados.

### 7.4 Dice Asteroid: Dados de Cristal 3D
- Uno a tres dados gigantes de cristal sobre el asteroide.
- Rotación continua y progresiva (sin saltos visuales ni reseteos bruscos con `% 360` entre tiradas).
- **Garantía de estudiantes distintos:** En tiradas de 2 o 3 dados de estudiantes, se asegura con `pickDistinct` que cada dado caiga en un estudiante diferente (sin duplicados en la misma tirada).
- Intervalos de audio blindados con limpieza automática para evitar fugas de memoria al desmontar.

### 7.5 Mystery Black Hole: Cajas de Singularidad
- Cajas flotantes con física gravitacional sobre el agujero negro.
- **Identificadores únicos por caja:** El estado de apertura y revelación se enlaza con el ID inmutable de cada caja, no por índice de arreglo.
- **Cierre garantizado:** Al hacer *shuffle*, todas las cajas abiertas se cierran con animación antes de mezclarse. Ninguna caja se mezcla abierta ni mostrando su contenido.
- Modo "Eliminate": las cajas abiertas se retiran del agujero negro.

### 7.6 Stellar Derby: Carrera Multijugador en Tiempo Real (Firebase RTDB)
- **Multijugador real aula-estudiantes:**
  - El profesor proyecta la pista en pantalla gigante (`Track.tsx`).
  - Los estudiantes corren desde sus propios teléfonos móviles o computadores (`DerbyPlayerView.tsx`).
  - También cuenta con modo "Un solo dispositivo" con teclas 1 a 6 (ignorando `e.repeat`) y botones táctiles en pantalla del profesor.
- **Autoridad del profesor:**
  - El dispositivo del profesor es la única autoridad de la física y cálculo de posiciones.
  - El estudiante solo envía su contador acumulado de taps throttled (~150 ms).
  - El profesor aplica la diferencia limitada a 10 taps por segundo (`MIN_TAP_MS`). Taps fuera de fase `running` no cuentan.
- **Canal en vivo en Realtime Database:**
  - `/presence/{courseId}/{uid}`: Presencia con `onDisconnect().remove()`.
  - `/races/{courseId}/state`: Fase (lobby, countdown, running, question, finish, closed), lista de jinetes, checkpoints y pregunta.
  - `/races/{courseId}/positions`: Progreso publicado por el profesor a ~8 Hz.
  - `/races/{courseId}/taps/{uid}`: Contadores acumulados de los jinetes.
  - `/races/{courseId}/hands/{uid}`: Manos levantadas durante las preguntas.
  - `/races/{courseId}/bets/{uid}`: Apuestas de los espectadores.
- **Preguntas pedagógicas durante la carrera:**
  - Manuales (tecla Q o botón) o automáticas en checkpoints (25%, 50%, 75% del líder).
  - Congelan la carrera en todos los dispositivos. Los estudiantes pueden pulsar "Raise Hand" en su pantalla.
  - El profesor elige quién responde y juzga con ✔ o ✘. La respuesta correcta otorga turbo y puntos al jinete.
  - Reanudación sincronizada con cuenta regresiva. Desempate sin truncar progreso (foto-finish).
  - Payout protegido por `paidRef` para evitar duplicación de puntos.

---

## 8. Sesiones en vivo (tipo Kahoot)

- El profesor pulsa **"Start session"** en un curso. Los estudiantes conectados ven en su celular, en tiempo real (Firestore `onSnapshot`), el juego activo y el resultado.
- **Si sale su nombre:** pantalla grande con *"It's your turn!"* / *"¡Es tu turno!"*, vibración si el dispositivo lo permite y un sonido.
- **Solo el profesor controla los giros.** Los estudiantes solo miran.
- **En el celular, el estudiante ve solo:**
  1. El juego en vivo.
  2. Sus puntos y su posición.
  3. Su historial.
- Si se cae la conexión, la sesión se reconecta sola y se muestra un indicador.

---

## 9. Puntos y marcador

- Los puntos de cada juego los define el profesor. Además tiene botones rápidos (+1, +5, −1) sobre cualquier estudiante.
- **Leaderboard** por curso, con animación de cambio de posiciones.
- Solo el profesor puede modificar puntos.

---

## 10. Dashboard del profesor (tipo Kahoot)

- **Resumen:** cursos, número de estudiantes (registrados, invitados y manuales) y sesiones realizadas.
- **Historial completo:** fecha, juego, isla, resultado (quién salió, con qué tema o pregunta), puntos otorgados, respuesta ✔/✘ y casillas de salvación.
- **Estadísticas:** veces que participó cada estudiante, estudiantes que aún no han salido y ranking.
- Filtros por curso, fecha y juego. **Exportar a CSV.**
- **Solicitudes pendientes:** invitados que piden recuperar su cuenta (aprobar o rechazar).

---

## 11. Diseño

### Paleta "Nebula" (tokens CSS en `:root`)

| Token | Color | Uso |
|---|---|---|
| `--space-deep` | `#0B0D2A` | fondo principal |
| `--space-mid` | `#1A1E4A` | paneles, tarjetas |
| `--nebula-purple` | `#7B2FF7` | acento principal, botones |
| `--nebula-pink` | `#F72585` | ganadores, highlights |
| `--star-cyan` | `#4CC9F0` | información, enlaces, foco |
| `--gold-jackpot` | `#FFD166` | puntos, premios |
| `--text-main` | `#F1F3FF` | texto principal |
| `--text-soft` | `#A5A9D6` | texto secundario |
| `--success` | `#06D6A0` | respuesta correcta ✔ |
| `--danger` | `#EF476F` | respuesta incorrecta ✘ |

**Color de cada isla:**
- Jackpot Nebula: dorado
- Lunar Roulette: rosa
- Card Comet: violeta
- Dice Asteroid: cyan
- Mystery Black Hole: dorado y rosa

### Estilo
- **Degradados de nebulosa** (violeta → rosa → cyan) en los botones principales y los carteles de ganador.
- **Glow neón** en botones, nombres ganadores e islas activas.
- **Tarjetas y paneles en glassmorphism:** `#1A1E4A` al 70% con `backdrop-filter: blur`.

### Tipografía (Google Fonts)
La tipografía debe ir 100% con el diseño.
- **Orbitron:** títulos, nombres de islas y carteles de ganador.
- **Audiowide:** números de la ruleta, puntos, marcador y rodillos.
- **Exo 2:** textos, botones, formularios y listas.

### Avatares
- **DiceBear**, generados a partir del nombre (no hace falta guardar imágenes).
- El estudiante elige estilo y variante entre `bottts`, `adventurer`, `fun-emoji` y `pixel-art`, o se le asigna uno automático.
- Los invitados reciben un avatar automático.

### Sonidos, música y animaciones
Todo con **Howler.js**. Los sonidos se sacan de fuentes gratuitas (Pixabay, Kenney, Freesound CC0), y sus créditos van en el README.
- **Música de fondo espacial** en el mapa y una música distinta, más animada, dentro de los juegos.
- **Efectos:** whoosh del warp, clic de rodillos, bolita rodando, cartas, dados, caja abriéndose, fanfarria cósmica al ganar y sonido de "salvación".
- **Controles separados** para música y efectos (volumen y mute), guardados en el perfil.
- **Ganador:** explosión de partículas y estrellas en vez de confeti.
- Las transiciones entre pantallas son animadas (nada aparece de golpe).
- **Se respeta `prefers-reduced-motion`:** sin warp, parallax ni cometas; solo fundidos.
- **Modo proyector:** interfaz más grande y con más contraste.

---

## 12. Firestore (modelo)

```
users/{uid}: name, email, role, lang, avatar {style, seed}, isGuest, createdAt
courses/{courseId}: teacherId, name, code, codeActive, theme, createdAt
courses/{id}/members/{uid | manualId}: name, active, points, type ("account" | "guest" | "manual"), avatar
courses/{id}/topics/{id}: text, order
courses/{id}/questions/{id}: text, order
courses/{id}/islands/{islandId}: type, name, order, visible, color, position, config, texts
courses/{id}/sessions/{sessionId}: live, currentIslandId, state, lastResult, updatedAt
courses/{id}/history/{id}: islandId, gameType, result, points, correct, saved, timestamp
courses/{id}/recoveryRequests/{id}: guestUid, claimedMemberId, name, status, createdAt
joinCodes/{code}: courseId, active
```

## 13. Seguridad (`firestore.rules`): obligatorio

- Solo el **profesor dueño** lee y escribe su curso, las islas, la configuración, el historial y las solicitudes.
- Un **estudiante o invitado** solo lee los cursos donde es miembro, y solo se une con un código válido y activo.
- Un estudiante o invitado solo puede escribir **su propio** documento de miembro (nombre y avatar), **nunca sus puntos**, y crear su solicitud de recuperación.
- Nada de reglas abiertas. Se validan tipos, tamaños de texto y el rol en las reglas.
- **Pruebas de reglas** con el emulador de Firebase.

---

## 14. Casos borde

- Pocos elementos para el modo elegido (ej. menos de 2 estudiantes en modo pareja): mensaje claro y no se puede girar.
- El botón queda bloqueado mientras el juego gira o anima.
- Lista vacía: invitación a agregar datos, con un botón.
- Todos eliminados en modo "Eliminate": aviso y opción de reiniciar la ronda.
- Código inválido o desactivado: error amable.
- Nombre de invitado repetido en el curso: se ofrece la recuperación.
- Se cae la conexión en vivo: se reconecta sola, con un indicador.
- Las imágenes de las islas no cargan: se muestra un planeta de respaldo dibujado en CSS con el color de la isla.

---

## 15. Entregables

- **Proyecto completo** con estructura clara:
  - `src/app`, `src/features/{auth,courses,galaxy,games,session,dashboard}`
  - `src/games/{slot,roulette,blackjack,dice,mystery}`
  - `src/lib/firebase`, `src/locales`, `src/styles`, `public/islands`, `public/sounds`
- **Las 5 islas** copiadas de `img/gemini/*.webp` a `public/islands/`.
- `.env.example`, `firestore.rules`, `firestore.indexes.json`, `firebase.json` (Hosting con rewrites para SPA).
- **Datos de ejemplo:** un curso demo con 10 estudiantes, 8 temas y 8 preguntas.
- **README** con:
  - Pasos para correr en local.
  - Emuladores.
  - Deploy (`npm run build && firebase deploy`).
  - Cómo agregar un juego nuevo.
  - Créditos de sonidos y avatares.
