import { beforeEach, describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from './intake/weeklyPlanningIntakeReducer';
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

describe('weekly planning conversation persistence', () => {
  beforeEach(() => storedValues.clear());

  it('persists messages and intake state even when no draft exists', () => {
    const weekStartDate = '2026-07-13';
    const initial = createInitialPlanningState(weekStartDate);
    const withMessage = weeklyPlanningReducer(initial, {
      type: 'append_message',
      message: {
        id: 'message-1',
        role: 'user',
        content: '来週の予定を作りたい',
        createdAt: '2026-07-16T00:00:00.000Z',
      },
    });
    const intakeState = {
      ...createInitialPlanningIntakeState(),
      sourceTurns: ['来週の予定を作りたい'],
      assumptionProposalRecords: [{ proposalId: 'session-only' }] as never,
    };
    const withIntake = weeklyPlanningReducer(withMessage, {
      type: 'set_intake_state',
      state: intakeState,
    });

    saveWeeklyPlanningState('user', withIntake);
    const loaded = loadWeeklyPlanningState('user', weekStartDate);
    expect(loaded.messages).toEqual(withIntake.messages);
    expect(loaded.intakeState?.sourceTurns).toEqual(['来週の予定を作りたい']);
    expect(loaded.intakeState?.assumptionProposalRecords).toBeUndefined();
  });

  it('removes the stored conversation only after clear_conversation', () => {
    const weekStartDate = '2026-07-13';
    const withMessage = weeklyPlanningReducer(createInitialPlanningState(weekStartDate), {
      type: 'append_message',
      message: {
        id: 'message-1',
        role: 'user',
        content: '予定',
        createdAt: '2026-07-16T00:00:00.000Z',
      },
    });
    saveWeeklyPlanningState('user', withMessage);
    expect(loadWeeklyPlanningState('user', weekStartDate).messages).toHaveLength(1);

    const cleared = weeklyPlanningReducer(withMessage, { type: 'clear_conversation' });
    saveWeeklyPlanningState('user', cleared);
    expect(loadWeeklyPlanningState('user', weekStartDate).messages).toEqual([]);
  });
});
