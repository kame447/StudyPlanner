import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWeeklyPlanningRuntimeMode,
  isWeeklyPlanningStableV5RuntimeEnabled,
  resetWeeklyPlanningRuntimeMode,
  resetWeeklyPlanningRuntimeModeForTest,
  setWeeklyPlanningRuntimeMode,
  WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE,
  WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
  WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY,
} from './weeklyPlanningRuntimeMode';

function createWindow(search = '') {
  const storage = new Map<string, string>();
  const events: Event[] = [];
  return {
    window: {
      location: { search },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      dispatchEvent: (event: Event) => {
        events.push(event);
        return true;
      },
    },
    storage,
    events,
  };
}

describe('weekly planning runtime mode', () => {
  beforeEach(() => {
    resetWeeklyPlanningRuntimeModeForTest();
    vi.stubGlobal('CustomEvent', class<T> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    });
  });

  afterEach(() => {
    resetWeeklyPlanningRuntimeModeForTest();
    vi.unstubAllGlobals();
  });

  it('locks the application runtime to Stable V5', () => {
    const runtime = createWindow();
    vi.stubGlobal('window', runtime.window);

    expect(getWeeklyPlanningRuntimeMode()).toBe(WEEKLY_PLANNING_APPLICATION_RUNTIME_MODE);
    expect(isWeeklyPlanningStableV5RuntimeEnabled()).toBe(true);

    expect(setWeeklyPlanningRuntimeMode('legacy')).toBe('stable_v5');
    expect(runtime.storage.get(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY)).toBe('stable_v5');
    expect(getWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(runtime.events[runtime.events.length - 1]?.type).toBe(
      WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT,
    );
  });

  it('ignores legacy URL and storage overrides and resets to Stable V5', () => {
    const runtime = createWindow('?weeklyPlanningRuntime=legacy');
    runtime.storage.set(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY, 'legacy');
    vi.stubGlobal('window', runtime.window);

    expect(getWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(isWeeklyPlanningStableV5RuntimeEnabled()).toBe(true);
    expect(resetWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(runtime.storage.has(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY)).toBe(false);
  });
});
