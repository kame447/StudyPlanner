import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialPlanningState, weeklyPlanningReducer } from './weeklyPlanningReducer';
import { loadWeeklyPlanningState, saveWeeklyPlanningState } from './weeklyPlanningStorage';

const storedValues = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storedValues.get(key) ?? null,
  setItem: (key: string, value: string) => { storedValues.set(key, value); },
  removeItem: (key: string) => { storedValues.delete(key); },
  clear: () => { storedValues.clear(); },
  key: (index: number) => Array.from(storedValues.keys())[index] ?? null,
  get length() { return storedValues.size; },
} as Storage;

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage: localStorageMock },
});

const USER_ID = 'user';
const WEEK_START = '2026-07-13';
const STORAGE_KEY = `studyplanner.weeklyPlanning.${USER_ID}.${WEEK_START}`;

describe('weekly planning storage validation', () => {
  beforeEach(() => storedValues.clear());

  it('rejects a future storage version instead of interpreting an unknown shape', () => {
    storedValues.set(STORAGE_KEY, JSON.stringify({
      version: 999,
      state: {
        weekStartDate: WEEK_START,
        revision: 20,
        mode: 'awaiting_approval',
        draftBlocks: [],
        messages: [{ role: 'unknown' }],
        updatedAt: 'future',
      },
    }));

    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);
    expect(loaded.revision).toBe(0);
    expect(loaded.messages).toEqual([]);
    expect(loaded.draftBlocks).toEqual([]);
  });

  it('rejects malformed persisted intake state as a whole', () => {
    storedValues.set(STORAGE_KEY, JSON.stringify({
      version: 2,
      state: {
        weekStartDate: WEEK_START,
        revision: 1,
        mode: 'collecting_tasks',
        draftBlocks: [],
        messages: [],
        intakeState: {
          status: 'draft_ready',
          intent: 'exam_prep_planning',
          missing: 'not-an-array',
        },
        updatedAt: '2026-07-16T00:00:00.000Z',
      },
    }));

    const loaded = loadWeeklyPlanningState(USER_ID, WEEK_START);
    expect(loaded.revision).toBe(0);
    expect(loaded.intakeState).toBeUndefined();
  });

  it('never persists in-flight request ownership', () => {
    const initial = createInitialPlanningState(WEEK_START);
    const pending = {
      requestId: 'request-1',
      weekStartDate: WEEK_START,
      baseRevision: initial.revision,
      startedAt: '2026-07-16T00:00:00.000Z',
    };
    const state = weeklyPlanningReducer(initial, {
      type: 'begin_turn',
      pending,
      userMessage: {
        id: 'message-1',
        role: 'user',
        content: '今週の予定を作りたい',
        createdAt: pending.startedAt,
      },
    });

    saveWeeklyPlanningState(USER_ID, state);
    const raw = storedValues.get(STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(raw).not.toContain('pendingTurn');
    expect(loadWeeklyPlanningState(USER_ID, WEEK_START).pendingTurn).toBeUndefined();
  });
});
