export interface CourseBody {
  id: string;
  gradeLevelId: string;
  status: string;
}
export interface SubjectBody {
  id: string;
  name: string;
}
export interface SessionBody {
  id: string;
  createdAt: string;
  kind?: "topic" | "milestone";
  topicId?: string | null;
  milestoneId?: string | null;
  bandChanges: Array<{ band: string; source: string; rationale: string | null }>;
  materialAssetIds: string[];
  materialSnapshotTextRef: string | null;
  materialEvents: Array<{ timestamp: string; materialAssetId: string; source: string; kind: string; action: string }>;
}
export interface ExchangeBody {
  studentMessage: string;
  tutorReply: string;
  tutorProviderId: string;
  tutorModelId: string;
  tutorPromptVersion: string;
  band: string;
  hintOffered: boolean | null;
  studentCorrect: boolean | null;
  judgeModelId: string | null;
}
export interface FullSessionBody extends SessionBody {
  exchanges: ExchangeBody[];
  opening?: {
    id: string;
    sessionId: string;
    text: string;
    tutorModelId: string;
    tutorProviderId: string;
    tutorPromptVersion: string;
    grounding: "fuentes" | "general";
    createdAt: string;
  } | null;
}
