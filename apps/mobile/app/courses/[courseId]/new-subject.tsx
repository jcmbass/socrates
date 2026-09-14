/**
 * A2 §2.3 crear materia fuera de plantilla: free-text name, 60-char cap.
 * F1/WP6 Part 2: sanitization (`sanitizeSubject`) now happens server-side
 * (routes/subjects.ts, WP5, R6) — the client just trims and sends.
 */
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "../../../components/PrimaryButton";
import { TextField } from "../../../components/TextField";
import { useT } from "../../../i18n/react";
import { apiClient } from "../../../lib/api/expoClient";
import { isUnauthorized } from "../../../lib/api/errors";
import { appStore, useAppState } from "../../../lib/appStore";
import { useTheme } from "../../../theme/useTheme";
import { spacing } from "../../../theme/tokens";

export default function NewSubject() {
  const t = useT();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const auth = useAppState((s) => s.auth);

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!auth || !courseId) return <Redirect href="/courses" />;
  const token = auth.token;
  const boundCourseId = courseId;

  async function handleCreate() {
    if (name.trim().length === 0) {
      setError(t.newSubject.errors.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.createSubject(token, { courseId: boundCourseId, name: name.trim() });
      router.back();
    } catch (err) {
      if (isUnauthorized(err)) {
        await appStore.getState().logout();
        router.replace("/login");
        return;
      }
      setError(t.newSubject.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t.newSubject.title }} />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          <TextField
            label={t.newSubject.nameLabel}
            value={name}
            onChangeText={(value) => {
              setName(value);
              setError(null);
            }}
            placeholder={t.newSubject.namePlaceholder}
            error={error}
            maxLength={60}
          />
        </ScrollView>
        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <PrimaryButton
            label={t.newSubject.create}
            onPress={() => void handleCreate()}
            disabled={submitting || name.trim().length === 0}
          />
        </View>
      </View>
    </>
  );
}
