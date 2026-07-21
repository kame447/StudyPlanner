import { describe, expect, it } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type {
  WeeklyPlanningIntakeInterpreter,
  WeeklyPlanningInterpreterResult,
} from '../intake/weeklyPlanningInterpreterTypes';
import { runWeeklyPlanningBehaviorAwarePipelineWithInterpreter } from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

const emptyInterpreter: WeeklyPlanningIntakeInterpreter = {
  async interpretUserTurn() {
    return { candidates: [], parseRejections: [] };
  },
};

function lifecycleInterpreter(
  lifecycleResult: Pick<WeeklyPlanningInterpreterResult, 'assumptionDecisions' | 'correctionEnvelopes'>,
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn() {
      return {
        candidates: [],
        parseRejections: [],
        ...lifecycleResult,
      };
    },
  };
}

function baseState(): PlanningIntakeState {
  return {
    ...createInitialPlanningIntakeState(),
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:00',
      calendarDayCount: 7,
      confidence: 'explicit',
      sourceText: '来週',
    },
    tasks: [
      {
        title: '英語',
        unit: 'pages',
        amount: 10,
        rawText: '英語ワーク10ページ',
        requiresTimeEstimate: true,
        source: 'command',
      },
      {
        title: '数学',
        unit: 'hours',
        amount: 2,
        rawText: '数学2時間',
        requiresTimeEstimate: false,
        source: 'command',
      },
    ],
    constraints: [{
      kind: 'fixed_event',
      date: '2026-07-14',
      start: '18:00',
      end: '22:00',
      hardness: 'hard',
      rawText: '火曜のバイト',
    }],
    assumptionProposalRecords: [{
      proposalId: 'proposal-duration-english',
      conversationId: 'conversation-1',
      slot: 'duration',
      targetRef: 'task:0',
      proposedValue: 100,
      proposedUnit: 'minutes',
      reasonCode: 'missing_duration',
      sourceFactRefs: ['task:0'],
      createdAtTurnId: 'turn-2',
      createdFromStateRevision: 2,
      status: 'pending',
    }],
    sourceTurns: ['来週の計画', '英語と数学を進めたい', '英語は100分くらいで仮置き'],
  };
}

function input(
  userText: string,
  previousState: PlanningIntakeState = baseState(),
  interpreter: WeeklyPlanningIntakeInterpreter = emptyInterpreter,
) {
  return {
    userText,
    previousState,
    context: { selectedDate: '2026-07-12' },
    planningStartDate: '2026-07-13',
    planningDayCount: 7,
    interpreter,
    sessionPolicy: { dayStartTime: '09:00', dayEndTime: '23:00' },
    existingPlans: [],
    scheduleTemplates: [],
    timetableTermId: 'default',
  };
}

describe('weekly planning dialogue stack integration', () => {
  it('accepts a pending assumption through interpreter decorator and persists the ledger in intake state', async () => {
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('その仮定で進めて', baseState(), lifecycleInterpreter({
        assumptionDecisions: [{
          type: 'accept_assumption',
          proposalId: 'proposal-duration-english',
          confidence: 'high',
        }],
      })),
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
      input('数学は外して', baseState(), lifecycleInterpreter({
        correctionEnvelopes: [{
          operation: 'remove',
          targetKind: 'task',
          targetRef: 'task:1',
          confidence: 'high',
        }],
      })),
      { conversationId: 'conversation-1', userId: 'user-1' },
    );

    expect(output.lifecycleDiagnostics?.acceptedCorrectionCount).toBe(1);
    expect(output.state.tasks.map((task) => task.title)).toEqual(['英語']);
    expect(output.state.assumptionProposalRecords?.[0].status).toBe('pending');
    expect(output.state.draftGenerationIntent).toBe('not_requested');
  });

  it('resolves an explicit relative commute into the behavior snapshot without inventing availability', async () => {
    const userText = 'バイトの後、帰宅10分して夕食';
    const relativeInterpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn() {
        return {
          candidates: [{
            command: {
              type: 'add_relative_constraint',
              anchorRef: 'constraint:0',
              relation: 'after',
              offsetMinutes: 0,
              durationMinutes: 10,
              kind: 'commute',
              sourceText: userText,
              confidence: 'high',
            },
            origin: 'ai_interpreter',
            needsConfirmation: false,
            sourceUserText: userText,
          }],
          parseRejections: [],
        };
      },
    };
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input(userText, baseState(), relativeInterpreter),
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

  it('records assistant_suggested without generating preview before explicit authorization', async () => {
    const readyState: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      intent: 'weekly_study_planning',
      range: {
        startDateTime: '2026-07-13T00:00:00',
        endDateTime: '2026-07-19T23:59:00',
        calendarDayCount: 7,
        confidence: 'explicit',
        sourceText: '来週',
      },
      tasks: [{
        title: '英単語',
        unit: 'hours',
        amount: 1,
        rawText: '英単語を1時間',
        executionProfile: {
          activityKind: 'memorization',
          distributionPolicy: 'spaced',
          cognitiveLoad: 'light',
        },
        requiresTimeEstimate: false,
        source: 'command',
      }],
      constraints: [{
        kind: 'buffer',
        studyAvailableStart: '17:30',
        hardness: 'soft',
        rawText: '17時30分以降なら勉強できる',
      }],
      sourceTurns: ['来週の計画', '英単語を1時間', '17時30分以降なら勉強できる'],
    };
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter(
      input('この内容でどう進めるのがよさそう？', readyState),
      { conversationId: 'conversation-ready', userId: 'user-1' },
    );

    expect(output.state.draftGenerationIntent).toBe('assistant_suggested');
    expect(output.behavior.gate.allowed).toBe(false);
    expect(output.draftCandidates).toBeNull();
    expect(output.behavior.actions.some((action) => action.kind === 'suggest_draft_generation')).toBe(true);
  });
});
