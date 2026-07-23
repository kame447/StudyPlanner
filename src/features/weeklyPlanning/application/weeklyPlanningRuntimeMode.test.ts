import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getWeeklyPlanningRuntimeMode,
  resetWeeklyPlanningRuntimeMode,
  resetWeeklyPlanningRuntimeModeForTest,
  setWeeklyPlanningRuntimeMode,
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

  it('defaults to legacy and persists Stable V5 in session storage', () => {
    const runtime = createWindow();
    vi.stubGlobal('window', runtime.window);

    expect(getWeeklyPlanningRuntimeMode()).toBe('legacy');
    expect(setWeeklyPlanningRuntimeMode('stable_v5')).toBe('stable_v5');
    expect(runtime.storage.get(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY)).toBe('stable_v5');
    expect(getWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(runtime.events.at(-1)?.type).toBe(WEEKLY_PLANNING_RUNTIME_MODE_CHANGE_EVENT);
  });

  it('uses the URL override and can reset the stored mode', () => {
    const runtime = createWindow('?weeklyPlanningRuntime=stable-v5');
    runtime.storage.set(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY, 'legacy');
    vi.stubGlobal('window', runtime.window);

    expect(getWeeklyPlanningRuntimeMode()).toBe('stable_v5');
    expect(resetWeeklyPlanningRuntimeMode()).toBe('legacy');
    expect(runtime.storage.has(WEEKLY_PLANNING_RUNTIME_MODE_STORAGE_KEY)).toBe(false);
  });
});
