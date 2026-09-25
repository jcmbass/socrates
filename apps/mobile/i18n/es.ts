/**
 * UI strings — Spanish (es), the default locale (A1 localization).
 *
 * Central typed object, ZERO hardcoded strings in components: every screen
 * imports `t` from here (directly, pre-A1) or via the `useT()` hook
 * (i18n/react.tsx — reactive locale). `Strings` is the contract each locale
 * file satisfies (`i18n/en.ts` since A1).
 *
 * Deliberately NOT `as const` anymore: with `as const`, every value's type
 * was its exact literal, so an `en: Strings` could never hold English text
 * (A2) — the contract would have forced byte-identical Spanish. Without it,
 * string values widen to `string` and the shape (keys + function signatures)
 * is what tsc enforces.
 *
 * Tone: gamificado-adulto (D2 §4.5) — direct, warm, never infantilizing.
 */

export const es = {
  common: {
    appName: "Socrates",
    back: "Volver",
    cancel: "Cancelar",
    continue: "Continuar",
    loading: "Cargando…",
    retry: "Reintentar",
    genericError: "Algo salió mal. Intentá de nuevo.",
  },

  login: {
    title: "Socrates",
    tagline: "No te da la respuesta. Te guía hasta que la encuentres.",
    // Encabezados del formulario: sin ellos la vista quedaba como una flecha
    // de volver y un campo suelto, sin decir qué estás haciendo (2026-08-06).
    formTitleSignup: "Crear cuenta",
    formTitleLogin: "Iniciar sesión",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "tu@correo.com",
    nameLabel: "¿Cómo te llamamos?",
    namePlaceholder: "Tu nombre",
    ageCheckbox: "Confirmo que tengo 13 años o más",
    termsCheckbox: "Acepto los términos y la política de privacidad",
    // El texto decía "(versiones DRAFT — pendientes de validación legal del
    // founder)". Era honesto pero hablaba hacia adentro: un estudiante de 15
    // años no sabe qué es un founder ni qué implica un DRAFT, y leerlo solo
    // le siembra desconfianza sin darle información accionable. La validación
    // legal sigue pendiente y sigue registrada como bloqueante para usuarios
    // externos (docs/legal/, checklist de lanzamiento) — lo que cambia es a
    // quién se le cuenta, no el hecho.
    termsNote: "Al crear tu cuenta aceptás nuestros términos y nuestra política de privacidad. Podés leerlos acá:",
    /** Enlaces a los documentos publicados (`lib/legalUrls.ts` → servidor). */
    termsLink: "Términos de Servicio",
    privacyLink: "Política de Privacidad",
    legalLinkFailed: "No pudimos abrir el documento. Está en tu navegador: ",
    submit: "Crear cuenta",
    submitLogin: "Enviar enlace de acceso",
    // DESIGN.md §7 lista "mágico" como palabra prohibida (hype sin sustento)
    // — "enlace de acceso" dice lo mismo en el tono neutro-directo de la
    // marca (decisión del founder, 2026-08-06).
    stubNote: "Te enviaremos un enlace de acceso a tu correo — sin contraseñas.",
    // Vista de bienvenida: el modo lo elige un botón, no un toggle dentro
    // del formulario (rediseño 2026-08-06 — ver app/login.tsx).
    hasAccount: "Ya tengo cuenta",
    errors: {
      emailInvalid: "Escribí un correo válido.",
      nameRequired: "Escribí tu nombre.",
      ageRequired: "Necesitás confirmar que tenés 13 años o más.",
      termsRequired: "Necesitás aceptar los términos para continuar.",
      network: "No pudimos conectar con el servidor. ¿Está corriendo apps/server?",
      conflict: "Ya existe una cuenta con este correo — intentá iniciar sesión.",
      generic: "No pudimos completar la solicitud. Intentá de nuevo.",
    },
    verify: {
      title: "Revisá tu correo",
      instructions: "Tocá el enlace que te enviamos a tu correo para entrar.",
      verifying: "Verificando tu enlace…",
      /** __DEV__-only: the emailed link doesn't leave the machine in dev builds (ConsoleEmailSender), so the field below lets you paste the token straight from the apps/server console. */
      devPasteInstructions:
        "Modo desarrollo: el correo no sale de verdad — mirá la consola donde corre apps/server y pegá acá el token que aparece ahí.",
      devTokenLabel: "Token del enlace (solo desarrollo)",
      devTokenPlaceholder: "Pegá el token acá",
      submit: "Verificar y entrar",
      back: "Volver",
      errors: {
        tokenRequired: "Pegá el token del enlace.",
        invalid: "El enlace no es válido o ya venció. Pedí uno nuevo.",
      },
    },
  },

  courses: {
    title: "Tus cursos",
    greeting: (name: string) => `Hola, ${name}`,
    empty: "Todavía no tenés cursos. Creá el primero para empezar a estudiar.",
    newCourse: "Nuevo curso",
    subjectCount: (n: number) => (n === 1 ? "1 materia" : `${n} materias`),
    lastActivity: (date: string) => `Última actividad: ${date}`,
    noActivity: "Sin actividad todavía",
    loadError: "No pudimos cargar tus cursos.",
    streak: {
      // C2-e: copy corto a propósito — `StreakDisplay` lo trunca con
      // numberOfLines={1} dentro de StatsStrip, así que el texto largo se
      // cortaba a mitad de frase. Guardia de longitud en
      // lib/__tests__/i18nLength.test.ts.
      none: "Sin racha aún",
      active: (n: number) => `${n} explicaciones seguidas`,
      broken: "Seguí practicando para retomar tu racha",
      reason: (reason: string) => `— ${reason}`,
      /**
       * A1 — reason copy moved OUT of lib/streak.ts (which hardcoded Spanish
       * at line 44, the audit's one sanctioned exception) into the catalog so
       * the streak surface follows the active locale. Keyed by the server's
       * opaque reason keys, lowercased-camelCase here.
       */
      reasons: {
        explainedAcrossSessions: "explicaciones consistentes",
        sustainedOverTime: "constancia en el tiempo",
      },
    },
  },

  newCourse: {
    title: "Nuevo curso",
    stageLabel: "¿Qué estás estudiando?",
    stageComingSoon: "próximamente",
    gradeLabel: "Elegí tu nivel",
    customLabelPrompt: "¿Querés darle un nombre a tu curso?",
    customLabelPlaceholder: "Ej.: Bachillerato técnico en salud",
    templatesLabel: "Materias sugeridas",
    templatesHint: "Desmarcá las que no aplican. Podés agregar más después.",
    create: "Crear curso",
    errors: {
      gradeRequired: "Elegí un nivel para continuar.",
      submitFailed: "No pudimos crear el curso. Intentá de nuevo.",
    },
  },

  courseDetail: {
    subjectsEmpty: "Este curso todavía no tiene materias.",
    addSubject: "Agregar materia",
    lastSession: (date: string) => `Última sesión: ${date}`,
    noSessions: "Sin sesiones todavía",
    loadError: "No pudimos cargar las materias de este curso.",
  },

  newSubject: {
    title: "Nueva materia",
    nameLabel: "Nombre de la materia",
    namePlaceholder: "Ej.: Matemática",
    create: "Crear materia",
    errors: {
      nameRequired: "Escribí el nombre de la materia.",
      submitFailed: "No pudimos crear la materia. Intentá de nuevo.",
    },
  },

  // C2-e — notas de materia en la card de home (components/SubjectCard.tsx).
  subject: {
    // Nota discreta (caption muted): el temario está en el idioma del
    // estudiante, pero el libro seed detrás está en inglés — el server lo
    // dice con `seedMaterialLang` (fallback a la única fuente EN-only, p.ej.
    // bachillerato/fisica).
    materialInEnglish: "Material en inglés",
  },

  coldStart: {
    title: "Despertando a Socrates…",
    subtitle: "El servidor está arrancando. Puede tomar hasta un par de minutos la primera vez.",
    retrying: "Reintentando…",
    /** Rotan bajo el subtítulo mientras dura la espera (se ocultan con reduce-motion). */
    bootLines: [
      "Encendiendo motores…",
      "Socrates se está desperezando…",
      "Preparando el café…",
      "Desempolvando los pergaminos…",
      "Afinando las preguntas…",
      "Buscando las sandalias…",
    ],
  },

  // P4 — home (tarjetas de materia + XP total). Reemplaza el contenido de
  // app/courses/index.tsx (ver DEVLOG P4 para la decisión de mantener la
  // ruta "/courses" pero rediseñar su contenido a home).
  home: {
    title: "Inicio",
    heading: "¿Qué querés estudiar hoy?",
    empty: "Todavía no tenés materias. Agregá la primera para empezar a estudiar.",
    addSubject: "Agregar materia",
    loadError: "No pudimos cargar tus materias.",
    /** C2-b — reemplaza el par "Eliminar mi cuenta" (texto rojo) + logout que vivía en la cabecera de home; ahora es el único acceso ahí. */
    profileButtonA11y: "Abrir tu perfil",
    status: {
      empty: "Sin temario aún",
      configured: (count: number, currentTopic: string | null) =>
        currentTopic ? `${count} temas · en ${currentTopic}` : `${count} temas`,
    },
    xp: {
      label: "XP",
      hidden: "El progreso todavía no es visible — se activa más adelante en la beta.",
    },
    /** D2 — hero card ("Continuá donde ibas"). NUEVO copy en voseo, coherente con onboarding — no toca el dialecto de `heading`/`empty` arriba (voseo resuelto como dialecto único de la app, decisión del founder 2026-08-06). */
    hero: {
      eyebrow: "Continuá donde ibas",
      progressLabel: (doneCount: number, total: number) => `${doneCount}/${total} temas`,
      starsLabel: (stars: number, max: number) => `${stars} de ${max} estrellas`,
    },
  },

  // P4 — árbol de temario ("estudios"). DF-P02: navegación libre, sin
  // candados — todo tema es tocable, el recomendado brilla.
  skillTree: {
    title: "Temario",
    loadError: "No pudimos cargar el temario de esta materia.",
    recommendedBadge: "Recomendado",
    starsA11y: (stars: number) => `${stars} de 3 estrellas`,
    milestone: {
      parcial: "Parcial",
      examen_final: "Examen final",
    },
    /** W3 header (`assets/estudios.html`'s `.eyebrow`/`.progress-label`) — in-page, replaces the native Stack title. */
    topicLabel: (order1based: number) => `TEMA ${order1based}`,
    completedLabel: "Completado",
    progressLabel: (doneCount: number, total: number, percent: number) => `Tema ${doneCount} / ${total} · ${percent}%`,
    /** Hallazgo C — progreso guiado DENTRO de un tema (tarjeta del árbol). */
    topicGuidedProgress: (completed: number, total: number, percent: number) => `${completed}/${total} · ${percent}%`,
    topicGuidedProgressA11y: (completed: number, total: number, percent: number) =>
      `${completed} de ${total} ejercicios, ${percent}%`,
    routeLabel: "TU RUTA DE APRENDIZAJE",
    /** No candado language (DF-P02) — "aparecen", never "se desbloquean". */
    routeHint: "Los temas avanzados aparecen arriba",
    routeHintDown: "Los temas avanzados aparecen abajo",
    startCap: "INICIO DEL TEMARIO",
    continueCta: (topicTitle: string) => `Continuar: ${topicTitle}`,
    editTemario: "Editar temario",
    doneEditing: "Ver árbol",
    /** C2-d — cabecera de cada sección colapsable de unidad (materias seed con `unitLabel`). */
    unitProgressLabel: (doneCount: number, total: number) => `${doneCount}/${total}`,
    unitToggleA11y: (unitTitle: string, doneCount: number, total: number) =>
      `${unitTitle}, ${doneCount} de ${total} completados`,
    /** C2-d — línea de atribución CC BY al pie del temario de una materia seed. */
    attribution: (title: string, publisher: string, licenseName: string) =>
      `Temario basado en ${title}, ${publisher}, ${licenseName}`,
    /** C2-d — título de la sección colapsable para temas SIN unidad, dentro de un temario que sí tiene otras unidades (dato mixto, caso raro). */
    noUnitLabel: "Otros temas",
    /** Setup for missing OR empty orphan temario (beta-real 06 — same student-facing state). */
    emptyState: {
      title: "Esta materia todavía no tiene temario.",
      subtitle: "Subí el programa o armalo a mano para empezar tu ruta de aprendizaje.",
      uploadPdf: "Subir PDF",
      manual: "Manual",
      manualFailed: "No pudimos crear el temario. Intentá de nuevo.",
      readingProgress: "Leyendo tu programa…",
      buildingProgress: "Armando tu temario…",
      retryGenerate: "Reintentar generación",
      errors: {
        invalid_pdf: "Ese archivo no se pudo leer. Probá con otro PDF.",
        quota: "Alcanzaste el límite de páginas por hoy. Probá mañana o usá Manual.",
        quotaDaily: "Alcanzaste el límite diario de páginas de material. Se renueva mañana. Podés usar Manual.",
        quotaMonthly: "Alcanzaste el límite mensual de páginas de material. Se renueva el próximo mes. Podés usar Manual.",
        quotaCost: "Alcanzaste el tope de uso por ahora. Probá más tarde o usá Manual.",
        network: "Se cortó la conexión. Podés reintentar cuando vuelva.",
        generate_failed:
          "Tu programa ya quedó guardado, pero no pudimos armar el temario. Reintentá la generación sin volver a subir el PDF, o usá Manual.",
        unknown: "Algo salió mal. Podés reintentar o armar el temario a mano.",
        safety: "No pudimos procesar ese archivo. Probá con otro o usá Manual.",
        too_many_pages: (_max: number) =>
          "Este PDF es muy largo y no le encontramos un índice que podamos usar. Partilo o usá Manual.",
        raster_too_large: "Una página del PDF es demasiado grande para procesarla. Probá con otro archivo o usá Manual.",
        timeout: "Tardó demasiado en leerse el archivo. Probá de nuevo o usá Manual.",
      },
    },
  },

  study: {
    inputPlaceholder: "Escribí tu respuesta…",
    send: "Enviar",
    sendA11yLabel: "Enviar mensaje",
    thinkingA11yLabel: "El tutor está pensando",
    emptyState:
      "Contale al tutor qué estás estudiando hoy y por dónde querés empezar.",
    sessionLoadError: "No pudimos cargar esta sesión de estudio.",
    quotaExceeded: "Alcanzaste el límite de mensajes por ahora — probá de nuevo más tarde.",
    /**
     * Solo cuando de verdad no hubo respuesta HTTP (`network_error`). Antes
     * este texto se mostraba para CUALQUIER error del servidor, y culpaba a
     * la conexión del estudiante por caídas del proveedor del tutor.
     */
    turnFailedNetwork: "No se pudo enviar tu mensaje. Revisá tu conexión.",
    turnFailedTutor: "Socrates no está disponible en este momento. No es tu conexión — probá de nuevo en un rato.",
    turnFailedServer: "Algo falló de nuestro lado al responder. Tu mensaje sigue acá: podés reintentar.",
    turnFailedSessionClosed: "Esta sesión de estudio ya se cerró. Volvé al tema para empezar otra.",
    /**
     * `duplicate_turn` que sobrevivió a la reconciliación: el turno está EN
     * VUELO. Reenviar es justo lo que no hay que hacer, así que el texto pide
     * esperar en vez de invitar a reintentar (beta-real 10).
     */
    turnAlreadyInFlight: "Tu mensaje ya se está enviando. Esperá un momento — no lo mandes de nuevo para que no se duplique.",
    retrySend: "Reintentar envío",
    /** Señales honestas de actividad (A §5.2, sombra F3) — no son logros, no derivan del assessor. */
    activitySessions: (n: number) => (n === 1 ? "1 sesión hoy" : `${n} sesiones hoy`),
    activityExchanges: (n: number) => `${n} intercambios en total`,
    /** Inline transcript marker (F2 WQ3 parte C2) for a MaterialEvent with action:"added" — `{source}` is replaced with the event's display name. */
    materialAddedMarker: "Guía añadida: {source}",
    /** Same marker for action:"removed" — no current flow produces this (server has no material-removal route yet), kept for shape completeness. */
    materialRemovedMarker: "Guía quitada: {source}",
  },

  onboard: {
    stepLabel: (step: number) => `Paso ${step} de 3`,
    paso1: {
      title: "¿En qué nivel estás?",
      subtitle: "Elegí bachillerato o universidad para armar tu plan de estudio.",
      stageLabel: "Nivel",
      stageComingSoon: "Próximamente",
      stageComingSoonNotice: (label: string) => `${label}: todavía no está disponible. Muy pronto.`,
      gradeLabel: "Elegí tu año o ciclo",
      continue: "Continuar",
      footnote: "Podés cambiar esto después desde tu perfil.",
      errors: {
        gradeRequired: "Elegí un nivel para continuar.",
        submitFailed: "No pudimos crear tu curso. Intentá de nuevo.",
      },
    },
    paso2: {
      title: "Elegí tus materias",
      gradeCaption: (label: string) => `Nivel: ${label}`,
      counter: (n: number) => (n === 1 ? "1 materia seleccionada" : `${n} materias seleccionadas`),
      // C2-c: reemplaza templatesLabel/templatesHint/noTemplatesNotice — las
      // opciones ahora salen del catálogo semilla (getSeedSubjects), no de
      // SubjectTemplate (bachillerato-only, dejaba universidad vacío).
      existingLabel: "Tus materias",
      suggestedLabel: "Materias sugeridas",
      suggestedHint: "Desmarcá las que no apliquen. Ya vienen con su temario listo.",
      noSuggestionsNotice: "No pudimos cargar las materias sugeridas. Podés crear las tuyas manualmente.",
      addCustomToggle: "Crear mi propia materia",
      addCustomLabel: "Materia personalizada",
      addCustomPlaceholder: "Ej.: Robótica",
      addCustomButton: "Agregar",
      continue: "Continuar",
      footnote: "Podés agregar o quitar materias después.",
      errors: {
        noneSelected: "Elegí al menos una materia para continuar.",
        submitFailed: "No pudimos guardar tus materias. Intentá de nuevo.",
      },
    },
    // C2-c: paso 3 dejó de configurar temario por materia (las semilla ya
    // vienen con el suyo armado) — ahora es un resumen honesto + sella el
    // onboarding (D-C07). moveUpA11y/deleteTopicA11y/addTopicPlaceholder/
    // addTopicButton y errors.addTopicFailed/deleteTopicFailed/reorderFailed
    // siguen acá porque son COMPARTIDAS con `TemarioTopicEditor` y
    // `app/subjects/[subjectId]/temario.tsx` — no tocar sin revisar esos
    // consumidores.
    paso3: {
      title: "Tu plan de estudio está listo",
      summary: (subjectCount: number, topicCount: number) => {
        const subjects = subjectCount === 1 ? "1 materia" : `${subjectCount} materias`;
        const topics = topicCount === 1 ? "1 tema listo" : `${topicCount} temas listos`;
        return `${subjects} · ${topics}`;
      },
      subtitle: "Podés agregar más materias o temarios cuando quieras, desde tu inicio.",
      finish: "Empezar a estudiar",
      finishCaption: "Vas a tu inicio — desde ahí entrás a cada materia.",
      moveUpA11y: "Mover tema arriba",
      moveDownA11y: "Mover tema abajo",
      deleteTopicA11y: "Eliminar tema",
      addTopicPlaceholder: "Nombre del tema",
      addTopicButton: "Agregar tema",
      errors: {
        addTopicFailed: "No pudimos agregar el tema.",
        deleteTopicFailed: "No pudimos eliminar el tema.",
        reorderFailed: "No pudimos reordenar los temas.",
        completeFailed: "No pudimos terminar la configuración. Intentá de nuevo.",
      },
    },
  },

  // D2 — sesión guiada (default al abrir tema). Conversación libre sigue en
  // `tema.*` + `study.*`; esta sección cubre la receta D-S02..S07.
  guided: {
    sessionTitle: "Sesión guiada",
    freeChatLink: "Conversación libre",
    freeChatA11y: "Abrir conversación libre con Sócrates",
    loading: "Preparando tu sesión…",
    loadError: "No pudimos cargar la sesión guiada.",
    generalContent: "Contenido general",
    continue: "Continuar",
    confirm: "Confirmar",
    submitExplain: "Enviar",
    explainPrompt: (topicTitle: string) => `Explicá con tus palabras la idea central de «${topicTitle}»`,
    explainPlaceholder: "Contalo como si se lo explicaras a un compañero…",
    explainHint: "Usá lo que acabás de leer. No hace falta recitar: Sócrates quiere ver si lo entendiste.",
    explainIdeasLabel: "Ideas que acabás de ver",
    degradedNote: "Hoy practicamos con una sesión más corta — igual podés demostrar lo que aprendiste.",
    exposureTitle: "Sócrates expone",
    checkLabel: "Comprobación",
    challengeLabel: "Reto",
    closureTitle: "Sesión completa",
    closureXp: (n: number) => (n === 1 ? "+1 XP" : `+${n} XP`),
    closureHits: (correct: number, total: number) => `${correct} de ${total} aciertos`,
    closureSessionBonus: "+25 XP por completar la sesión",
    continueChat: "Seguir conversando",
    nextTopic: "Siguiente tema",
    xpEarned: (n: number) => `+${n} XP`,
    retryOnce: "Intentar de nuevo",
    degradedExposure: [
      "Empecemos con lo esencial: cada tema tiene ideas clave que conviene fijar antes de profundizar.",
      "En esta sesión vas a leer, responder y explicar con tus palabras — así Sócrates puede guiarte mejor.",
    ],
    successMicrocopy: [
      "Bien — seguís en camino.",
      "Correcto. Eso encaja.",
      "Exacto. Buen ojo.",
      "Sí — esa es la idea.",
      "Acertaste. Seguimos.",
      "Bien visto.",
      "Correcto. Vas afilando el concepto.",
      "Eso es. Buen trabajo.",
      "Claro — lo tenés.",
      "Perfecto en este paso.",
      "Bien pensado.",
      "Correcto. Sumás confianza con la idea.",
    ],
    softFailMicrocopy: [
      "Todavía no. Mirá esto:",
      "Casi — repasemos la idea:",
      "No es esa. Acá va la pista:",
      "Todavía no encaja. Fijate en esto:",
      "Interesante, pero no es la respuesta. Mirá:",
      "Repasemos juntos:",
      "Todavía falta afinar. Esto ayuda:",
      "No del todo — acá va la explicación:",
      "Todavía no. Prestá atención a esto:",
      "Casi lo tenés. Mirá esto:",
      "Todavía no es esa. Repasemos:",
      "No es correcto todavía. Acá va la clave:",
    ],
  },

  // P5 — sesión por tema (`app/subjects/[subjectId]/temas/[topicId].tsx`,
  // mapea `assets/tema-tutor-socratico.html`). Extiende `study.*` con lo que
  // esa pantalla agrega: header materia·tema y chips de pista.
  tema: {
    loadError: "No pudimos cargar esta sesión de estudio.",
    masteryLabel: "Dominio",
    hintChip: "Pedir pista",
    hintChipMessage: "No entiendo, ¿me das una pista?",
    exampleChip: "Otro ejemplo",
    exampleChipMessage: "¿Podés darme otro ejemplo?",
    attachA11yLabel: "Agregar una fuente de estudio",
  },

  // P5 (DF-P10/DF-P11) — modal de Fuentes, mapea el modal de
  // `assets/tema-tutor-socratico.html`. Fuentes = texto, nunca archivos.
  fuentes: {
    title: "Fuentes de estudio",
    subtitle: (n: number) => (n === 1 ? "1 fuente · Material que Socrates usa para explicarte este tema" : `${n} fuentes · Material que Socrates usa para explicarte este tema`),
    subtitleEmpty: "Todavía no hay fuentes — agregá la primera",
    buttonLabel: "Fuentes",
    buttonA11yLabel: (n: number) => `Ver fuentes de estudio, ${n}`,
    buttonA11yLabelBusy: (status: string) => `Fuentes de estudio, procesando: ${status}`,
    buttonA11yLabelError: (msg: string) => `Fuentes de estudio, error: ${msg}`,
    addButton: "Agregar fuente",
    addButtonA11yLabel: "Subir un PDF como fuente de estudio",
    close: "Cerrar",
    closeA11yLabel: "Cerrar el modal de fuentes",
    processed: "✓ procesado",
    processing: "Procesando…",
    /**
     * Client killed mid-ingest: material already on the server, attaching
     * the Fuente the student never saw. Socrates voice — adult, SV Spanish.
     */
    recovering: (fileName: string) => `Recuperando «${fileName}»…`,
    deleteA11yLabel: (name: string) => `Eliminar fuente ${name}`,
    empty: "Esta materia todavía no tiene fuentes. Subí un PDF para que Socrates lo use.",
    privacyNote: "Las fuentes son privadas de esta materia. Podés agregarlas o eliminarlas, pero no descargarlas — el archivo original no se guarda, solo el texto.",
    loadError: "No pudimos cargar las fuentes de esta materia.",
    errors: {
      network: "No se pudo subir la fuente. Revisá tu conexión.",
      quota: "Alcanzaste el límite de subidas por ahora — probá de nuevo más tarde.",
      quotaDaily: "Alcanzaste el límite diario de páginas de material. Se renueva mañana.",
      quotaMonthly: "Alcanzaste el límite mensual de páginas de material. Se renueva el próximo mes.",
      quotaCost: "Alcanzaste el tope de uso por ahora. Probá de nuevo más tarde.",
      safety: "No pudimos procesar ese archivo.",
      invalid_pdf: "Ese archivo no parece ser un PDF válido.",
      too_many_pages: (_max: number) =>
        "Este PDF es muy largo y no le encontramos un índice que podamos usar. Elegí un archivo más corto o partilo.",
      raster_too_large: "Una página del PDF es demasiado grande para procesarla. Probá con otro archivo.",
      timeout: "Tardó demasiado en leerse el archivo. Probá de nuevo o con un PDF más chico.",
      /**
       * Reconcile of a `status: "failed"` row. The server does not send a
       * motivo on GET /v1/materials — only the terminal status — so this
       * is as specific as we can be without inventing a cause.
       */
      digestFailed: "El servidor no pudo procesar esa fuente.",
      unknown: "Algo salió mal subiendo la fuente.",
      deleteFailed: "No pudimos eliminar la fuente. Intentá de nuevo.",
    },
  },

  // P5 (DF-P05) — ronda de repaso de un hito
  // (`app/subjects/[subjectId]/milestones/[milestoneId].tsx`). NO gatea:
  // el estudiante puede seguir estudiando sin importar cómo le vaya acá.
  hito: {
    parcial: "Parcial",
    examen_final: "Examen final",
    notGatingBanner: "Este repaso no bloquea nada — podés seguir estudiando cuando quieras, sin importar cómo te vaya.",
    emptyState: "Cuando estés listo, escribí cualquier mensaje (por ejemplo \"listo\") para que Socrates empiece el repaso.",
    loadError: "No pudimos cargar este repaso.",
  },

  materialIngest: {
    uploadButton: "Subir guía",
    uploadButtonA11yLabel: "Subir un PDF de guía a esta sesión",
    picking: "Abrí el selector de archivos…",
    preparing: "Preparando tu archivo…",
    parsing: "Leyendo página {page} de {total}…",
    uploading: "Subiendo…",
    uploadingProgress: (percent: number) => `Subiendo… ${percent}%`,
    processing: (fileName: string) => `Tu archivo «${fileName}» se está procesando`,
    attaching: "Agregando a la sesión…",
    done: "Guía lista — el tutor ya puede usarla.",
    dismiss: "Cerrar",
    retry: "Reintentar",
    cancel: "Cancelar",
    /** Shown once bytes are on the server — aborting no longer stops the paid work. */
    stopWaiting: "Dejar de esperar",
    stopWaitingHint:
      "El procesamiento ya empezó en el servidor y no se detiene. Si cerrás esto, igual agregamos la fuente cuando termine.",
    errors: {
      network: "No se pudo subir la guía. Revisá tu conexión.",
      quota: "Alcanzaste el límite de subidas por ahora — probá de nuevo más tarde.",
      quotaDaily: "Alcanzaste el límite diario de páginas de material. Se renueva mañana.",
      quotaMonthly: "Alcanzaste el límite mensual de páginas de material. Se renueva el próximo mes.",
      quotaCost: "Alcanzaste el tope de uso por ahora. Probá de nuevo más tarde.",
      safety: "No pudimos procesar esa guía.",
      invalid_pdf: "Ese archivo no parece ser un PDF válido.",
      too_many_pages: (_max: number) =>
        "Este PDF es muy largo y no le encontramos un índice que podamos usar. Elegí un archivo más corto o partilo.",
      raster_too_large: "Una página del PDF es demasiado grande para procesarla. Probá con otro archivo.",
      timeout: "Tardó demasiado en leerse el archivo. Probá de nuevo o con un PDF más chico.",
      unknown: "Algo salió mal subiendo la guía.",
    },
  },

  // C2-b — pantalla Perfil (`app/perfil.tsx`). Reemplaza al home como
  // superficie de "Eliminar mi cuenta"/logout/idioma — home es para
  // estudiar. `deleteAccount*` es la migración byte-idéntica de lo que
  // antes vivía bajo `courses.*` (mismo copy, nueva ubicación).
  profile: {
    title: "Perfil",
    loadError: "No pudimos cargar tu perfil.",
    academicLevelTitle: "Nivel académico",
    academicLevelRedo: "Rehacer configuración inicial",
    academicLevelRedoA11y: "Rehacer la configuración inicial de nivel y materias",
    attributionsRow: "Atribuciones",
    attributionsRowSubtitle: "De dónde vienen los temarios sugeridos",
    logout: "Cerrar sesión",
    logoutA11y: "Cerrar sesión",
    deleteAccount: "Eliminar mi cuenta",
    deleteAccountA11y: "Eliminar mi cuenta",
    deleteAccountConfirmTitle: "¿Eliminar tu cuenta?",
    deleteAccountConfirmBody:
      "Se eliminan tu cuenta, tu progreso y tus fuentes. El registro de consentimiento se conserva de forma seudonimizada: ya no se asocia con vos. Esta acción no se puede deshacer.",
    deleteAccountConfirmAction: "Eliminar mi cuenta",
    deleteAccountWorking: "Eliminando tu cuenta…",
    deleteAccountFailed: "No pudimos eliminar tu cuenta. Seguís logueado — intentá de nuevo.",
    deleteAccountFailedNetwork: "No pudimos conectar. Tu cuenta sigue activa.",
    deleteAccountDoneTitle: "Tu cuenta fue eliminada",
    deleteAccountDoneBody: "Ya no hay una sesión activa en este dispositivo. Si querés volver, tenés que crear una cuenta nueva.",
    deleteAccountDoneAction: "Entendido",
  },

  // C2-b — pantalla Atribuciones (`app/atribuciones.tsx`), navegada desde
  // Perfil. Lista los 10 libros semilla que `apiClient.getSeedAttributions()`
  // devuelve — nunca texto escrito a mano por libro.
  attributions: {
    title: "Atribuciones",
    intro:
      "Los temarios sugeridos se basan en libros de texto abiertos, publicados con licencia Creative Commons (CC BY). Gracias a sus autores y editores.",
    loadError: "No pudimos cargar las atribuciones.",
    licenseLabel: (name: string) => `Licencia: ${name}`,
    openSource: "Ver fuente",
    openLinkFailed: "No pudimos abrir el enlace.",
  },

  // A1 — selector de idioma (vive en Perfil desde C2-b). Tres opciones:
  // automático (detecta el dispositivo), español forzado, inglés forzado.
  settings: {
    languageTitle: "Idioma",
    languageAuto: "Automático (dispositivo)",
    languageEs: "Español",
    languageEn: "English",
    languageSectionA11y: "Idioma de la aplicación",
  },

  // A2 — labels del catálogo semilla de El Salvador
  // (packages/domain/data/el-salvador.ts), por CLAVE/ID estable del dato
  // (NUNCA por texto español): los stages por sufijo de `stage.id`, los
  // GradeLevels por prefijo+ordinal de `gradeLevel.id`, las materias por
  // `nameKey`. `lib/catalogLabels.ts` resuelve id → label con fallback al
  // `defaultLabel`/`defaultName` del dato para ids que el catálogo no
  // conozca (robustez ante datos futuros del server). Los valores es son
  // byte-idénticos a los defaults del dato — este es el locale fundacional.
  catalog: {
    stages: {
      basica: "Educación básica",
      bachillerato: "Bachillerato",
      universidad: "Universidad",
    },
    gradeLevels: {
      basica: (grade: number) => `${grade}º grado`,
      bachillerato: (year: number) => `${year}° año de bachillerato`,
      universidad: (cycle: number) => `Ciclo ${cycle}`,
    },
    subjects: {
      matematica: "Matemática",
      fisica: "Física",
      quimica: "Química",
      lenguajeYLiteratura: "Lenguaje y Literatura",
      historiaDeElSalvador: "Historia de El Salvador",
      ingles: "Inglés",
    },
  },
};

export type Strings = typeof es;

/** Alias corto para componentes: `import { t } from "../i18n/es"`. */
export const t = es;
