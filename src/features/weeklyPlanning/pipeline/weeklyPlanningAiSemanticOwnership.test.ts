import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type {
  InterpreterStateSummary,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from './weeklyPlanningIntakePipeline';

const defaultInput = {
  planningStartDate: '2026-07-21',
  planningDayCount: 7,
  currentDateTime: '2026-07-21T16:24:00',
};

function previousTodayState(): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-21T16:24:00',
      endDateTime: '2026-07-21T24:00:00',
      sourceText: '今日の計画立てたい',
      calendarDayCount: 1,
      confidence: 'explicit',
    },
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: ['tasks_or_goals', 'fixed_events', 'sleep_cycle', 'meal_bath_constraints'],
    assumptions: [],
    uncertainties: [],
    questions: [],
    lastQuestionContext: {
      kind: 'missing',
      targetSlot: 'tasks_or_goals',
      intent: 'ask_tasks_or_goals',
    },
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: ['今日の計画立てたい'],
  };
}

describe('weekly planning AI semantic ownership', () => {
  it('keeps accepted state untouched before AI interpretation and accepts per-field workload commands', async () => {
    let receivedSummary: InterpreterStateSummary | undefined;
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      async interpretUserTurn({ stateSummary }) {
        receivedSummary = stateSummary;
        return {
          parseRejections: [],
          candidates: [
            {
              command: {
                type: 'set_exam_scope',
                scope: {
                  examType: '院試',
                  fields: ['OS', 'ネットワーク', 'ヒューマンサイエンス'],
                  totalFields: 3,
                  unitModel: 'year_field_chunk',
                  rawText: ['院試の過去問。OSとネットワークが一年分、ヒューマンサイエンスが二年分'],
                },
                sourceText: '院試の過去問終わらせたいです。OSとネットワークが一年分で、ヒューマンサイエンスが二年分あります',
                confidence: 'high',
              },
              origin: 'ai_interpreter',
              needsConfirmation: false,
            },
            ...[
              ['OS', 1],
              ['ネットワーク', 1],
              ['ヒューマンサイエンス', 2],
            ].map(([field, count]) => ({
              command: {
                type: 'mark_completion_target' as const,
                field: field as string,
                target: {
                  kind: 'latest_n_years' as const,
                  count: count as number,
                  rawText: `${field}が${count}年分`,
                },
                sourceText: `${field}が${count}年分`,
                confidence: 'high' as const,
              },
              origin: 'ai_interpreter' as const,
              needsConfirmation: false,
            })),
          ],
        };
      },
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultInput,
      previousState: previousTodayState(),
      userText: '院試の過去問終わらせたいです。OSとネットワークが一年分で、ヒューマンサイエンスが二年分あります。あと研究の進捗生まないといけないので、3時ぐらいまでは研究の内容やらないといけないです',
      interpreter,
    });

    expect(receivedSummary?.knownFields).toEqual([]);
    expect(receivedSummary?.planningRangeSummary).toBe('2026-07-21T16:24:00〜2026-07-21T24:00:00');
    expect(output.state.range).toEqual(previousTodayState().range);
    expect(output.state.examPrepScope?.fields).toEqual(['OS', 'ネットワーク', 'ヒューマンサイエンス']);
    expect(output.state.progress).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'OS', completionTarget: expect.objectContaining({ count: 1 }) }),
      expect.objectContaining({ field: 'ネットワーク', completionTarget: expect.objectContaining({ count: 1 }) }),
      expect.objectContaining({ field: 'ヒューマンサイエンス', completionTarget: expect.objectContaining({ count: 2 }) }),
    ]));
    expect(output.state.examPrepScope?.fields).not.toEqual(expect.arrayContaining([
      '研究の進捗生まない',
      'いけないので',
      'いけない',
    ]));
  });

  it('fails closed on an empty semantic result instead of continuing with deterministic dialogue', async () => {
    const previousState = previousTodayState();
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultInput,
      previousState,
      userText: 'それってどういうこと？',
      interpreter: {
        async interpretUserTurn() {
          return { candidates: [], parseRejections: [] };
        },
      },
    });

    expect(output.interpretationOutcome).toBe('failed');
    expect(output.stateMutationSource).toBe('none');
    expect(output.interpreterFailure?.category).toBe('invalid_response');
    expect(output.state.range).toEqual(previousState.range);
    expect(output.state.lastQuestionContext).toEqual(previousState.lastQuestionContext);
    expect(output.draftCandidates).toBeNull();
  });

  it('keeps semantic state unchanged after provider failure without invoking a parser', async () => {
    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      ...defaultInput,
      userText: '今日の計画立てたい',
      interpreter: {
        async interpretUserTurn() {
          throw new Error('provider unavailable');
        },
      },
    });

    expect(output.state.range).toBeUndefined();
    expect(output.state.intent).toBe('unknown');
    expect(output.interpretationOutcome).toBe('failed');
    expect(output.stateMutationSource).toBe('none');
    expect(output.interpreterFailure?.category).toBe('provider_error');
  });
});
