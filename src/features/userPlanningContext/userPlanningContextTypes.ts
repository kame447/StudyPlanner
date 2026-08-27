export const USER_PLANNING_CONTEXT_STORAGE_VERSION =
  'studyplanner-user-planning-context-v1' as const;

export const USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 = [
  'study_goal',
  'goal_event',
  'concern',
  'learning_preference',
] as const;

export const USER_LEARNING_PREFERENCE_LABELS_V1 = {
  memorizationSessionDurationMinutes: 'memorization_session_duration_minutes',
  memorizationSpacedPractice: 'memorization_spaced_practice',
} as const;

export type UserPlanningContextSemanticKindV1 =
  (typeof USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1)[number];

export interface UserPlanningContextSemanticFactV1 {
  localId: string;
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string | null;
  dateExpression: string | null;
  sourceText: string;
}

export interface UserPlanningContextRecordV1 {
  id: string;
  ownerId: string;
  kind: UserPlanningContextSemanticKindV1;
  label: string;
  value: string | null;
  dateExpression: string | null;
  observedDate: string;
  resolvedDate: string | null;
  sourceText: string;
  sourceConversationId: string;
  sourceTurnId: string;
  recordedAt: string;
  status: 'active' | 'historical';
}

export interface UserPlanningContextSnapshotV1 {
  version: typeof USER_PLANNING_CONTEXT_STORAGE_VERSION;
  ownerId: string;
  records: UserPlanningContextRecordV1[];
  updatedAt: string;
}

export function createEmptyUserPlanningContextSnapshotV1(
  ownerId: string,
): UserPlanningContextSnapshotV1 {
  return {
    version: USER_PLANNING_CONTEXT_STORAGE_VERSION,
    ownerId,
    records: [],
    updatedAt: new Date(0).toISOString(),
  };
}
