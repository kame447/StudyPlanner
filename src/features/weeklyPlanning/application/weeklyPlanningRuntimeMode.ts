export const WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY =
  'studyplanner.weekly-planning.runtime-mode.v1' as const;

export const WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT =
  'studyplanner:weekly-planning-runtime-mode-change' as const;

export type WeeklyPlanningRuntimeMode = 'legacy' | 'stable_v5';

function parseRuntimeMode(value: unknown): WeeklyPlanningRuntimeMode | null {
  if (value === 'legacy') return 'legacy';
  if (value === 'stable_v5' || value === 'stable-v5') return 'stable_v5';
  return null;
}

function environmentDefault(): WeeklyPlanningRuntimeMode {
  return parseRuntimeMode(import.meta.env.VITE_WEEKLY_PLANNING_RUNTIME_MODE) ?? 'legacy';
}

function queryOverride(): WeeklyPlanningRuntimeMode | null {
  if (typeof window === 'undefined') return null;
  return parseRuntimeMode(
    new URLSearchParams(window.location.search).get('weeklyPlanningRuntime'),
  );
}

function storedMode(): WeeklyPlanningRuntimeMode | null {
  if (typeof window === 'undefined') return null;
  return parseRuntimeMode(
    window.sessionStorage.getItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY),
  );
}

export function getWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  return queryOverride() ?? storedMode() ?? environmentDefault();
}

export function setWeeklyPlanningRuntimeMode(
  mode: WeeklyPlanningRuntimeMode,
): WeeklyPlanningRuntimeMode {
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT, {
      detail: { mode },
    }));
  }
  return mode;
}

export function resetWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT, {
      detail: { mode: environmentDefault() },
    }));
  }
  return environmentDefault();
}

export function isWeeklyPlanningStableV5RuntimeEnabled(): boolean {
  return getWeeklyPlanningRuntimeMode() === 'stable_v5';
}
