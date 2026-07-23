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
  try {
    return parseRuntimeMode(
      new URLSearchParams(window.location.search).get('weeklyPlanningRuntime'),
    );
  } catch {
    return null;
  }
}

function storedMode(): WeeklyPlanningRuntimeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseRuntimeMode(
      window.sessionStorage.getItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function dispatchModeChange(mode: WeeklyPlanningRuntimeMode): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT, {
    detail: { mode },
  }));
}

export function getWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  return queryOverride() ?? storedMode() ?? environmentDefault();
}

export function setWeeklyPlanningRuntimeMode(
  mode: WeeklyPlanningRuntimeMode,
): WeeklyPlanningRuntimeMode {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY, mode);
    } catch {
      // The current tab still switches through the event even if storage is unavailable.
    }
    dispatchModeChange(mode);
  }
  return mode;
}

export function resetWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  const fallback = environmentDefault();
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY);
    } catch {
      // Keep the environment default when storage is unavailable.
    }
    dispatchModeChange(fallback);
  }
  return fallback;
}

export function isWeeklyPlanningStableV5RuntimeEnabled(): boolean {
  return getWeeklyPlanningRuntimeMode() === 'stable_v5';
}
