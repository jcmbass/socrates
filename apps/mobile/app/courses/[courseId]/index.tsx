/**
 * A2 §2.3 detalle de curso — F1/WP6 Part 2: fetched live from apps/server.
 * No `GET /v1/courses/:id` exists in WP5's contract, so the course itself
 * comes from `GET /v1/courses` (list) filtered by id — same source
 * courses/index.tsx already fetches, just not cached between screens (C3:
 * the server is the only source of truth; F1/WP6 doesn't add a client
 * cache layer for it, see lib/localStore.ts's module doc).
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "../../../components/PrimaryButton";
import { useLocale, useT } from "../../../i18n/react";
import { apiClient } from "../../../lib/api/expoClient";
import { isUnauthorized } from "../../../lib/api/errors";
import type { ActiveSessionSummary, Course, Subject } from "../../../lib/api/types";
import { appStore, useAppState } from "../../../lib/appStore";
import { gradeLevelIdLabel } from "../../../lib/catalogLabels";
import { formatShortDate } from "../../../lib/date";
import { useTheme } from "../../../theme/useTheme";
import { MIN_TOUCH_TARGET, radius, spacing, typography } from "../../../theme/tokens";

interface SubjectRow {
  subject: Subject;
  lastSession: string | null;
}

export default function CourseDetail() {
  const t = useT();
  const { locale } = useLocale();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const auth = useAppState((s) => s.auth);

  const [course, setCourse] = useState<Course | null>(null);
  const [rows, setRows] = useState<SubjectRow[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth || !courseId) return;
    let cancelled = false;

    (async () => {
      setError(false);
      try {
        const [courses, subjects, sessions] = await Promise.all([
          apiClient.listCourses(currentAuth.token),
          apiClient.listSubjects(currentAuth.token, courseId),
          apiClient.listActiveSessions(currentAuth.token) as Promise<ActiveSessionSummary[]>,
        ]);
        if (cancelled) return;
        setCourse(courses.find((c) => c.id === courseId) ?? null);
        const nextRows: SubjectRow[] = subjects
          .filter((s) => s.archivedAt === null)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
          .map((subject) => {
            const lastSession = sessions
              .filter((s) => s.subjectId === subject.id)
              .map((s) => s.updatedAt)
              .sort()
              .at(-1);
            return { subject, lastSession: lastSession ?? null };
          });
        setRows(nextRows);
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
  }, [auth, courseId, reloadKey]);

  if (!auth) return <Redirect href="/login" />;
  if (!courseId) return <Redirect href="/courses" />;

  const gradeLabel = course ? gradeLevelIdLabel(course.gradeLevelId, t) : "";

  return (
    <>
      <Stack.Screen options={{ title: course ? (course.customLabel ?? gradeLabel) : t.common.loading }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        {rows === null && !error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.lg }}>
            <Text style={{ color: colors.danger, fontSize: typography.body.fontSize, textAlign: "center" }}>{t.courseDetail.loadError}</Text>
            <PrimaryButton label={t.common.retry} onPress={() => setReloadKey((k) => k + 1)} />
          </View>
        ) : (
          <FlatList
            data={rows ?? []}
            keyExtractor={(item) => item.subject.id}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
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
                {t.courseDetail.subjectsEmpty}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push({ pathname: "/study/[subjectId]", params: { subjectId: item.subject.id } })}
                style={({ pressed }) => ({
                  minHeight: MIN_TOUCH_TARGET,
                  backgroundColor: pressed ? colors.accentLight : colors.surfaceRaised,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radius.md,
                  paddingHorizontal: spacing.lg,
                  paddingVertical: spacing.md,
                  gap: spacing.xs,
                })}
              >
                <Text
                  style={{
                    color: colors.foreground,
                    fontSize: typography.body.fontSize,
                    lineHeight: typography.body.lineHeight,
                    fontWeight: typography.weights.medium,
                  }}
                >
                  {item.subject.name}
                </Text>
                <Text
                  style={{
                    color: colors.muted,
                    fontSize: typography.caption.fontSize,
                    lineHeight: typography.caption.lineHeight,
                    fontVariant: [...typography.tabularNums],
                  }}
                >
                  {item.lastSession ? t.courseDetail.lastSession(formatShortDate(item.lastSession, locale)) : t.courseDetail.noSessions}
                </Text>
              </Pressable>
            )}
          />
        )}
        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <PrimaryButton
            label={t.courseDetail.addSubject}
            onPress={() => router.push({ pathname: "/courses/[courseId]/new-subject", params: { courseId } })}
          />
        </View>
      </View>
    </>
  );
}
