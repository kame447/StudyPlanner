import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWeeklyPlanningIntakePipeline } from './pipeline/weeklyPlanningIntakePipeline';
import { loadWeeklyPlanningState } from './weeklyPlanningStorage';
import type { PlanningState } from './types';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const userId = 'pending-range-storage-user';
const weekStartDate = '2026-07-13';
const storageKey = `studyplanner.weeklyPlanning.${userId}.${weekStartDate}`;

const summerScope = {
  kind: 'named_future_period' as const,
  label: '夏休み',
  windowStartDate: '2026-07-20',
  windowEndDate: '2026-08-31',
};

function storedState(pendingPlanningRange: Record<string, unknown>): PlanningState {
  return {
    weekStartDate,
    revision: 1,
    mode: 'collecting_tasks',
    draftBlocks: [],
    previewCandidates: [],
    messages: [],
    intakeState: {
      status: 'needs_scope',
      intent: 'weekly_study_planning',
      pendingPlanningRange: pendingPlanningRange as never,
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: [],
      shouldCreateDraft: false,
      shouldSavePlan: false,
      sourceTurns: ['夏休みに計画を立てたい'],
    },
    updatedAt: '2026-07-17T12:00:00.000Z',
  };
}

function writeStoredState(
  state: PlanningState,
  format: 'v2' | 'legacy',
): void {
  const value = format === 'v2'
    ? { version: 2, state }
    : state;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function continueTurn(state: PlanningState, userText: string) {
  return runWeeklyPlanningIntakePipeline({
    previousState: state.intakeState,
    userText,
    planningStartDate: '2026-07-17',
    planningDayCount: 7,
    currentDateTime: '2026-07-17T12:00:00',
  });
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(['v2', 'legacy'] as const)(
  'pending range storage continuation: %s',
  (format) => {
    it('reloads a selected start and promotes after duration input', () => {
      writeStoredState(storedState({
        scope: summerScope,
        planningStartDate: '2026-08-01',
        sourceText: '8月1日から',
      }), format);

      const loaded = loadWeeklyPlanningState(userId, weekStartDate);
      expect(loaded.intakeState?.pendingPlanningRange?.planningStartDate)
        .toBe('2026-08-01');

      const result = continueTurn(loaded, '一週間');
      expect(result.state.range?.startDateTime).toBe('2026-08-01T00:00:00');
      expect(result.state.range?.endDateTime).toBe('2026-08-07T24:00:00');
      expect(result.state.pendingPlanningRange).toBeUndefined();
    });

    it('reloads duration and promotes after selected start input', () => {
      writeStoredState(storedState({
        scope: summerScope,
        durationDays: 7,
        sourceText: '一週間',
      }), format);

      const loaded = loadWeeklyPlanningState(userId, weekStartDate);
      expect(loaded.intakeState?.pendingPlanningRange?.durationDays).toBe(7);

      const result = continueTurn(loaded, '8月1日から');
      expect(result.state.range?.startDateTime).toBe('2026-08-01T00:00:00');
      expect(result.state.range?.endDateTime).toBe('2026-08-07T24:00:00');
      expect(result.state.pendingPlanningRange).toBeUndefined();
    });
  },
);

describe('invalid pending range storage', () => {
  it.each([
    { scope: summerScope, planningStartDate: 'not-a-date', sourceText: 'bad' },
    { scope: summerScope, planningStartDate: '2026-02-30', sourceText: 'bad' },
    {
      scope: {
        ...summerScope,
        windowStartDate: '2026-09-01',
        windowEndDate: '2026-08-31',
      },
      sourceText: 'bad',
    },
    { scope: summerScope, planningStartDate: '2026-10-01', sourceText: 'bad' },
    { scope: summerScope, durationDays: 0, sourceText: 'bad' },
    { scope: summerScope, durationDays: -1, sourceText: 'bad' },
    { scope: summerScope, durationDays: 1.5, sourceText: 'bad' },
    {
      scope: summerScope,
      planningStartDate: '2026-08-01',
      durationDays: 7,
      sourceText: 'resolved-pending',
    },
    {
      scope: {
        kind: 'named_future_period',
        label: '夏休み',
        startDate: '2026-07-20',
        endDate: '2026-08-31',
      },
      sourceText: 'legacy-ambiguous-shape',
    },
  ])('rejects malformed pending state: %#', (pending) => {
    writeStoredState(storedState(pending), 'v2');

    const loaded = loadWeeklyPlanningState(userId, weekStartDate);
    expect(loaded.intakeState).toBeUndefined();
  });

  it.each([
    {
      startDateTime: 'not-a-dateT00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      confidence: 'explicit',
    },
    {
      startDateTime: '2026-02-30T00:00:00',
      endDateTime: '2026-03-01T24:00:00',
      confidence: 'explicit',
    },
    {
      startDateTime: '2026-08-08T00:00:00',
      endDateTime: '2026-08-07T24:00:00',
      confidence: 'explicit',
    },
  ])('rejects invalid concrete range: %#', (range) => {
    const state = storedState({
      scope: summerScope,
      sourceText: 'placeholder',
    });
    state.intakeState = {
      ...state.intakeState!,
      pendingPlanningRange: undefined,
      range: range as never,
    };
    writeStoredState(state, 'v2');

    const loaded = loadWeeklyPlanningState(userId, weekStartDate);
    expect(loaded.intakeState).toBeUndefined();
  });
});
