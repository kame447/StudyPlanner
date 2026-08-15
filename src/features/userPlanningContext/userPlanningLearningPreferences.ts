import {
  loadUserPlanningContextSnapshotV1,
} from './userPlanningContextSpace';
import {
  USER_LEARNING_PREFERENCE_LABELS_V1,
} from './userPlanningContextTypes';

export interface DurableUserLearningPreferencesV1 {
  memorizationSessionDurationMinutes: number | null;
  memorizationSpacedPractice: boolean;
}

function positiveMinutes(value: string | null): number | null {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 240
    ? minutes
    : null;
}

export function loadDurableUserLearningPreferencesV1(params: {
  ownerId: string;
  currentDate: string;
}): DurableUserLearningPreferencesV1 {
  const records = loadUserPlanningContextSnapshotV1(params).records.filter(
    (record) => record.status === 'active' && record.kind === 'learning_preference',
  );
  const sessionDuration = records.find(
    (record) => record.label === USER_LEARNING_PREFERENCE_LABELS_V1.memorizationSessionDurationMinutes,
  );
  const spacedPractice = records.find(
    (record) => record.label === USER_LEARNING_PREFERENCE_LABELS_V1.memorizationSpacedPractice,
  );
  return {
    memorizationSessionDurationMinutes: positiveMinutes(sessionDuration?.value ?? null),
    memorizationSpacedPractice: spacedPractice?.value === 'enabled',
  };
}
