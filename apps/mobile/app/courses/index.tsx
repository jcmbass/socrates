/**
 * Home (P4) — this file is `app/courses/index.tsx` (route path kept as
 * `/courses` on purpose, decision documented in DEVLOG P4), but its
 * CONTENT is now the maqueta's home screen (`assets/home.html`): subject
 * cards + XP + a greeting, instead of the course-card list F1/WP6 Part 2
 * originally shipped here.
 *
 * **Why the route path didn't move:** `app/index.tsx`, `app/login.tsx`,
 * `study/[subjectId].tsx`, `courses/[courseId]/index.tsx`, and
 * `courses/[courseId]/new-subject.tsx` all hardcode `"/courses"` as the
 * post-login/logout/back-out destination, and P3's onboarding gate already
 * redirects here after `GET /v1/courses`. Renaming the route would touch
 * every one of those call sites for zero product benefit — a redirect
 * target doesn't care what the screen inside it looks like.
 *
 * **Why subject cards, not course cards:** the maqueta's home IS a subject
 * grid (`assets/home.html`'s `.subject-card`), not a course list — this
 * flattens every ACTIVE course's subjects into one grid, matching that
 * screen. `courses/[courseId]/index.tsx` (course → subject list) and
 * `courses/new.tsx` stay in the codebase, reachable by direct navigation,
 * but are no longer LINKED from this screen — a student normally has one
 * active course per grade level, so a second "add another course" entry
 * point wasn't worth the home screen's real estate. CONFIRMAR FOUNDER if
 * multi-course support needs its own affordance later.
 *
 * **Subject.status deviation:** see `lib/homeCards.ts`'s module doc — the
 * plan's `Subject.status` field was never added to `@buxo/domain/subject.ts`
 * by P0/P1, so card status is DERIVED from each subject's `Temario`
 * (empty vs configured), not read from a stored field.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { Redirect, router, Stack, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ColdStartGate } from "../../components/ColdStartGate";
import { ContinueCard } from "../../components/ContinueCard";
import { PersonIcon } from "../../components/icons/PersonIcon";
import { PrimaryButton } from "../../components/PrimaryButton";
import { StatsStrip } from "../../components/StatsStrip";
import { SubjectCard } from "../../components/SubjectCard";
import { useT } from "../../i18n/react";
import { apiClient } from "../../lib/api/expoClient";
import { isUnauthorized } from "../../lib/api/errors";
import type { StreakResult, Subject } from "../../lib/api/types";
import { appStore, useAppState } from "../../lib/appStore";
import { buildSubjectCards, deriveXpDisplay, selectHeroCard, type SubjectCardData } from "../../lib/homeCards";
import { needsOnboarding } from "../../lib/onboardGate";
import { useSlowRequestGate } from "../../lib/useSlowRequestGate";
import { springs } from "../../theme/motion";
import { useReduceMotion, useTheme } from "../../theme/useTheme";
import { MIN_TOUCH_TARGET, spacing, typography } from "../../theme/tokens";

/**
 * Entrance choreography (craft spec §3 D2 item 5): saludo(0) → stats(1) →
 * hero(2) → grid(3), fade+rise 12dp, ~40ms stagger, spring `settle`
 * (theme/motion.ts — D1 vocabulary, no local constants). `stageIndex` is a
 * fixed literal per call site below (never conditional), so this hook is
 * always called the same number of times per render — rules-of-hooks safe
 * even though the hero stage (2) may render nothing (no configured
 * subject).
 *
 * Reduce-motion: both shared values start (and stay) at their RESTING
 * value — content renders already in place, no fade/rise at all (skill
 * apple-design §14).
 */
const ENTRANCE_STAGGER_MS = 40;
const ENTRANCE_RISE_DP = 12;

function useEntranceStyle(stageIndex: number, active: boolean, reduceMotion: boolean) {
  const opacity = useSharedValue(reduceMotion ? 1 : 0);
  const translateY = useSharedValue(reduceMotion ? 0 : ENTRANCE_RISE_DP);

  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    if (!active) return;
    const delay = stageIndex * ENTRANCE_STAGGER_MS;
    opacity.value = withDelay(delay, withTiming(1, { duration: springs.settle.duration }));
    translateY.value = withDelay(delay, withSpring(0, springs.settle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, reduceMotion, stageIndex]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

export default function Home() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const auth = useAppState((s) => s.auth);
  const reduceMotion = useReduceMotion();

  const [cards, setCards] = useState<SubjectCardData[] | null>(null);
  const [firstCourseId, setFirstCourseId] = useState<string | null>(null);
  const [streak, setStreak] = useState<StreakResult | null>(null);
  const [xp, setXp] = useState<{ visible?: number } | null>(null);
  const [error, setError] = useState(false);

  // Entrance stagger runs ONLY once per screen instance (craft spec §3 D2
  // item 5's "SOLO en primer mount"): flipped to `true` inside the data
  // effect below, right after the FIRST successful `setCards(...)` (and on
  // every later refetch too — but `setState(true)` when already `true` is a
  // no-op, React bails out without a re-render, so it never re-triggers the
  // stagger on a focus/back-navigation refetch). Deliberately NOT a
  // separate `useEffect` watching `cards` (that pattern trips the repo's
  // `react-hooks/set-state-in-effect` lint rule — calling `setState`
  // synchronously in an effect body); setting it inside the EXISTING async
  // fetch closure is not "synchronous within the effect body" the same way,
  // since it only runs after the awaited calls resolve.
  const [hasEntered, setHasEntered] = useState(false);

  // Loading state for the cold-start gate — true while the initial fetch is
  // in flight and no error has occurred yet.
  const loading = cards === null && !error;
  const { showGate } = useSlowRequestGate(loading);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth) return;
    let cancelled = false;

    (async () => {
      setError(false);
      try {
        // D-C07: the gate now reads `onboardingCompletedAt` (GET /v1/me),
        // not "has an active course" — a beta tester enrolled before C2-c
        // already has a course, and the old gate would never show them the
        // new seed-subjects onboarding.
        const [me, courses] = await Promise.all([apiClient.getMe(currentAuth.token), apiClient.listCourses(currentAuth.token)]);
        if (cancelled) return;
        if (needsOnboarding(me)) {
          router.replace("/onboard/paso-1-grados");
          return;
        }
        const active = courses.filter((c) => c.status === "active");
        const subjectsByCourse = await Promise.all(active.map((c) => apiClient.listSubjects(currentAuth.token, c.id)));
        const subjects: Subject[] = subjectsByCourse.flat().filter((s) => s.archivedAt === null);

        const [temarios, xpResult, streakData] = await Promise.all([
          // A subject with no temario yet (shouldn't happen — POST /v1/subjects
          // auto-creates one, P1) degrades to "empty" rather than blocking the
          // whole grid on one subject's fetch failure.
          Promise.all(subjects.map((s) => apiClient.getTemario(currentAuth.token, s.id).catch(() => null))),
          apiClient.getXp(currentAuth.token).catch(() => null),
          apiClient.getStreak(currentAuth.token),
        ]);
        if (cancelled) return;

        setCards(buildSubjectCards(subjects, temarios));
        setFirstCourseId(active[0]?.id ?? null);
        setXp(xpResult);
        setStreak(streakData);
        setHasEntered(true);
      } catch (err) {
        if (cancelled) return;
        if (isUnauthorized(err)) {
          await appStore.getState().logout();
          router.replace("/login");
          return;
        }
        setError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [auth, reloadKey]);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  // Refetch whenever this screen regains focus (returning from a subject's
  // temario/session, or from "+ Agregar materia") — no local cache to
  // invalidate otherwise.
  useFocusEffect(refetch);

  const greetingStyle = useEntranceStyle(0, hasEntered, reduceMotion);
  const statsStyle = useEntranceStyle(1, hasEntered, reduceMotion);
  const heroStyle = useEntranceStyle(2, hasEntered, reduceMotion);
  const gridStyle = useEntranceStyle(3, hasEntered, reduceMotion);

  if (!auth) return <Redirect href="/login" />;

  const xpDisplay = deriveXpDisplay(xp);
  // Hero ("Continuá donde ibas", craft spec §3 item 1) — zero new fetches,
  // derived from the SAME `cards` this screen already builds (see
  // `lib/homeCards.ts`'s module doc). `null` when no subject has a
  // configured temario — renders nothing, no placeholder (per spec).
  const heroCard = cards ? selectHeroCard(cards) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: t.home.title,
          // C2-b — replaces the old "Eliminar mi cuenta" (red text) + logout
          // pair the arquitecto flagged as the loudest thing on the screen.
          // A single, quiet entry point: home is for studying, account
          // controls live in Perfil now.
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.home.profileButtonA11y}
              hitSlop={spacing.md}
              onPress={() => router.push("/perfil")}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                minWidth: MIN_TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <PersonIcon size={22} color={colors.accent} />
            </Pressable>
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {cards === null && !error ? (
          showGate ? (
            <ColdStartGate visible />
          ) : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          )
        ) : error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.home.loadError}</Text>
            <PrimaryButton label={t.common.retry} onPress={refetch} />
          </View>
        ) : (
          <FlatList
            data={cards ?? []}
            keyExtractor={(item) => item.subject.id}
            numColumns={2}
            columnWrapperStyle={(cards?.length ?? 0) > 1 ? { gap: spacing.md } : undefined}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            ListHeaderComponent={
              <View style={{ gap: spacing.xl, marginBottom: spacing.md }}>
                {/* Greeting with displayName — D2 gamificado-adulto, jamás infantilizante. `heading` (tracking D1) reemplaza `title`: es el elemento de mayor jerarquía tipográfica de la pantalla (spec §3 item 4). */}
                <Animated.View style={[{ gap: spacing.sm }, greetingStyle]}>
                  {auth?.displayName ? (
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: typography.heading.fontSize,
                        lineHeight: typography.heading.lineHeight,
                        letterSpacing: typography.heading.letterSpacing,
                        fontWeight: typography.weights.semibold,
                        fontFamily: typography.fontFamily.semibold,
                      }}
                    >
                      {t.courses.greeting(auth.displayName)}
                    </Text>
                  ) : null}
                  <Text style={{ color: colors.muted, fontSize: typography.body.fontSize, lineHeight: typography.body.lineHeight }}>
                    {t.home.heading}
                  </Text>
                </Animated.View>

                {/* Streak + XP strip — R-4 discreta y honesta; XP se oculta limpio en shadow (antifuga). Reemplaza los 2 chips sueltos (spec §3 item 2). */}
                <Animated.View style={statsStyle}>
                  <StatsStrip streak={streak} xp={xpDisplay} />
                </Animated.View>

                {/* Hero "Continuá donde ibas" (spec §3 item 1) — ausente por completo (sin placeholder) cuando ninguna materia tiene temario. */}
                {heroCard ? (
                  <Animated.View style={heroStyle}>
                    <ContinueCard
                      subjectName={heroCard.subject.name}
                      topicTitle={heroCard.currentTopicTitle}
                      doneCount={heroCard.doneCount}
                      topicCount={heroCard.topicCount}
                      starsTotal={heroCard.starsTotal}
                      onPress={() =>
                        router.push({
                          pathname: "/subjects/[subjectId]/temario",
                          params: { subjectId: heroCard.subject.id, name: heroCard.subject.name },
                        })
                      }
                    />
                  </Animated.View>
                ) : null}
              </View>
            }
            // C2-b — `<LanguageSelector/>` moved to `app/perfil.tsx` (home
            // is for studying, not settings); this spacer just keeps the
            // last card clear of the floating "Agregar materia" button.
            ListFooterComponent={<View style={{ paddingBottom: 96 }} />}
            ListEmptyComponent={
              <Text
                style={{
                  color: colors.muted,
                  fontSize: typography.body.fontSize,
                  lineHeight: typography.body.lineHeight,
                  textAlign: "center",
                  marginTop: spacing.xxl,
                }}
              >
                {t.home.empty}
              </Text>
            }
            renderItem={({ item }) => (
              <Animated.View style={[{ flex: 1 }, gridStyle]}>
                <SubjectCard
                  name={item.subject.name}
                  status={item.status}
                  currentTopicTitle={item.currentTopicTitle}
                  doneCount={item.doneCount}
                  topicCount={item.topicCount}
                  starsTotal={item.starsTotal}
                  materialInEnglish={item.materialInEnglish}
                  onPress={() =>
                    router.push({ pathname: "/subjects/[subjectId]/temario", params: { subjectId: item.subject.id, name: item.subject.name } })
                  }
                />
              </Animated.View>
            )}
          />
        )}
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: spacing.lg,
            paddingBottom: insets.bottom + spacing.lg,
          }}
        >
          <PrimaryButton
            label={t.home.addSubject}
            variant="glass"
            compact
            onPress={() => {
              if (firstCourseId) router.push({ pathname: "/courses/[courseId]/new-subject", params: { courseId: firstCourseId } });
            }}
            disabled={!firstCourseId}
          />
        </View>
      </View>
    </>
  );
}
