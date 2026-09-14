/**
 * A1 login/registro — F1/WP6 Part 2 (real magic-link auth against
 * apps/server, DF-6.2), extended in F2 WQ4 with the real deep-link flow.
 *
 * Three views (visual split 2026-08-06 — the single crowded screen became
 * a minimal welcome + a mode-specific form; business logic unchanged):
 * 1. "welcome": the Socrates portrait (transparent PNG clipped to a circle,
 *    `WelcomeAvatar`) + wordmark + tagline, vertically centred in the free
 *    space, over two stacked buttons ("Crear cuenta" / "Ya tengo cuenta")
 *    that pick `mode` and advance to "form". No inputs (founder: minimalismo).
 * 2. "form": signup (email + name + 13+ checkbox + terms checkbox, same A1
 *    §1.2.5 fields as WP2) OR login (email only) — the mode came from the
 *    welcome buttons and is stated in a heading, so the screen says what
 *    you're doing without relying on the submit label; an OnboardBackButton
 *    returns to "welcome".
 *    Submitting calls POST /v1/auth/signup or /v1/auth/login; both return
 *    202 with no token (anti-enumeration, C-backend §2.4) — the actual
 *    magic link is only ever emailed (or, in dev, printed to apps/server's
 *    console via ConsoleEmailSender, WP5).
 * 3. "verify": the emailed link is `buxo://login?token=...` (expo-router
 *    scheme, `apps/mobile/app.json`). Opening it — cold start or warm —
 *    routes here with `token` in `useLocalSearchParams`; expo-router
 *    resolves both cases on its own, so this screen doesn't register any
 *    manual expo-linking listener. A `useEffect` picks up that param and
 *    calls `verifyToken` exactly once (guarded by `autoVerifiedTokenRef`,
 *    since re-renders would otherwise re-fire it), landing on this same
 *    "verify" step in a "verifying" state while `POST /v1/auth/verify`
 *    resolves. In production the step shows only the "check your email"
 *    instructions + a "back" button — there is no way to complete the link
 *    without actually tapping it. `__DEV__` builds additionally show a
 *    paste-token field (no real inbox in dev) that drives the exact same
 *    `verifyToken` function. Either path uses `email`/`displayName` FROM
 *    THE SERVER'S RESPONSE for `completeLogin` — never guessed from local
 *    form state, since a cold-start deep link has none.
 */
import { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import welcomeAvatarSource from "../assets/images/socrates-welcome.png";
import { OnboardBackButton } from "../components/OnboardBackButton";
import { OutlineButton } from "../components/OutlineButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { SelectableRow } from "../components/SelectableRow";
import { TextField } from "../components/TextField";
import { useT } from "../i18n/react";
import type { Strings } from "../i18n";
import { apiClient } from "../lib/api/expoClient";
import { ApiError } from "../lib/api/errors";
import { appStore } from "../lib/appStore";
import { normalizeDeepLinkToken } from "../lib/deepLinkToken";
import { privacyUrl, termsUrl } from "../lib/legalUrls";
import { useTheme } from "../theme/useTheme";
import { MIN_TOUCH_TARGET, spacing, typography } from "../theme/tokens";
import { CURRENT_POLICY_VERSIONS } from "@buxo/domain/policy-versions";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

const WELCOME_AVATAR_SIZE = 180;

/**
 * Encuadre del retrato, en píxeles del asset
 * (`assets/images/socrates-welcome.png`, 1044x1024). `headCx/headCy/headR`
 * describen el círculo MÍNIMO que contiene toda la cabeza y el pelo por
 * encima del cuello — medido sobre el canal alfa del PNG, no estimado a ojo:
 * el cuello es la fila más angosta del contorno (y≈859) y el círculo que
 * envuelve todo lo opaco por arriba de ahí es centro (520,460) radio 491.
 *
 * Alinear el círculo del recorte con ESE círculo es lo que garantiza que no
 * se corte ni mejilla ni quijada: un encuadre más ajustado (o centrado en el
 * medio de la imagen, que no es el medio de la cabeza) deja la mandíbula
 * fuera del borde inferior izquierdo. `HEAD_MARGIN` deja un poco de aire
 * para que el pelo no quede tangente al borde.
 */
const AVATAR_SOURCE = { width: 1044, height: 1024, headCx: 520, headCy: 460, headR: 491 } as const;
const HEAD_MARGIN = 1.04;

const AVATAR_SCALE = WELCOME_AVATAR_SIZE / (2 * AVATAR_SOURCE.headR * HEAD_MARGIN);
const AVATAR_LAYOUT = {
  width: AVATAR_SOURCE.width * AVATAR_SCALE,
  height: AVATAR_SOURCE.height * AVATAR_SCALE,
  left: WELCOME_AVATAR_SIZE / 2 - AVATAR_SOURCE.headCx * AVATAR_SCALE,
  top: WELCOME_AVATAR_SIZE / 2 - AVATAR_SOURCE.headCy * AVATAR_SCALE,
} as const;

type Mode = "signup" | "login";
type Step = "form" | "verify";
type LoginView = "welcome" | "form";

// A1 — takes the catalog as a parameter (module scope can't hold hooks);
// callers pass the `t` they get from useT().
function mapSubmitError(err: unknown, strings: Strings): string {
  if (err instanceof ApiError) {
    if (err.code === "network_error") return strings.login.errors.network;
    if (err.code === "conflict") return strings.login.errors.conflict;
  }
  return strings.login.errors.generic;
}

export default function Login() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ token?: string }>();

  const [mode, setMode] = useState<Mode>("signup");
  /**
   * Arranca en "verify" cuando la pantalla se abre DESDE el enlace del correo:
   * el efecto de auto-verificación corre después del primer render, así que
   * inicializar esto en "form" hacía parpadear la bienvenida (retrato de
   * 180dp incluido) un frame antes de mostrar el estado de verificación.
   */
  const [step, setStep] = useState<Step>(() =>
    normalizeDeepLinkToken(params.token) ? "verify" : "form",
  );
  const [view, setView] = useState<LoginView>("welcome");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [ageConfirmedAt, setAgeConfirmedAt] = useState<string | null>(null);
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ email?: string; name?: string; age?: string; terms?: string }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [devToken, setDevToken] = useState("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // Guards the deep-link auto-verify below from re-firing on re-renders —
  // holds the last token this screen already submitted to POST /v1/auth/verify.
  const autoVerifiedTokenRef = useRef<string | null>(null);

  async function verifyToken(token: string) {
    setStep("verify");
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await apiClient.verify(token);
      await appStore.getState().completeLogin({
        userId: result.userId,
        email: result.email,
        displayName: result.displayName,
        token: result.token,
      });
      router.replace("/courses");
    } catch (err) {
      setVerifyError(err instanceof ApiError && err.code === "network_error" ? t.login.errors.network : t.login.verify.errors.invalid);
    } finally {
      setVerifying(false);
    }
  }

  useEffect(() => {
    const token = normalizeDeepLinkToken(params.token);
    if (token && autoVerifiedTokenRef.current !== token) {
      autoVerifiedTokenRef.current = token;
      void verifyToken(token);
    }
  }, [params.token]);

  async function handleSubmit() {
    const nextErrors: typeof errors = {};
    if (!EMAIL_PATTERN.test(email.trim())) nextErrors.email = t.login.errors.emailInvalid;
    if (mode === "signup") {
      if (name.trim().length === 0) nextErrors.name = t.login.errors.nameRequired;
      if (!ageConfirmedAt) nextErrors.age = t.login.errors.ageRequired;
      if (!termsAcceptedAt) nextErrors.terms = t.login.errors.termsRequired;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "signup") {
        await apiClient.signup({
          email: email.trim(),
          displayName: name.trim(),
          ageConfirmedAt: ageConfirmedAt!,
          consents: [
            { type: "terms_13plus", policyVersion: CURRENT_POLICY_VERSIONS.terms_13plus },
            { type: "privacy_policy", policyVersion: CURRENT_POLICY_VERSIONS.privacy_policy },
          ],
        });
      } else {
        await apiClient.login(email.trim());
      }
      setStep("verify");
    } catch (err) {
      setSubmitError(mapSubmitError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  // __DEV__-only: drives the paste-token field with the exact same
  // verifyToken function the deep-link auto-verify uses above.
  async function handleDevVerify() {
    if (devToken.trim().length === 0) {
      setVerifyError(t.login.verify.errors.tokenRequired);
      return;
    }
    await verifyToken(devToken.trim());
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.surface }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: spacing.xl,
            paddingTop: insets.top + spacing.xxl,
            paddingBottom: insets.bottom + spacing.xl,
            gap: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {step === "verify" ? (
            <>
              <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight, fontWeight: typography.weights.semibold }}>
                {t.login.verify.title}
              </Text>
              <Text style={{ color: colors.muted, fontSize: typography.small.fontSize, lineHeight: typography.small.lineHeight }}>
                {verifying ? t.login.verify.verifying : t.login.verify.instructions}
              </Text>
              {verifyError && !__DEV__ ? <FieldError message={verifyError} /> : null}

              {__DEV__ ? (
                <>
                  <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                    {t.login.verify.devPasteInstructions}
                  </Text>
                  <TextField
                    label={t.login.verify.devTokenLabel}
                    value={devToken}
                    onChangeText={setDevToken}
                    placeholder={t.login.verify.devTokenPlaceholder}
                    error={verifyError ?? undefined}
                    autoCapitalize="none"
                  />
                  <PrimaryButton label={t.login.verify.submit} onPress={() => void handleDevVerify()} disabled={verifying} />
                </>
              ) : null}

              <View style={{ marginTop: "auto", gap: spacing.md }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setStep("form");
                    setVerifyError(null);
                    setDevToken("");
                  }}
                >
                  <Text style={{ color: colors.accent, fontSize: typography.small.fontSize, textAlign: "center" }}>{t.login.verify.back}</Text>
                </Pressable>
              </View>
            </>
          ) : view === "welcome" ? (
            <>
              {/* El bloque hero ocupa todo el espacio libre y se centra dentro
                  de él: anclarlo arriba dejaba ~450dp de vacío muerto entre el
                  retrato y los botones, que leía como pantalla sin terminar. */}
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
                <WelcomeAvatar />
                <View style={{ alignItems: "center", gap: spacing.sm }}>
                  <Text
                    style={{
                      color: colors.accent,
                      fontSize: typography.heading.fontSize,
                      lineHeight: typography.heading.lineHeight,
                      letterSpacing: typography.heading.letterSpacing,
                      fontWeight: typography.weights.bold,
                      fontFamily: typography.fontFamily.bold,
                      textAlign: "center",
                    }}
                  >
                    {t.login.title}
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: typography.body.fontSize,
                      lineHeight: typography.body.lineHeight,
                      fontFamily: typography.fontFamily.regular,
                      textAlign: "center",
                    }}
                  >
                    {t.login.tagline}
                  </Text>
                </View>
              </View>

              <View style={{ gap: spacing.md }}>
                <PrimaryButton
                  label={t.login.submit}
                  onPress={() => {
                    setMode("signup");
                    setView("form");
                  }}
                />
                <OutlineButton
                  label={t.login.hasAccount}
                  onPress={() => {
                    setMode("login");
                    setView("form");
                  }}
                />
              </View>
            </>
          ) : (
            <>
              {/* Sin este encabezado la vista era una flecha de volver y un
                  campo suelto: nada decía si estás creando cuenta o entrando
                  a la tuya. El label del botón de abajo no alcanza — queda
                  fuera de vista apenas se abre el teclado. */}
              <View style={{ gap: spacing.md }}>
                <OnboardBackButton
                  onPress={() => {
                    setView("welcome");
                    setErrors({});
                    setSubmitError(null);
                  }}
                />
                <Text
                  accessibilityRole="header"
                  style={{
                    color: colors.foreground,
                    fontSize: typography.heading.fontSize,
                    lineHeight: typography.heading.lineHeight,
                    letterSpacing: typography.heading.letterSpacing,
                    fontWeight: typography.weights.bold,
                    fontFamily: typography.fontFamily.bold,
                  }}
                >
                  {mode === "signup" ? t.login.formTitleSignup : t.login.formTitleLogin}
                </Text>
              </View>

              <TextField
                label={t.login.emailLabel}
                value={email}
                onChangeText={setEmail}
                placeholder={t.login.emailPlaceholder}
                error={errors.email}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              {mode === "signup" ? (
                <>
                  <TextField
                    label={t.login.nameLabel}
                    value={name}
                    onChangeText={setName}
                    placeholder={t.login.namePlaceholder}
                    error={errors.name}
                    maxLength={60}
                  />
                  <View>
                    <SelectableRow
                      label={t.login.ageCheckbox}
                      selected={ageConfirmedAt !== null}
                      onPress={() => setAgeConfirmedAt(ageConfirmedAt ? null : new Date().toISOString())}
                    />
                    {errors.age ? <FieldError message={errors.age} /> : null}
                    <SelectableRow
                      label={t.login.termsCheckbox}
                      selected={termsAcceptedAt !== null}
                      onPress={() => setTermsAcceptedAt(termsAcceptedAt ? null : new Date().toISOString())}
                      caption={t.login.termsNote}
                    />
                    {/* Los enlaces van FUERA del SelectableRow: adentro, cada
                        toque para leer el documento habría marcado o
                        desmarcado la casilla — aceptar sin querer los
                        términos es exactamente lo que no puede pasar acá. */}
                    <LegalLinks />
                    {errors.terms ? <FieldError message={errors.terms} /> : null}
                  </View>
                </>
              ) : null}

              {submitError ? <FieldError message={submitError} /> : null}

              <View style={{ marginTop: "auto", gap: spacing.md }}>
                <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
                  {t.login.stubNote}
                </Text>
                <PrimaryButton
                  label={mode === "signup" ? t.login.submit : t.login.submitLogin}
                  onPress={() => void handleSubmit()}
                  disabled={submitting}
                />
                {/* SPIKE_F05_DEV_LINK_START — throwaway, __DEV__ only. Remove
                    this block (and app/dev/spike-f05.tsx, spike-f05/,
                    lib/spikeF05Bridge.ts) once F0.5's verdict lands
                    (C-cliente-e-ingesta.md §2.6 step 7). */}
                {__DEV__ ? (
                  <Pressable accessibilityRole="button" onPress={() => router.push("/dev/spike-f05")}>
                    <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, textAlign: "center" }}>
                      🔧 SPIKE F0.5 (dev only)
                    </Text>
                  </Pressable>
                ) : null}
                {/* SPIKE_F05_DEV_LINK_END */}
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/**
 * Retrato de bienvenida: el PNG transparente recortado a un CÍRCULO
 * (DESIGN.md §5 — retrato circular), sin fondo de ningún color.
 *
 * El asset llega hasta el borde inferior con la camisa en blanco, así que
 * dibujarlo entero dejaba un corte horizontal duro contra el fondo casi
 * negro que leía como artefacto de render. El círculo lo resuelve: el hombro
 * sale por la curva en vez de terminar en un filo.
 *
 * El encuadre sale de `AVATAR_LAYOUT`, alineado al círculo de la cabeza
 * medido sobre el alfa del PNG — ver el comentario de `AVATAR_SOURCE`.
 * `backgroundColor` se deja sin definir a propósito: la transparencia del
 * PNG es lo que hace que el pelo se funda con el fondo en ambos temas.
 */
function WelcomeAvatar() {
  return (
    <View
      style={{
        width: WELCOME_AVATAR_SIZE,
        height: WELCOME_AVATAR_SIZE,
        borderRadius: WELCOME_AVATAR_SIZE / 2,
        overflow: "hidden",
      }}
    >
      <Image
        source={welcomeAvatarSource}
        alt=""
        accessible={false}
        importantForAccessibility="no"
        resizeMode="stretch"
        style={{
          width: AVATAR_LAYOUT.width,
          height: AVATAR_LAYOUT.height,
          marginLeft: AVATAR_LAYOUT.left,
          marginTop: AVATAR_LAYOUT.top,
        }}
      />
    </View>
  );
}

/**
 * Los dos documentos legales, abiertos en el navegador del sistema
 * (`Linking.openURL` → `lib/legalUrls.ts`, servidos por apps/server).
 *
 * Cada enlace es su propio `Pressable` con `MIN_TOUCH_TARGET` de alto: son
 * controles reales, no texto decorado, y tienen que poder tocarse con el
 * pulgar. Si `openURL` falla (sin navegador, esquema bloqueado) se muestra
 * la URL en texto plano en vez de fallar en silencio — un documento legal
 * inalcanzable no es un detalle cosmético.
 */
function LegalLinks() {
  const t = useT();
  const { colors } = useTheme();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const links = [
    { label: t.login.termsLink, url: termsUrl() },
    { label: t.login.privacyLink, url: privacyUrl() },
  ];

  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg }}>
        {links.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            accessibilityLabel={link.label}
            onPress={() => {
              setFailedUrl(null);
              Linking.openURL(link.url).catch(() => setFailedUrl(link.url));
            }}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: "center" }}
          >
            <Text
              style={{
                color: colors.accent,
                fontSize: typography.small.fontSize,
                lineHeight: typography.small.lineHeight,
                fontWeight: typography.weights.semibold,
                textDecorationLine: "underline",
              }}
            >
              {link.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {failedUrl ? (
        <Text selectable style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
          {t.login.legalLinkFailed}
          {failedUrl}
        </Text>
      ) : null}
    </View>
  );
}

function FieldError(props: { message: string }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityLiveRegion="polite"
      style={{
        color: colors.danger,
        fontSize: typography.caption.fontSize,
        lineHeight: typography.caption.lineHeight,
        paddingHorizontal: spacing.md,
      }}
    >
      {props.message}
    </Text>
  );
}
