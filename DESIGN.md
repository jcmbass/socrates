# DESIGN.md — Sistema de diseño socrates

Fuente de verdad del diseño de **socrates**. Cualquier token, componente o
copy nuevo en `apps/mobile` o `apps/harness` debe derivar de este documento,
no inventarse en el sitio. Si un valor cambia aquí, cambia en ambos clientes.

> Nombre interno del repositorio: **buxo** (codename, uso interno/infra
> únicamente — paths, package ids nativos, nombre de repo git). Nombre de
> producto de cara al usuario: **Socrates** — con S mayúscula, sin tilde
> (decisión del founder, 2026-07-16). Slugs/handles técnicos en minúscula
> (`socrates`).

## 1. Esencia de marca y posicionamiento

- **Posicionamiento:** IA avanzada al límite de la tutoría. La inteligencia
  primero, la interfaz después.
- **Promesa:** "El agente que aprende contigo."
- **Audiencia:** estudiantes, mobile-first, con integración a
  Telegram/WhatsApp — tiene que sentirse listo para uso diario, no una demo
  de laboratorio.
- **Tono:** profesional, directo, minimalista, seguro de sí mismo. Sin hype
  artificial; que hablen las capacidades, no los adjetivos.
- **Ritmo:** revelaciones lentas, una idea a la vez, espacio para pensar.
- **Mood:** una sesión de estudio nocturna, enfocada — calma, segura,
  inteligente.
- **No es un chatbot.** Es un Agente Tutor que aprende con el estudiante:
  adaptación, evolución, aprendizaje de largo plazo.

## 2. Paleta — dark-mode-first

**socrates es una marca dark.** El modo oscuro es el diseño por defecto y
el que se optimiza primero; el modo claro es la excepción — se ofrece por
accesibilidad/preferencia del sistema, pero cualquier decisión de diseño
que solo funcione en uno de los dos modos debe resolverse a favor de dark.
En ambos clientes, cuando la plataforma tenga un ajuste de tema, dark es el
valor por defecto (no esperar a que el usuario elija).

| Rol | Hex | Uso |
|---|---|---|
| Fondo (`background`) | `#0d1117` | Lienzo principal oscuro |
| Superficie (`surface`) | `#161b22` | Tarjetas, bloques, paneles |
| Elevado (`elevated`) | `#21262d` | Hover, superficies secundarias |
| Borde (`border`) | `#30363d` | Bordes sutiles, separadores |
| Primario (`primary` / accent) | `#58a6ff` | Elementos activos, highlights, acento del agente |
| Secundario (`success`) | `#7ee787` | Éxito, comprensión, progreso |
| Terciario (`hint`) | `#d29922` | Pistas, advertencias, empujones suaves |
| Texto primario | `#c9d1d9` | Títulos, cuerpo |
| Texto secundario | `#8b949e` | Captions, metadata, labels |
| Texto muted | `#6e7681` | Deshabilitado, elementos silenciosos |

Notas de mapeo a los tokens existentes (`apps/mobile/theme/tokens.ts`,
`apps/harness/app/globals.css` — mismo vocabulario semántico en los dos
clientes, D2 §4.7):

- `surface` → fondo de página (`--background` / `colors.surface`)
- `surfaceRaised` → `surface` de la tabla (`#161b22`)
- `border` → `border` de la tabla
- `accent` → `primary` (`#58a6ff`)
- `accentLight` → un tinte de `primary` sobre `surface` (chips, selección)
- `success` → `secondary` (`#7ee787`)
- `warning` → `tertiary` (`#d29922`)
- `danger` → se mantiene un rojo fuera de la paleta socrates (la paleta no
  define uno); usar un rojo desaturado que pase AA sobre `#0d1117` —
  mantener el valor actual salvo que el founder defina uno de marca.

### Modo claro (excepción, no default)

El modo claro deriva invirtiendo los mismos roles sobre superficies claras
neutras (blancos/grises cálidos), conservando `primary`/`success`/`hint`
ajustados en luminosidad para seguir cumpliendo AA sobre fondo claro. No es
el objeto de optimización visual de la marca — existe para accesibilidad y
para respetar la preferencia de sistema del usuario.

## 3. Tipografía

- Títulos y cuerpo: **Inter** (limpia, muy legible, moderna).
- Código y matemáticas: **JetBrains Mono**.
- Pesos: 400 regular, 500 medium, 600 semibold, 700 bold.
- **Regla de una sola familia sans-serif.** Nada decorativo. JetBrains Mono
  es la única excepción, reservada a contenido monoespaciado real (código,
  no fórmulas KaTeX — KaTeX usa su propia familia tipográfica matemática
  por requisitos de layout; no se sustituye).

## 4. Forma, textura y elevación

- Esquinas afiladas o ligeramente redondeadas: **8px–12px**. Nada
  "burbujeante" (pill shapes reservados a controles puntuales: badges,
  botón de enviar).
- Bloques modulares con bordes definidos (`border` de la tabla), no
  separación solo por espacio en blanco.
- Textura de fondo sutil: dot-grid o líneas de código tenues, solo en
  superficies de marca/vacías — nunca detrás de texto de lectura larga.
  Fuera de alcance para el MVP del harness/mobile chat (aplica a
  landing/marketing); no bloquea esta importación.
- Glows finos en elementos primarios activos, no sombras pesadas. Un
  `box-shadow`/`shadow-*` grande es señal de que hay que cambiarlo por un
  borde + glow de 1-2px en `primary`.

## 5. Avatar

- El agente tiene identidad de **Sócrates mujer** — reflexiva, humana,
  inteligente. Nunca un ícono/emoji ni una mascota-caricatura.
- Formato: **retrato circular**, calmado. Dos variantes disponibles en
  `assets/socrates/characters/`:
  - `socrates-avatar.jpg` — rostro, ilustración grabada en blanco y negro
    con una Σ (sigma griega) en el cuello, la firma silenciosa de marca.
  - `socrates-contemplating.jpg` — perfil contemplativo, mano cerca del
    pecho. Reservada para estados de espera/reflexión (streaming de la
    primera respuesta, "pensando", pausas de hint).
- Uso: pequeño, junto a mensajes del tutor (nunca junto a mensajes del
  estudiante). No animar el avatar en sí (glow/opacity del contenedor sí,
  el retrato no se escala ni gira).

## 6. Movimiento

- Transiciones de UI: **< 0.6s**, easing `power2.out` (GSAP) o el
  equivalente CSS/RN — evitar linear y evitar "scale bombs" (nada de
  animar `scale` como efecto dramático de entrada).
- Revelaciones de concepto (no UI de cada día): 1.2s–2s está bien.
- No animar propiedades de reflow (`letterSpacing`, `width` layout-full,
  etc.). Animar `opacity`, `x`, `y`, `scale` puntual controlado.
- **Respetar `prefers-reduced-motion` / `AccessibilityInfo.isReduceMotionEnabled`
  siempre** — ya es una restricción de WP2 (`useReduceMotion` en
  `apps/mobile/theme/useTheme.ts`); el harness debe igualarla con
  `prefers-reduced-motion` en CSS donde haya animación (p.ej. `thinking-dot`).
- Indicadores de progreso: línea fina, puntos pequeños, contadores de paso
  — no spinners genéricos ni barras gruesas.

## 7. Voz y copy

Evitar: "revolucionario", "mágico", "el mejor", "100% garantizado", y en
general cualquier superlativo sin sustento.

Preferir:

- "El agente que aprende contigo."
- "No te da la respuesta. Te guía hasta que la encuentres."
- "Un tutor que se adapta a cómo aprendes."
- "Disponible donde tú estudias: Telegram, WhatsApp, web."

Aplicación práctica: textos de estado ("pensando…", "consentimiento",
"error de red") deben ser neutros y directos, sin alarmismo (ver F5 del
audit del harness — un banner ámbar permanente para consentimiento no es
tono socrates).

## 8. Accesibilidad — pisos mínimos

- Contraste sobre fondos oscuros (`#0d1117`/`#161b22`):
  - Texto secundario `#8b949e` es el mínimo aceptable — no bajar de ahí
    para texto que se necesita leer.
  - `#6e7681` **solo** para estados deshabilitados/silenciados, nunca para
    texto que el estudiante deba leer para avanzar.
  - Texto sobre `primary` (`#58a6ff`) debe verificarse — no asumir blanco
    fijo: igual que el token actual `accentContrast` ya resuelve (blanco
    en claro, índigo profundo en oscuro) porque el acento se aclara en
    dark, `primary` en socrates también es un azul claro sobre fondo
    oscuro — texto sobre chips/botones `primary` puede necesitar un tono
    oscuro de vuelta si el propio `primary` sirve de fondo en claro.
- Touch targets: **mínimo 44px** (piso del audit UX del harness, F15;
  compatible con el `MIN_TOUCH_TARGET = 48` ya usado en mobile — 48 sigue
  siendo el estándar del proyecto, 44 es el piso absoluto, no el target).
- `color-scheme: dark` debe declararse donde falte (F12 del audit) para
  que los controles nativos del navegador/WebView respeten el tema.
- Todo elemento interactivo nuevo necesita label accesible (aria-label /
  accessibilityLabel), como ya hace `ThinkingDots`.
- **Controles destructivos (cancelar, borrar, descartar):** la zona de toque
  no puede ser más ancha que la etiqueta visible (`alignSelf: "flex-start"`,
  no stretch a todo el panel). Tampoco pueden compartir el mismo color y
  tamaño que el texto de estado que los rodea — necesitan afordancia propia
  (borde o fondo tenue) y altura mínima `MIN_TOUCH_TARGET`. Un tap en el
  mensaje de progreso nunca debe disparar la acción destructiva.

## 9. Naming

- Producto: **Socrates** — S mayúscula en el wordmark y todo string de cara
  al usuario (decisión del founder, 2026-07-16). Sin tilde en el wordmark
  (portabilidad de slugs/handles/dominios); el copy de marketing en español
  puede usar "Sócrates" en prosa si el founder lo aprueba caso por caso.
  Slugs, handles y paths técnicos: `socrates` en minúscula.
- Codename: **buxo** — interno únicamente. No aparece en ningún string de
  cara al usuario (títulos, metadata, splash, app store listing). Sigue
  usándose en: nombre del repo, paths de paquetes (`@buxo/core`,
  `@buxo/domain`, `@buxo/mobile`) y el scheme de deep link (`buxo://`),
  que es independiente del package id y no se toca.
- Package id nativo de Android: **`com.socrates.tutor`** — migrado el
  2026-09-03 desde el placeholder de Expo `com.anonymous.buxo`, que esta
  doc daba por "fuera de alcance". Se hizo justo antes del primer envío a
  Play Console porque es la última oportunidad: una vez que Google recibe
  un `applicationId` queda fijo para siempre y cambiarlo obliga a publicar
  una app nueva. Patrón de la app hermana Biyu (`com.biyu.pos`): marca +
  categoría del producto, no el paraguas institucional `cubo.lat`.

## 10. Aplicación a los dos clientes

Tanto `apps/mobile` (tokens JS, `theme/tokens.ts`) como `apps/harness`
(CSS vars, `app/globals.css`) **deben derivar sus valores de este
documento** — mismo vocabulario semántico, mismos valores de color, misma
tipografía, mismas reglas de movimiento y accesibilidad. Si un cliente
necesita desviarse (p.ej. limitaciones de una WebView), la desviación se
documenta en el código con referencia a esta sección, no se inventa un
valor nuevo sin registro.

## Preguntas abiertas para el founder

- ~~Casing del wordmark~~ — **RESUELTA 2026-07-16: "Socrates", S mayúscula,
  sin tilde** (ver §9).
- **Ícono de la app** (glyph/mark, distinto del retrato-avatar): pendiente
  de diseño — el retrato no funciona como launcher icon a 48px. Candidata
  natural: la Σ de la firma de marca sobre `#0d1117`.
