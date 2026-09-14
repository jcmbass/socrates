/**
 * UI strings — English (en). A2: real product English, NOT a literal
 * translation of es.ts. Tone follows DESIGN.md §1/§7 — professional,
 * direct, no hype, no superlatives; Salvadoran voseo has no English
 * equivalent, so the voice is neutral-direct "you".
 *
 * The `Strings` type (from es.ts) guarantees key parity at compile time —
 * every key es.ts has, this file must have, with the same function
 * signatures. The runtime deep-parity walk lives in i18n/__tests__/i18n.test.ts.
 *
 * Product glossary (es → en, used consistently across this catalog):
 * - "materia" → "subject"; "curso" → "course"
 * - "temario" → "syllabus" (the subject's topic tree)
 * - "tema" (topic) → "topic"; "Fuentes" → "Sources" (study sources feature)
 * - "guía" (uploaded PDF) → "guide"; "racha" → "streak"
 * - "repaso"/"hito" → "review"/"milestone"; "Parcial"/"Examen final" →
 *   "Midterm"/"Final exam"
 * - "Dominio" (mastery) → "Mastery"
 */
import type { Strings } from "./es";


export const en: Strings = {
  common: {
    appName: "Socrates",
    back: "Back",
    cancel: "Cancel",
    continue: "Continue",
    loading: "Loading…",
    retry: "Try again",
    genericError: "Something went wrong. Try again.",
  },

  login: {
    title: "Socrates",
    tagline: "It doesn't give you the answer. It guides you until you find it.",
    // Form headings: without them the screen was just a back arrow and a
    // loose field, with nothing saying what you're doing (2026-08-06).
    formTitleSignup: "Create account",
    formTitleLogin: "Sign in",
    emailLabel: "Email",
    emailPlaceholder: "you@email.com",
    nameLabel: "What should we call you?",
    namePlaceholder: "Your name",
    ageCheckbox: "I confirm I'm 13 or older",
    termsCheckbox: "I accept the terms and the privacy policy",
    // The Spanish said "(DRAFT versions — pending the founder's legal
    // review)" — honest but inward-facing copy. Same decision as es: what
    // changes is who gets told, not the fact that validation is pending.
    termsNote: "By creating your account you accept our terms of service and privacy policy. You can read them here:",
    /** Links to the published documents (`lib/legalUrls.ts` → server). */
    termsLink: "Terms of Service",
    privacyLink: "Privacy Policy",
    legalLinkFailed: "We couldn't open the document. It's in your browser: ",
    submit: "Create account",
    submitLogin: "Send sign-in link",
    // DESIGN.md §7 bans "mágico" — same reasoning as es: "sign-in link"
    // says the same thing in the brand's neutral-direct tone.
    stubNote: "We'll email you a sign-in link — no passwords.",
    // Welcome view: mode is chosen by a button, not a toggle inside the
    // form (redesign 2026-08-06 — see app/login.tsx).
    hasAccount: "I already have an account",
    errors: {
      emailInvalid: "Enter a valid email address.",
      nameRequired: "Enter your name.",
      ageRequired: "You need to confirm you're 13 or older.",
      termsRequired: "You need to accept the terms to continue.",
      network: "We couldn't reach the server. Is apps/server running?",
      conflict: "An account with this email already exists — try signing in.",
      generic: "We couldn't complete the request. Try again.",
    },
    verify: {
      title: "Check your email",
      instructions: "Tap the link we sent to your email to sign in.",
      verifying: "Verifying your link…",
      /** __DEV__-only: the emailed link doesn't leave the machine in dev builds (ConsoleEmailSender), so the field below lets you paste the token straight from the apps/server console. */
      devPasteInstructions:
        "Development mode: the email doesn't actually send — check the console where apps/server is running and paste the token printed there.",
      devTokenLabel: "Link token (development only)",
      devTokenPlaceholder: "Paste the token here",
      submit: "Verify and sign in",
      back: "Back",
      errors: {
        tokenRequired: "Paste the token from the link.",
        invalid: "The link is invalid or has expired. Request a new one.",
      },
    },
  },

  courses: {
    title: "Your courses",
    greeting: (name: string) => `Hi, ${name}`,
    empty: "You don't have any courses yet. Create the first one to start studying.",
    newCourse: "New course",
    subjectCount: (n: number) => (n === 1 ? "1 subject" : `${n} subjects`),
    lastActivity: (date: string) => `Last activity: ${date}`,
    noActivity: "No activity yet",
    loadError: "We couldn't load your courses.",
    streak: {
      // C2-e: short copy on purpose — `StreakDisplay` truncates it with
      // numberOfLines={1} inside StatsStrip, so the long text was cut
      // mid-sentence. Length guard in lib/__tests__/i18nLength.test.ts.
      none: "No streak yet",
      active: (n: number) => `${n} explanations in a row`,
      broken: "Keep practicing to rebuild your streak",
      reason: (reason: string) => `— ${reason}`,
      /**
       * A1 — reason copy moved OUT of lib/streak.ts into the catalog so the
       * streak surface follows the active locale. Keyed by the server's
       * opaque reason keys, lowercased-camelCase here.
       */
      reasons: {
        explainedAcrossSessions: "consistent explanations",
        sustainedOverTime: "steady over time",
      },
    },
  },

  newCourse: {
    title: "New course",
    stageLabel: "What are you studying?",
    stageComingSoon: "coming soon",
    gradeLabel: "Choose your level",
    customLabelPrompt: "Want to name your course?",
    customLabelPlaceholder: "e.g. Health sciences high school",
    templatesLabel: "Suggested subjects",
    templatesHint: "Uncheck the ones that don't apply. You can add more later.",
    create: "Create course",
    errors: {
      gradeRequired: "Choose a level to continue.",
      submitFailed: "We couldn't create the course. Try again.",
    },
  },

  courseDetail: {
    subjectsEmpty: "This course doesn't have any subjects yet.",
    addSubject: "Add subject",
    lastSession: (date: string) => `Last session: ${date}`,
    noSessions: "No sessions yet",
    loadError: "We couldn't load this course's subjects.",
  },

  newSubject: {
    title: "New subject",
    nameLabel: "Subject name",
    namePlaceholder: "e.g. Mathematics",
    create: "Create subject",
    errors: {
      nameRequired: "Enter the subject's name.",
      submitFailed: "We couldn't create the subject. Try again.",
    },
  },

  // C2-e — subject notes on the home card (components/SubjectCard.tsx).
  subject: {
    // Discreet note (muted caption): the temario is in the student's
    // language, but the seed book behind it is in English — the server says
    // so with `seedMaterialLang` (fallback to the only EN source, e.g.
    // bachillerato/fisica).
    materialInEnglish: "Material in English",
  },

  coldStart: {
    title: "Waking Socrates up…",
    subtitle: "The server is starting. It can take a couple of minutes the first time.",
    retrying: "Retrying…",
  },

  // P4 — home (subject cards + total XP). Replaces the content of
  // app/courses/index.tsx (keeps the "/courses" route, redesigned as home).
  home: {
    title: "Home",
    heading: "What do you want to study today?",
    empty: "You don't have any subjects yet. Add the first one to start studying.",
    addSubject: "Add subject",
    loadError: "We couldn't load your subjects.",
    profileButtonA11y: "Open your profile",
    status: {
      empty: "No syllabus yet",
      configured: (count: number, currentTopic: string | null) =>
        currentTopic ? `${count} topics · on ${currentTopic}` : `${count} topics`,
    },
    xp: {
      label: "XP",
      hidden: "Progress isn't visible yet — it turns on later in the beta.",
    },
    /** D2 — hero card ("Continue where you left off"). */
    hero: {
      eyebrow: "Pick up where you left off",
      progressLabel: (doneCount: number, total: number) => `${doneCount}/${total} topics`,
      starsLabel: (stars: number, max: number) => `${stars} of ${max} stars`,
    },
  },

  // P4 — the syllabus tree ("estudios"). DF-P02: free navigation, no locks —
  // every topic is tappable, the recommended one shines.
  skillTree: {
    title: "Syllabus",
    loadError: "We couldn't load this subject's syllabus.",
    recommendedBadge: "Recommended",
    starsA11y: (stars: number) => `${stars} of 3 stars`,
    milestone: {
      parcial: "Midterm",
      examen_final: "Final exam",
    },
    /** W3 header (`assets/estudios.html`'s `.eyebrow`/`.progress-label`) — in-page, replaces the native Stack title. */
    topicLabel: (order1based: number) => `TOPIC ${order1based}`,
    completedLabel: "Completed",
    progressLabel: (doneCount: number, total: number, percent: number) => `Topic ${doneCount} / ${total} · ${percent}%`,
    routeLabel: "YOUR LEARNING PATH",
    /** No lock language (DF-P02) — topics "appear", they are never "unlocked". */
    routeHint: "Advanced topics appear at the top",
    routeHintDown: "Advanced topics appear below",
    startCap: "START OF THE SYLLABUS",
    continueCta: (topicTitle: string) => `Continue: ${topicTitle}`,
    editTemario: "Edit syllabus",
    doneEditing: "View tree",
    /** C2-d — header of each collapsible unit section (seed subjects with `unitLabel`). */
    unitProgressLabel: (doneCount: number, total: number) => `${doneCount}/${total}`,
    unitToggleA11y: (unitTitle: string, doneCount: number, total: number) =>
      `${unitTitle}, ${doneCount} of ${total} completed`,
    /** C2-d — CC BY attribution line at the foot of a seed subject's syllabus. */
    attribution: (title: string, publisher: string, licenseName: string) =>
      `Syllabus based on ${title}, ${publisher}, ${licenseName}`,
    /** C2-d — title for the collapsible section holding topics with NO unit, inside an otherwise-grouped syllabus (mixed data, rare). */
    noUnitLabel: "Other topics",
    /** Setup for missing OR empty orphan temario (beta-real 06 — same student-facing state). */
    emptyState: {
      title: "This subject doesn't have a syllabus yet.",
      subtitle: "Upload the course program or build it by hand to start your learning path.",
      uploadPdf: "Upload PDF",
      manual: "Manual",
      manualFailed: "We couldn't build the syllabus. Try again.",
      readingProgress: "Reading your course program…",
      buildingProgress: "Building your syllabus…",
      retryGenerate: "Retry generation",
      errors: {
        invalid_pdf: "That file couldn't be read. Try another PDF.",
        quota: "You reached today's page limit. Try tomorrow or use Manual.",
        quotaDaily: "You reached the daily limit of material pages. It resets tomorrow. You can use Manual.",
        quotaMonthly: "You reached the monthly limit of material pages. It resets next month. You can use Manual.",
        quotaCost: "You reached the usage cap for now. Try later or use Manual.",
        network: "The connection dropped. You can retry once it's back.",
        generate_failed:
          "Your course program is saved, but we couldn't build the syllabus. Retry the generation without uploading the PDF again, or use Manual.",
        unknown: "Something went wrong. You can retry or build the syllabus by hand.",
        safety: "We couldn't process that file. Try another one or use Manual.",
        too_many_pages: (_max: number) =>
          "This PDF is too long and we couldn't find an index we can use. Split it or use Manual.",
        raster_too_large: "A page of this PDF is too large to process. Try another file or use Manual.",
        timeout: "The file took too long to read. Try again or use Manual.",
      },
    },
  },

  study: {
    inputPlaceholder: "Write your answer…",
    send: "Send",
    sendA11yLabel: "Send message",
    thinkingA11yLabel: "The tutor is thinking",
    emptyState: "Tell the tutor what you're studying today and where you want to start.",
    sessionLoadError: "We couldn't load this study session.",
    quotaExceeded: "You reached the message limit for now — try again later.",
    /**
     * Only when there was truly no HTTP response (`network_error`). It used
     * to show for ANY server error and blame the student's connection for
     * tutor-provider outages.
     */
    turnFailedNetwork: "Your message couldn't be sent. Check your connection.",
    turnFailedTutor: "Socrates is unavailable right now. It's not your connection — try again in a bit.",
    turnFailedServer: "Something failed on our side while replying. Your message is still here: you can retry.",
    turnFailedSessionClosed: "This study session is closed. Go back to the topic to start a new one.",
    /**
     * A `duplicate_turn` that survived reconciliation: the turn is IN
     * FLIGHT. Resending is exactly the wrong move, so the copy asks the
     * student to wait instead of inviting a retry (beta-real 10).
     */
    turnAlreadyInFlight: "Your message is already being sent. Wait a moment — don't send it again or it will duplicate.",
    retrySend: "Retry send",
    /** Honest activity signals (A §5.2, F3 shadow) — not achievements, not derived from the assessor. */
    activitySessions: (n: number) => (n === 1 ? "1 session today" : `${n} sessions today`),
    activityExchanges: (n: number) => `${n} exchanges in total`,
    /** Inline transcript marker (F2 WQ3 part C2) for a MaterialEvent with action:"added" — `{source}` is replaced with the event's display name. */
    materialAddedMarker: "Source added: {source}",
    /** Same marker for action:"removed" — no current flow produces this (server has no material-removal route yet), kept for shape completeness. */
    materialRemovedMarker: "Source removed: {source}",
  },

  onboard: {
    stepLabel: (step: number) => `Step ${step} of 3`,
    paso1: {
      title: "What level are you at?",
      subtitle: "Choose high school or university to build your study plan.",
      stageLabel: "Level",
      stageComingSoon: "Coming soon",
      stageComingSoonNotice: (label: string) => `${label}: not available yet. Very soon.`,
      gradeLabel: "Choose your year",
      continue: "Continue",
      footnote: "You can change this later from your profile.",
      errors: {
        gradeRequired: "Choose a level to continue.",
        submitFailed: "We couldn't create your course. Try again.",
      },
    },
    paso2: {
      title: "Choose your subjects",
      gradeCaption: (label: string) => `Level: ${label}`,
      counter: (n: number) => (n === 1 ? "1 subject selected" : `${n} subjects selected`),
      existingLabel: "Your subjects",
      suggestedLabel: "Suggested subjects",
      suggestedHint: "Uncheck the ones that don't apply. They come with their syllabus already built.",
      noSuggestionsNotice: "We couldn't load the suggested subjects. You can create your own manually.",
      addCustomToggle: "Create my own subject",
      addCustomLabel: "Custom subject",
      addCustomPlaceholder: "e.g. Robotics",
      addCustomButton: "Add",
      continue: "Continue",
      footnote: "You can add or remove subjects later.",
      errors: {
        noneSelected: "Choose at least one subject to continue.",
        submitFailed: "We couldn't save your subjects. Try again.",
      },
    },
    paso3: {
      title: "Your study plan is ready",
      summary: (subjectCount: number, topicCount: number) => {
        const subjects = subjectCount === 1 ? "1 subject" : `${subjectCount} subjects`;
        const topics = topicCount === 1 ? "1 topic ready" : `${topicCount} topics ready`;
        return `${subjects} · ${topics}`;
      },
      subtitle: "You can add more subjects or syllabi anytime, from your home screen.",
      finish: "Start studying",
      finishCaption: "You're heading home — from there you can open any subject.",
      moveUpA11y: "Move topic up",
      moveDownA11y: "Move topic down",
      deleteTopicA11y: "Delete topic",
      addTopicPlaceholder: "Topic name",
      addTopicButton: "Add topic",
      errors: {
        addTopicFailed: "We couldn't add the topic.",
        deleteTopicFailed: "We couldn't delete the topic.",
        reorderFailed: "We couldn't reorder the topics.",
        completeFailed: "We couldn't finish setting up. Try again.",
      },
    },
  },

  // D2 — guided session (default when opening a topic). Free chat still uses
  // `tema.*` + `study.*`; this section covers recipe D-S02..S07.
  guided: {
    sessionTitle: "Guided session",
    freeChatLink: "Free conversation",
    freeChatA11y: "Open free conversation with Socrates",
    loading: "Getting your session ready…",
    loadError: "We couldn't load the guided session.",
    generalContent: "General content",
    continue: "Continue",
    confirm: "Confirm",
    submitExplain: "Send",
    explainPrompt: (topicTitle: string) => `Explain the core idea of “${topicTitle}” in your own words`,
    explainPlaceholder: "Tell it as if you were explaining it to a classmate…",
    explainHint: "Use what you just read. Socrates wants to see that you understood it — not that you memorized it.",
    explainIdeasLabel: "Ideas you just saw",
    degradedNote: "Today we're running a shorter session — you can still show what you learned.",
    exposureTitle: "Socrates explains",
    checkLabel: "Quick check",
    challengeLabel: "Challenge",
    closureTitle: "Session complete",
    closureXp: (n: number) => (n === 1 ? "+1 XP" : `+${n} XP`),
    closureHits: (correct: number, total: number) => `${correct} of ${total} correct`,
    closureSessionBonus: "+25 XP for completing the session",
    continueChat: "Keep chatting",
    nextTopic: "Next topic",
    xpEarned: (n: number) => `+${n} XP`,
    retryOnce: "Try again",
    degradedExposure: [
      "Let's start with the essentials: every topic has key ideas worth locking in before going deeper.",
      "In this session you'll read, answer, and explain in your own words — so Socrates can guide you better.",
    ],
    successMicrocopy: [
      "Nice — you're on track.",
      "Correct. That fits.",
      "Exactly. Good eye.",
      "Yes — that's the idea.",
      "You got it. Moving on.",
      "Well spotted.",
      "Correct. You're sharpening the concept.",
      "That's it. Good work.",
      "Clear — you've got it.",
      "Perfect on this step.",
      "Well thought out.",
      "Correct. You're building confidence with the idea.",
    ],
    softFailMicrocopy: [
      "Not yet. Look at this:",
      "Almost — let's revisit the idea:",
      "That's not it. Here's a hint:",
      "Doesn't quite fit yet. Check this:",
      "Interesting, but not the answer. See:",
      "Let's review together:",
      "Still needs tuning. This helps:",
      "Not quite — here's the explanation:",
      "Not yet. Pay attention to this:",
      "You almost had it. Look at this:",
      "Not that one yet. Let's review:",
      "Not correct yet. Here's the key:",
    ],
  },

  // P5 — per-topic session (`app/subjects/[subjectId]/temas/[topicId].tsx`).
  // Extends `study.*` with what that screen adds: subject·topic header and
  // hint chips.
  tema: {
    loadError: "We couldn't load this study session.",
    masteryLabel: "Mastery",
    hintChip: "Ask for a hint",
    hintChipMessage: "I don't understand — can you give me a hint?",
    exampleChip: "Another example",
    exampleChipMessage: "Can you give me another example?",
    attachA11yLabel: "Add a study source",
  },

  // P5 (DF-P10/DF-P11) — Sources modal. Sources are text, never files.
  fuentes: {
    title: "Sources",
    subtitle: (n: number) => (n === 1 ? "1 source · Material Socrates uses to explain this topic to you" : `${n} sources · Material Socrates uses to explain this topic to you`),
    subtitleEmpty: "No sources yet — add the first one",
    buttonLabel: "Sources",
    buttonA11yLabel: (n: number) => `View study sources, ${n}`,
    buttonA11yLabelBusy: (status: string) => `Study sources, processing: ${status}`,
    buttonA11yLabelError: (msg: string) => `Study sources, error: ${msg}`,
    addButton: "Add source",
    addButtonA11yLabel: "Upload a PDF as a study source",
    close: "Close",
    closeA11yLabel: "Close the sources modal",
    processed: "✓ processed",
    processing: "Processing…",
    /**
     * Client killed mid-ingest: material already on the server, attaching
     * the source the student never saw. Socrates voice — adult, direct.
     */
    recovering: (fileName: string) => `Recovering "${fileName}"…`,
    deleteA11yLabel: (name: string) => `Delete source ${name}`,
    empty: "This subject doesn't have any sources yet. Upload a PDF so Socrates can use it.",
    privacyNote: "Sources are private to this subject. You can add or delete them, but not download them — the original file isn't kept, only the text.",
    loadError: "We couldn't load this subject's sources.",
    errors: {
      network: "The source couldn't be uploaded. Check your connection.",
      quota: "You reached the upload limit for now — try again later.",
      quotaDaily: "You reached the daily limit of material pages. It resets tomorrow.",
      quotaMonthly: "You reached the monthly limit of material pages. It resets next month.",
      quotaCost: "You reached the usage cap for now. Try again later.",
      safety: "We couldn't process that file.",
      invalid_pdf: "That file doesn't look like a valid PDF.",
      too_many_pages: (_max: number) =>
        "This PDF is too long and we couldn't find an index we can use. Choose a shorter file or split it.",
      raster_too_large: "A page of this PDF is too large to process. Try another file.",
      timeout: "The file took too long to read. Try again or with a smaller PDF.",
      /**
       * Reconcile of a `status: "failed"` row. The server does not send a
       * reason on GET /v1/materials — only the terminal status — so this
       * is as specific as we can be without inventing a cause.
       */
      digestFailed: "The server couldn't process that source.",
      unknown: "Something went wrong uploading the source.",
      deleteFailed: "We couldn't delete the source. Try again.",
    },
  },

  // P5 (DF-P05) — milestone review round
  // (`app/subjects/[subjectId]/milestones/[milestoneId].tsx`). Does NOT
  // gate: the student can keep studying no matter how it goes.
  hito: {
    parcial: "Midterm",
    examen_final: "Final exam",
    notGatingBanner: "This review doesn't block anything — you can keep studying whenever you want, no matter how it goes.",
    emptyState: "When you're ready, send any message (for example \"ready\") and Socrates will start the review.",
    loadError: "We couldn't load this review.",
  },

  materialIngest: {
    uploadButton: "Upload guide",
    uploadButtonA11yLabel: "Upload a PDF guide to this session",
    picking: "Opened the file picker…",
    preparing: "Preparing your file…",
    parsing: "Reading page {page} of {total}…",
    uploading: "Uploading…",
    uploadingProgress: (percent: number) => `Uploading… ${percent}%`,
    processing: (fileName: string) => `Your file "${fileName}" is being processed`,
    attaching: "Adding to the session…",
    done: "Guide ready — the tutor can use it now.",
    dismiss: "Close",
    retry: "Retry",
    cancel: "Cancel",
    /** Shown once bytes are on the server — aborting no longer stops the paid work. */
    stopWaiting: "Stop waiting",
    stopWaitingHint:
      "Processing already started on the server and doesn't stop. If you close this, we'll still add the source when it finishes.",
    errors: {
      network: "The guide couldn't be uploaded. Check your connection.",
      quota: "You reached the upload limit for now — try again later.",
      quotaDaily: "You reached the daily limit of material pages. It resets tomorrow.",
      quotaMonthly: "You reached the monthly limit of material pages. It resets next month.",
      quotaCost: "You reached the usage cap for now. Try again later.",
      safety: "We couldn't process that guide.",
      invalid_pdf: "That file doesn't look like a valid PDF.",
      too_many_pages: (_max: number) =>
        "This PDF is too long and we couldn't find an index we can use. Choose a shorter file or split it.",
      raster_too_large: "A page of this PDF is too large to process. Try another file.",
      timeout: "The file took too long to read. Try again or with a smaller PDF.",
      unknown: "Something went wrong uploading the guide.",
    },
  },

  // C2-b — Profile screen (`app/perfil.tsx`). Replaces home as the
  // "delete my account"/logout/language surface — home is for studying.
  profile: {
    title: "Profile",
    loadError: "We couldn't load your profile.",
    academicLevelTitle: "Academic level",
    academicLevelRedo: "Redo initial setup",
    academicLevelRedoA11y: "Redo the initial level and subjects setup",
    attributionsRow: "Attributions",
    attributionsRowSubtitle: "Where the suggested syllabi come from",
    logout: "Sign out",
    logoutA11y: "Sign out",
    deleteAccount: "Delete my account",
    deleteAccountA11y: "Delete my account",
    deleteAccountConfirmTitle: "Delete your account?",
    deleteAccountConfirmBody:
      "Your account, your progress and your sources are deleted. The consent record is kept in pseudonymized form: it is no longer linked to you. This action can't be undone.",
    deleteAccountConfirmAction: "Delete my account",
    deleteAccountWorking: "Deleting your account…",
    deleteAccountFailed: "We couldn't delete your account. You're still signed in — try again.",
    deleteAccountFailedNetwork: "We couldn't connect. Your account is still active.",
    deleteAccountDoneTitle: "Your account was deleted",
    deleteAccountDoneBody: "There's no active session on this device anymore. To come back, you'll need to create a new account.",
    deleteAccountDoneAction: "Got it",
  },

  // C2-b — Attributions screen (`app/atribuciones.tsx`), navigated from
  // Profile. Lists the 10 seed books `apiClient.getSeedAttributions()`
  // returns — never hand-written per-book text.
  attributions: {
    title: "Attributions",
    intro:
      "The suggested syllabi are based on open textbooks published under a Creative Commons (CC BY) license. Thanks to their authors and publishers.",
    loadError: "We couldn't load the attributions.",
    licenseLabel: (name: string) => `License: ${name}`,
    openSource: "View source",
    openLinkFailed: "We couldn't open the link.",
  },

  // A1 — language selector (lives in Profile since C2-b). Three options:
  // automatic (follows the device), forced Spanish, forced English.
  settings: {
    languageTitle: "Language",
    languageAuto: "Automatic (device)",
    languageEs: "Español",
    languageEn: "English",
    languageSectionA11y: "App language",
  },

  // A2 — labels of the El Salvador seed catalog
  // (packages/domain/data/el-salvador.ts), keyed by the data's STABLE
  // ids/keys (NEVER by Spanish text): stages by `stage.id` suffix,
  // GradeLevels by `gradeLevel.id` prefix+ordinal, subjects by `nameKey`.
  // `lib/catalogLabels.ts` resolves id → label with a fallback to the
  // data's `defaultLabel`/`defaultName` for ids this catalog doesn't know
  // (robustness against future server data).
  catalog: {
    stages: {
      basica: "Basic education",
      bachillerato: "High school",
      universidad: "University",
    },
    gradeLevels: {
      basica: (grade: number) => `Grade ${grade}`,
      bachillerato: (year: number) => `Year ${year} of high school`,
      universidad: (cycle: number) => `Year ${cycle}`,
    },
    subjects: {
      matematica: "Mathematics",
      fisica: "Physics",
      quimica: "Chemistry",
      lenguajeYLiteratura: "Language and Literature",
      historiaDeElSalvador: "History of El Salvador",
      ingles: "English",
    },
  },
};