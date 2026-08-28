import { loadUserPlanningContextSnapshotV1 } from './userPlanningContextSpace';
import type { UserPlanningContextRecordV1 } from './userPlanningContextTypes';

export const USER_PLANNING_CONTEXT_SCOPE_TYPES_V2 = [
  'global',
  'subject',
  'activity_kind',
  'goal',
  'material',
] as const;

export type UserPlanningContextScopeTypeV2 =
  (typeof USER_PLANNING_CONTEXT_SCOPE_TYPES_V2)[number];

export interface UserPlanningContextScopeV2 {
  type: UserPlanningContextScopeTypeV2;
  key: string | null;
}

export interface UserPlanningContextPromptRecordV2 {
  id: string;
  kind: UserPlanningContextRecordV1['kind'];
  label: string;
  value: string | null;
  dateExpression: string | null;
  status: UserPlanningContextRecordV1['status'];
  origin: UserPlanningContextRecordV1['origin'];
  scope: UserPlanningContextScopeV2;
  relevanceTier: 'core' | 'relevant';
}

const MAX_CORE_CONTEXT_RECORDS = 10;
const MAX_RELEVANT_CONTEXT_RECORDS = 10;
const MAX_RECENT_FALLBACK_RECORDS = 4;

function normalizeScopeKey(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ja-JP');
}

export function projectUserPlanningContextScopeV2(
  record: Pick<UserPlanningContextRecordV1, 'kind' | 'label'>,
): UserPlanningContextScopeV2 {
  switch (record.kind) {
    case 'study_goal':
    case 'goal_event':
      return { type: 'global', key: null };
    case 'concern':
      return { type: 'subject', key: record.label };
    case 'learning_preference':
      return { type: 'activity_kind', key: record.label };
  }
}

function toPromptRecord(
  record: UserPlanningContextRecordV1,
  relevanceTier: 'core' | 'relevant',
): UserPlanningContextPromptRecordV2 {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    value: record.value,
    dateExpression: record.dateExpression,
    status: record.status,
    origin: record.origin,
    scope: projectUserPlanningContextScopeV2(record),
    relevanceTier,
  };
}

export function selectUserPlanningContextPromptRecordsV2(params: {
  records: readonly UserPlanningContextRecordV1[];
  relevantScopeKeys?: readonly string[];
}): UserPlanningContextPromptRecordV2[] {
  const active = params.records.filter((record) => record.status === 'active');
  const relevantKeys = new Set(
    (params.relevantScopeKeys ?? [])
      .map(normalizeScopeKey)
      .filter(Boolean),
  );

  const core = active
    .filter((record) => projectUserPlanningContextScopeV2(record).type === 'global')
    .slice(0, MAX_CORE_CONTEXT_RECORDS);
  const coreIds = new Set(core.map((record) => record.id));

  const scoped = active.filter((record) => !coreIds.has(record.id));
  const exactRelevant = scoped.filter((record) => {
    const scope = projectUserPlanningContextScopeV2(record);
    return scope.key !== null && relevantKeys.has(normalizeScopeKey(scope.key));
  });
  const exactIds = new Set(exactRelevant.map((record) => record.id));
  const recentFallback = scoped
    .filter((record) => !exactIds.has(record.id))
    .slice(0, MAX_RECENT_FALLBACK_RECORDS);

  const relevant = [...exactRelevant, ...recentFallback]
    .slice(0, MAX_RELEVANT_CONTEXT_RECORDS);

  return [
    ...core.map((record) => toPromptRecord(record, 'core')),
    ...relevant.map((record) => toPromptRecord(record, 'relevant')),
  ];
}

export function userPlanningContextPromptSelectionV2(params: {
  ownerId: string;
  currentDate: string;
  relevantScopeKeys?: readonly string[];
}): UserPlanningContextPromptRecordV2[] {
  const snapshot = loadUserPlanningContextSnapshotV1({
    ownerId: params.ownerId,
    currentDate: params.currentDate,
  });
  return selectUserPlanningContextPromptRecordsV2({
    records: snapshot.records,
    relevantScopeKeys: params.relevantScopeKeys,
  });
}
