/**
 * P5 + D2 — sesión por tema (DF-P12). D-S01: opening a topic defaults to
 * **guided session**; free chat (pre-D2 UI, extracted to `TopicFreeChat.tsx`)
 * is one tap away via header link or closure CTA, or via `?mode=free`.
 *
 * Temario Continuar / topic taps keep the same route — no path change;
 * they land in guided mode unless `mode=free` is passed.
 */
import { useEffect, useState } from "react";
import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { GuidedSession } from "../../../../components/guided/GuidedSession";
import { TopicFreeChat } from "../../../../components/TopicFreeChat";
import { useT } from "../../../../i18n/react";
import { apiClient } from "../../../../lib/api/expoClient";
import { useAppState } from "../../../../lib/appStore";

type SessionMode = "guided" | "free";

export default function TopicSession() {
  const t = useT();
  const { subjectId, topicId, name, mode } = useLocalSearchParams<{
    subjectId: string;
    topicId: string;
    name?: string;
    mode?: string;
  }>();
  const auth = useAppState((s) => s.auth);
  const [sessionMode, setSessionMode] = useState<SessionMode>(mode === "free" ? "free" : "guided");
  const [topicTitle, setTopicTitle] = useState(name ?? t.common.loading);
  const [subjectTitle, setSubjectTitle] = useState(name ?? t.common.loading);

  useEffect(() => {
    if (mode === "free") setSessionMode("free");
  }, [mode]);

  useEffect(() => {
    if (!auth || !subjectId || !topicId) return;
    let cancelled = false;
    void apiClient
      .getTemario(auth.token, subjectId)
      .then((temario) => {
        if (cancelled) return;
        const topic = temario.topics.find((tp) => tp.id === topicId);
        if (topic) setTopicTitle(topic.title);
      })
      .catch(() => {
        // titles fall back to route params / loading copy
      });
    return () => {
      cancelled = true;
    };
  }, [auth, subjectId, topicId]);

  function handleBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace({ pathname: "/subjects/[subjectId]/temario", params: { subjectId, name } });
    }
  }

  if (!subjectId || !topicId) return <Redirect href="/courses" />;
  if (!auth) return <Redirect href="/login" />;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {sessionMode === "guided" ? (
        <GuidedSession
          userId={auth.userId}
          token={auth.token}
          subjectId={subjectId}
          topicId={topicId}
          subjectTitle={subjectTitle}
          topicTitle={topicTitle}
          onBack={handleBack}
          onSwitchToFree={() => setSessionMode("free")}
          onNextTopic={handleBack}
        />
      ) : (
        <TopicFreeChat subjectId={subjectId} topicId={topicId} subjectName={name} />
      )}
    </>
  );
}
