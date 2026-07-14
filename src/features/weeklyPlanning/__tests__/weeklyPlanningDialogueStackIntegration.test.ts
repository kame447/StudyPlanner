import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import { runWeeklyPlanningBehaviorAwarePipelineWithInterpreter } from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

const emptyInterpreter: WeeklyPlanningIntakeInterpreter = {
  async interpretUserTurn() {
    return { candidates: [], parseRejections: [] };
  },
};

function baseState() {
  return {
    ...createInitialPlanningIntakeState(),
    intent: 'weekly_study_planning' as const,
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:00',
      calendarDayCount: 7,
      confidence: 'explicit' as const,
      sourceText: '来週',
    },
    tasks: [
      {
        title: '英語',
        unit: 'pages' as const,
        amount: 10,
        rawText: '英語ワーク10ページ',
        requiresTimeEstimate: true,
        source: 'command' as const,
      },
      {
        title: '数学',
        unit: 'hours' as const,
        amount: 2,
        rawText: '数学2時間',
        requiresTimeEstimate: false,
        source: 'command' as const,
      },
    ],
    constraints: [{
      kind: 'fixed_event' as const,
      date: '2026-07-14',
      start: '18:00',
      end: '22:00',
      hardness: 'hard' as const,
      rawText: '火曜のバイト',
    }],
    assumptionProposalRecords: [{
      proposalId: 'proposal-duration-english',
      conversationId: 'conversation-1',
      slot: 'duration' as const,
      targetRef: 'task:0',
      proposedValue: 100,
      proposedUnit: 'minutes' as const,
      reasonCode: 'missing_duration' as const,
      sourceFactRefs: ['task:0'],
      createdAtTurnId: 'turn-2',
      createdFromStateRevision: 2,
      status: 'pending' as const,
    }],
    sourceTurns: ['来週の計画', '英語と数学を進めたい', '英語は100分くらいで仮置き'],
  };
}

function input(userText: string, previousState = baseState()) {
  return {
    userText,
    previousState,
    context: { selectedDate: '2026-07-12' },
    planningStartDate: '2026-07-13',
    planningDayCount: 7,
    interpreter: emptyInterpreter,
    sessionPolicy: { dayStartTime: '09:00', dayEndTime: '23:00' },
    existingPlans: [],
    scheduleTemplates: [],
    timetableTermId: 'default',
  };
}

describe('weekly planning dialogue stack integration', () => {
  it('accepts a pending assumption through interpreter decorator and persists the ledger in intake state', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('その仮定で進めて'),
      { conversationId: 'conversation-1', userId: 'user-1' },
    );

    expect(output.lifecycleDiagnostics?.acceptedDecisionCount).toBe(1);
    expect(output.state.assumptionProposalRecords?.[0]).toMatchObject({
      proposalId: 'proposal-duration-english',
      status: 'accepted',
    });
    expect(output.assumptionProposalState?.records.filter((record) => record.status === 'pending')).toHaveLength(0);
  });

  it('applies one task correction while preserving unrelated tasks and proposal history', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('数学は外して'),
      { conversationId: 'conversation-1', userId: 'user-1' },
    );

    expect(output.lifecycleDiagnostics?.acceptedCorrectionCount).toBe(1);
    expect(output.state.tasks.map((task) => task.title)).toEqual(['英語']);
    expect(output.state.assumptionProposalRecords?.[0].status).toBe('pending');
    expect(output.state.draftGenerationIntent).toBe('not_requested');
  });

  it('resolves an explicit relative commute into the behavior snapshot without inventing availability', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('バイトの後、帰宅10分して夕食'),
      { conversationId: 'conversation-1', userId: 'user-1' },
    );

    expect(output.behavior.snapshot.lifeActivityAnchors.some((anchor) =>
      anchor.kind === 'commute' && anchor.startTime === '22:00' && anchor.endTime === '22:10',
    )).toBe(true);
    expect(output.behavior.snapshot.readiness.resolvedDimensions).not.toContain('availability_basis');
  });

  it('adds feasibility clarification or adjustment to the finite allowed action set', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('この条件で入るか確認したい'),
      { conversationId: 'conversation-1', userId: 'user-1' },
    );

    expect(['unknown', 'partially_feasible', 'infeasible', 'feasible']).toContain(output.feasibility.classification);
    expect(output.behavior.actions.length).toBeLessThanOrEqual(3);
    expect(output.behavior.actions.some((action) =>
      action.topicId === 'feasibility_basis' || action.topicId === 'feasibility_adjustment',
    )).toBe(true);
  });
});
