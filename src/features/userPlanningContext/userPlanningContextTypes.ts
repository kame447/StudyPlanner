export const USER_PLANNING_CONTEXT_STORAGE_VERSION =
  'studyplanner-user-planning-context-v1' as const;

export const USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION =
  'studyplanner-user-planning-context-cloud-v1' as const;

/**
 * V1 semantic kinds remain as an internal compatibility vocabulary for the
 * Stable V5 semantic contract. Settings UI must not expose these as choices.
 */
export const USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1 = [
  'study_goal',
  'goal_event',
  'concern',
  'learning_preference',
] as const;

export const USER_PLANNING_CONTEXT_ORIGINS_V1 = [
  'ai_inferred',
  'user_confirmed',
  'user_stated',
  'system_inferred',
  'migration',
] as const;

export const USER_PLANNING_CONTEXT_STATUSES_V1 = [
  'active',
  'historical',
  'needs_review',
  'superseded',
  'revoked',
  'archived',
] as const;

export const USER_LEARNING_PREFERENCE_LABELS_V1 = {
  memorizationSessionDurationMinutes: 'memorization_session_duration_minutes',
  memorizationSpacedPractice: 'memorization_spaced_practice',
} as const;

export type UserPlanningContextSemanticKindV1 =
  (typeof USER_PLANNING_CONTEXT_SEMANTIC_KINDS_V1)[number];

export type UserPlanningContextOriginV1 =
  (typeof USER_PLANNING_CONTEXT_ORIGINS_V1)[number];

export type UserPlanningContextStatusV1 =
  (typeof USER_PLANNING_CONTEXT_STATUSES_V1)[number];

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
  status: UserPlanningContextStatusV1;
  origin: UserPlanningContextOriginV1;
}

export interface UserPlanningContextSnapshotV1 {
  version: typeof USER_PLANNING_CONTEXT_STORAGE_VERSION;
  ownerId: string;
  records: UserPlanningContextRecordV1[];
  updatedAt: string;
}

export interface UserPlanningContextCloudDocumentV1 {
  schemaVersion: typeof USER_PLANNING_CONTEXT_CLOUD_SCHEMA_VERSION;
  ownerId: string;
  revision: number;
  snapshot: UserPlanningContextSnapshotV1;
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
