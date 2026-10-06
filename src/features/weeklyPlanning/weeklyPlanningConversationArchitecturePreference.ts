import {
  WEEKLY_PLANNING_DEFAULT_CONVERSATION_ARCHITECTURE,
  isWeeklyPlanningConversationArchitecture,
  type WeeklyPlanningConversationArchitecture,
} from './weeklyPlanningConversationArchitecture';

/**
 * The ONE resolver of "which architecture does a NEW weekly-planning conversation get".
 * It is the only module that reads the build-time defaults and the browser preference;
 * downstream code receives the resolved value at the turn boundary.
 *
 * Inputs, in precedence order:
 * 1. the local browser preference, honoured ONLY while the evaluation gate is enabled
 *    (`VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED=1`), so a stale evaluation
 *    preference can never leak into a build where the selector is not visible;
 * 2. the optional build default `VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT`
 *    (`legacy_v5` | `interaction_v1`; anything else is ignored);
 * 3. `interaction_v1`.
 *
 * The preference is a per-device convenience for NEW conversations. It is not planning
 * truth: an existing conversation keeps the architecture it was pinned to
 * (`PlanningState.conversationArchitecture`) whatever this value becomes.
 */
export const WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY =
  'studyplanner.weeklyPlanning.conversationArchitecturePreference.v1';

// Static `import.meta.env.VITE_*` references (not dynamic keys) so the bundler can inline them.
function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export function isWeeklyPlanningArchitectureSwitchEnabled(): boolean {
  const flag = trimmed(import.meta.env.VITE_WEEKLY_PLANNING_ARCHITECTURE_SWITCH_ENABLED);
  return flag === '1' || flag === 'true';
}

function buildDefaultArchitecture(): WeeklyPlanningConversationArchitecture {
  const configured = trimmed(import.meta.env.VITE_WEEKLY_PLANNING_CONVERSATION_ARCHITECTURE_DEFAULT);
  return isWeeklyPlanningConversationArchitecture(configured)
    ? configured
    : WEEKLY_PLANNING_DEFAULT_CONVERSATION_ARCHITECTURE;
}

function readStoredPreference(): WeeklyPlanningConversationArchitecture | null {
  try {
    const raw = typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 2 || record.version !== 1) return null;
    return isWeeklyPlanningConversationArchitecture(record.architecture)
      ? record.architecture
      : null;
  } catch {
    return null;
  }
}

/** Architecture a conversation created now would be pinned to. */
export function resolveNewConversationArchitecture(): WeeklyPlanningConversationArchitecture {
  const stored = isWeeklyPlanningArchitectureSwitchEnabled() ? readStoredPreference() : null;
  return stored ?? buildDefaultArchitecture();
}

const listeners = new Set<() => void>();

/** Persists the preference for NEW conversations. Returns false when it could not be stored. */
export function setWeeklyPlanningArchitecturePreference(
  architecture: WeeklyPlanningConversationArchitecture | null,
): boolean {
  if (!isWeeklyPlanningArchitectureSwitchEnabled()) return false;
  try {
    if (architecture === null) {
      window.localStorage.removeItem(WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        WEEKLY_PLANNING_ARCHITECTURE_PREFERENCE_STORAGE_KEY,
        JSON.stringify({ version: 1, architecture }),
      );
    }
  } catch {
    return false;
  } finally {
    listeners.forEach((listener) => listener());
  }
  return true;
}

export function subscribeWeeklyPlanningArchitecturePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
