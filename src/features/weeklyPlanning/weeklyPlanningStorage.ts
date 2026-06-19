import type { PlanningState } from './types';
import { createInitialPlanningState } from './weeklyPlanningReducer';

function getStorageKey(userId: string, weekStartDate: string): string {
  return `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;
}

function isPlanningState(value: unknown): value is PlanningState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PlanningState>;
  return (
    typeof candidate.weekStartDate === 'string' &&
    Array.isArray(candidate.draftBlocks) &&
    Array.isArray(candidate.messages)
  );
}

export function loadWeeklyPlanningState(
  userId: string,
  weekStartDate: string,
): PlanningState {
  if (typeof window === 'undefined') {
    return createInitialPlanningState(weekStartDate);
  }

  try {
    const rawValue = window.localStorage.getItem(getStorageKey(userId, weekStartDate));
    if (!rawValue) {
      return createInitialPlanningState(weekStartDate);
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isPlanningState(parsedValue)) {
      return createInitialPlanningState(weekStartDate);
    }

    return {
      ...parsedValue,
      weekStartDate,
      draftBlocks: parsedValue.draftBlocks.filter(
        (block) => block.status === 'draft',
      ),
    };
  } catch {
    return createInitialPlanningState(weekStartDate);
  }
}

export function saveWeeklyPlanningState(userId: string, state: PlanningState): void {
  if (typeof window === 'undefined') {
    return;
  }

  const serializableState: PlanningState = {
    ...state,
    draftBlocks: state.draftBlocks.filter((block) => block.status === 'draft'),
  };

  try {
    const key = getStorageKey(userId, state.weekStartDate);

    if (serializableState.draftBlocks.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(serializableState));
  } catch {
    // localStorage is best effort; the in-memory draft remains authoritative.
  }
}
