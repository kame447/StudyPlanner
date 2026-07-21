import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runWeeklyPlanningBehaviorAwarePipeline,
  type BehaviorAwareDialoguePlanner,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';
import { createInMemoryWeeklyPlanningTraceRepository } from './weeklyPlanningTraceInMemoryRepository';
import { setWeeklyPlanningTraceRepositoryForTests } from './weeklyPlanningTraceRepository';
import { resetWeeklyPlanningTraceRuntimeForTests } from './weeklyPlanningTraceRuntime';

const dialoguePlanner: BehaviorAwareDialoguePlanner = {
  async plan() {
    return {
      message: '計画したい学習内容や目標を教えてください。',
      response: null,
      source: 'deterministic_fallback',
    };
  },
};

async function waitForSession(
  repository: ReturnType<typeof createInMemoryWeeklyPlanningTraceRepository>,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const sessions = await repository.listSessionsForAdmin();
    if (sessions[0]) return sessions[0];
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('trace session was not persisted');
}

describe('weekly planning trace runtime range contract', () => {
  beforeEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
  });

  afterEach(() => {
    resetWeeklyPlanningTraceRuntimeForTests();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
  });

  it('uses the selected date as a date-only range while the conversational range is unresolved', async () => {
    const repository = createInMemoryWeeklyPlanningTraceRepository();
    setWeeklyPlanningTraceRepositoryForTests(repository);

    await runWeeklyPlanningBehaviorAwarePipeline({
      userText: '予定を作りたい',
      planningStartDate: '2026-07-15',
      planningDayCount: 7,
      currentDateTime: '2026-07-15T12:00:00',
      existingPlans: [],
      scheduleTemplates: [],
    }, {
      userId: 'user-1',
      dialoguePlanner,
    });

    const session = await waitForSession(repository);
    expect(session.status).toBe('active');
    expect(session.planningRangeStart).toBe('2026-07-15');
    expect(session.planningRangeEnd).toBeUndefined();
    expect(session.entryCount).toBeGreaterThan(0);
  });
});
