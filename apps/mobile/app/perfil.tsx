/**
 * Perfil (C2-b) — new screen, pushed from home's header person icon
 * (`app/courses/index.tsx`). Carries everything the arquitecto flagged as
 * too loud for home: "Eliminar mi cuenta" (red text) and the logout icon
 * used to sit in home's header; `<LanguageSelector/>` used to sit at
 * home's footer. Home is for studying — this is where account-level
 * controls live now. Also closes a standing lie: onboarding paso-1's
 * footnote already promised "Podés cambiar esto después desde tu perfil"
 * (`i18n` `onboard.paso1.footnote`) before this screen existed.
 *
 * Sections top to bottom: read-only identity, language (reused
 * `LanguageSelector`, unchanged), academic level (+ redo-onboarding
 * entry), Atribuciones row, a normal (non-destructive) logout button, and
 * — separated, visually quiet — delete account behind `ConfirmDialog`.
 *
 * DESIGN.md §8: the delete-account trigger below is a plain small text
 * button (`colors.danger`, no fill) but its Pressable is sized to
 * `MIN_TOUCH_TARGET` with `alignSelf: "flex-start"` — the hit area never
 * exceeds the label's own width, and it sits alone in its own section,
 * separated by a divider from the logout button above it, so a mis-tap
 * intending "cerrar sesión" can't land on it.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Redirect, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { LanguageSelector } from "../components/LanguageSelector";
import { OutlineButton } from "../components/OutlineButton";
import { PrimaryButton } from "../components/PrimaryButton";
import { PressableScale } from "../components/PressableScale";
import { useT } from "../i18n/react";
import { apiClient } from "../lib/api/expoClient";
import { isNetworkError } from "../lib/api/errors";
import { gradeLevelIdLabel } from "../lib/catalogLabels";
import { deleteAccountThenLogout } from "../lib/deleteAccount";
import { appStore, useAppState } from "../lib/appStore";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";

function SectionCard(props: { title?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surfaceRaised,
        padding: spacing.md,
        gap: spacing.sm,
      }}
    >
      {props.title ? (
        <Text
          style={{
            color: colors.muted,
            fontSize: typography.eyebrow.fontSize,
            lineHeight: typography.eyebrow.lineHeight,
            letterSpacing: typography.eyebrow.letterSpacing,
            textTransform: "uppercase",
            fontWeight: typography.weights.semibold,
            fontFamily: typography.fontFamily.semibold,
          }}
        >
          {props.title}
        </Text>
      ) : null}
      {props.children}
    </View>
  );
}

export default function Perfil() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);

  const [gradeLabel, setGradeLabel] = useState<string | null>(null);
  const [gradeError, setGradeError] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [accountDeleted, setAccountDeleted] = useState(false);

  useEffect(() => {
    const token = auth?.token;
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const courses = await apiClient.listCourses(token);
        if (cancelled) return;
        const active = courses.find((c) => c.status === "active");
        setGradeLabel(active ? gradeLevelIdLabel(active.gradeLevelId, t) : null);
      } catch {
        if (!cancelled) setGradeError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth?.token, t]);

  const confirmDeleteAccount = async () => {
    const token = auth?.token;
    if (!token || deletingAccount) return;
    setDeletingAccount(true);
    setDeleteAccountError(null);
    const result = await deleteAccountThenLogout(
      (tok) => apiClient.deleteAccount(tok),
      token,
      () => {
        setDeleteConfirmOpen(false);
        setAccountDeleted(true);
      },
      () => appStore.getState().logout(),
    );
    setDeletingAccount(false);
    if (!result.ok) {
      setDeleteAccountError(
        isNetworkError(result.error) ? t.profile.deleteAccountFailedNetwork : t.profile.deleteAccountFailed,
      );
    }
  };

  if (accountDeleted) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: spacing.lg, justifyContent: "center", gap: spacing.md }}>
        <Text
          style={{
            color: colors.foreground,
            fontSize: typography.heading.fontSize,
            lineHeight: typography.heading.lineHeight,
            fontWeight: typography.weights.semibold,
            fontFamily: typography.fontFamily.semibold,
          }}
        >
          {t.profile.deleteAccountDoneTitle}
        </Text>
        <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
          {t.profile.deleteAccountDoneBody}
        </Text>
        <PrimaryButton label={t.profile.deleteAccountDoneAction} onPress={() => router.replace("/login")} />
      </View>
    );
  }

  if (!auth) return <Redirect href="/login" />;

  return (
    <>
      <Stack.Screen options={{ title: t.profile.title }} />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.surface }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }}
      >
        <View style={{ gap: spacing.xs }}>
          <Text
            style={{
              color: colors.foreground,
              fontSize: typography.title.fontSize,
              lineHeight: typography.title.lineHeight,
              fontWeight: typography.weights.bold,
            }}
          >
            {auth.displayName}
          </Text>
          <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
            {auth.email}
          </Text>
        </View>

        <LanguageSelector />

        <SectionCard title={t.profile.academicLevelTitle}>
          {gradeError ? (
            <Text style={{ color: colors.danger, fontSize: typography.small.fontSize }}>{t.profile.loadError}</Text>
          ) : gradeLabel === null ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
              {gradeLabel}
            </Text>
          )}
          <OutlineButton
            label={t.profile.academicLevelRedo}
            onPress={() => router.push("/onboard/paso-1-grados")}
          />
        </SectionCard>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t.profile.attributionsRow}
          onPress={() => router.push("/atribuciones")}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceRaised,
            paddingHorizontal: spacing.md,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ color: colors.foreground, fontSize: typography.body.fontSize, fontWeight: typography.weights.semibold }}>
              {t.profile.attributionsRow}
            </Text>
            <Text style={{ color: colors.muted, fontSize: typography.caption.fontSize, lineHeight: typography.caption.lineHeight }}>
              {t.profile.attributionsRowSubtitle}
            </Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: typography.body.fontSize }}>›</Text>
        </PressableScale>

        <OutlineButton
          label={t.profile.logout}
          onPress={() => {
            void appStore
              .getState()
              .logout()
              .then(() => router.replace("/login"));
          }}
        />

        {/* Zona separada y discreta (DESIGN.md §8) — nunca comparte hitbox
            ni jerarquía visual con el logout normal de arriba. */}
        <View style={{ marginTop: spacing.lg, alignItems: "flex-start" }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t.profile.deleteAccountA11y}
            onPress={() => {
              setDeleteAccountError(null);
              setDeleteConfirmOpen(true);
            }}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              alignSelf: "flex-start",
              justifyContent: "center",
              paddingHorizontal: spacing.sm,
            }}
          >
            <Text style={{ color: colors.danger, fontSize: typography.caption.fontSize, fontWeight: typography.weights.semibold }}>
              {t.profile.deleteAccount}
            </Text>
          </PressableScale>
        </View>
      </ScrollView>

      <ConfirmDialog
        visible={deleteConfirmOpen}
        title={t.profile.deleteAccountConfirmTitle}
        body={t.profile.deleteAccountConfirmBody}
        confirmLabel={t.profile.deleteAccountConfirmAction}
        cancelLabel={t.common.cancel}
        destructive
        busy={deletingAccount}
        busyLabel={t.profile.deleteAccountWorking}
        errorMessage={deleteAccountError ?? undefined}
        onConfirm={() => void confirmDeleteAccount()}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </>
  );
}
