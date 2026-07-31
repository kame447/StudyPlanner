export const WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY =
  'studyplanner.weekly-planning.runtime-mode.v1' as const;

export const WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT =
  'studyplanner:weekly-planning-runtime-mode-change' as const;

/**
 * `legacy` is retained only as an internal compatibility type for archived
 * implementation and direct test-support imports. The application runtime is
 * intentionally locked to Stable V5 and must not route through legacy code.
 */
export type WeeklyPlanningRuntimeMode = 'legacy' | 'stable_v5';

export const WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE = 'stable_v5' as const;

function dispatchModeChange(mode: WeeklyPlanningRuntimeMode): void {
  if (
    typeof window === 'undefined'
    || typeof window.dispatchEvent !== 'function'
    || typeof CustomEvent !== 'function'
  ) {
    return;
  }
  window.dispatchEvent(new CustomEvent(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT, {
    detail: { mode },
  }));
}

/**
 * Production/application callers always receive Stable V5.
 *
 * Environment variables, URL query parameters, session storage, and runtime
 * setters are deliberately not allowed to downgrade the application to the
 * broken legacy path. Legacy implementation remains available only through
 * explicit internal/test-support imports.
 */
export function getWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  return WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE;
}

export function setWeeklyPlanningRuntimeMode(
  _mode: WeeklyPlanningRuntimeMode,
): WeeklyPlanningRuntimeMode {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(
        WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY,
        WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE,
      );
    } catch {
      // The application remains locked to Stable V5 even without storage.
    }
    dispatchModeChange(WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE);
  }
  return WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE;
}

export function resetWeeklyPlanningRuntimeMode(): WeeklyPlanningRuntimeMode {
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY);
    } catch {
      // The application remains locked to Stable V5 even without storage.
    }
    dispatchModeChange(WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE);
  }
  return WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE;
}

export function resetWeeklyPlanningRuntimeModeForTest(): void {
  // No mutable application runtime override exists while Stable V5 is locked.
}

export function isWeeklyPlanningStableV5RuntimeEnabled(): boolean {
  return true;
}
