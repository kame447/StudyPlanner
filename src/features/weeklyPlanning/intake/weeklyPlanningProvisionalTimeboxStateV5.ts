import type { PlanningIntakeState } from './weeklyPlanningIntakeTypes';

export const WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5 =
  'weekly-planning-provisional-timebox-state-v1' as const;
export const WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 = 60;

export interface WeeklyPlanningProvisionalTimeboxStateV5 {
  version: typeof WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5;
  workloadFactIds: string[];
  minutesPerWorkload: number;
  authorizedAtGraphRevision: number;
  authorizedAtTurnId: string;
}

declare module './weeklyPlanningIntakeTypes' {
  interface PlanningIntakeState {
    provisionalTimebox?: WeeklyPlanningProvisionalTimeboxStateV5;
  }
}

function uniqueWorkloadFactIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = value.map((item) => typeof item === 'string' ? item.trim() : '');
  if (ids.some((id) => !id)) return null;
  return [...new Set(ids)];
}

export function readWeeklyPlanningProvisionalTimeboxStateV5(
  value: unknown,
): WeeklyPlanningProvisionalTimeboxStateV5 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const workloadFactIds = uniqueWorkloadFactIds(record.workloadFactIds);
  if (
    record.version !== WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5
    || !workloadFactIds
    || record.minutesPerWorkload !== WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5
    || typeof record.authorizedAtGraphRevision !== 'number'
    || !Number.isInteger(record.authorizedAtGraphRevision)
    || record.authorizedAtGraphRevision < 0
    || typeof record.authorizedAtTurnId !== 'string'
    || !record.authorizedAtTurnId.trim()
  ) return null;

  return {
    version: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_STATE_VERSION_V5,
    workloadFactIds,
    minutesPerWorkload: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5,
    authorizedAtGraphRevision: record.authorizedAtGraphRevision,
    authorizedAtTurnId: record.authorizedAtTurnId.trim(),
  };
}

export function withWeeklyPlanningProvisionalTimeboxStateV5(
  state: PlanningIntakeState,
  next: WeeklyPlanningProvisionalTimeboxStateV5 | null,
): PlanningIntakeState {
  const { provisionalTimebox: _previous, ...rest } = state;
  return next
    ? { ...rest, provisionalTimebox: structuredClone(next) }
    : rest;
}
