import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createFocusedContextualBindingInputFixtureV5 } from './weeklyPlanningFocusedContextualBindingV5.testUtils';
import { parseMachineBoundEffortAnswerV5 } from './weeklyPlanningMachineBoundEffortParserV5';
import { tryFocusedContextualAnswerRouteV5 } from './weeklyPlanningSemanticFocusedPreRoutesV5';
import { WeeklyPlanningSemanticNormalizerRunV5 } from './weeklyPlanningSemanticNormalizerRunV5';

const total = { measurement: 'total_duration' as const, unitCode: 'problem' as const };
const perProblem = { measurement: 'duration_per_unit' as const, unitCode: 'problem' as const };

describe('machine-bound effort grammar: full utterance or fall back', () => {
  it.each([
    ['30分', total, 30, 'exact'],
    ['３０分です。', total, 30, 'exact'],
    ['約30分', total, 30, 'approximate'],
    ['だいたい1時間半くらいです。', total, 90, 'approximate'],
    ['全部で1時間30分', total, 90, 'exact'],
    ['合計で0.5時間', total, 30, 'exact'],
    ['1問5分', perProblem, 5, 'exact'],
    ['1問5分ペース', perProblem, 5, 'exact'],
    ['大体1問3分ぐらい', perProblem, 3, 'approximate'],
    ['7分程度です', perProblem, 7, 'approximate'],
  ] as const)('parses only the supported full sentence: %s', (userText, context, minutes, precision) => {
    expect(parseMachineBoundEffortAnswerV5({ userText, ...context })).toMatchObject({
      decision: 'effort_answer', effortTarget: 'question_target',
      effortMeasurement: context.measurement, minutes, precision, quantityRole: null,
    });
  });

  it.each([
    ['30分、あと英語も追加して', total],
    ['30分で保存して', total],
    ['30分じゃない', total],
    ['30分かもしれない', total],
    ['何分だっけ', total],
    ['多分30分かな', total],
    ['30分から40分', total],
    ['30分か1時間', total],
    ['30分と20分', total],
    ['1問5分', total],
    ['合計30分', perProblem],
    ['2問5分', perProblem],
    ['1問5分。あと掃除', perProblem],
    ['1問5分です。。', perProblem],
    ['5分\n新しいタスク', perProblem],
    ['1時間70分', total],
    ['1.5時間半', total],
    ['0分', total],
    ['0.1分', total],
    ['9999分', total],
    ['一時間くらい', total],
  ] as const)('declines extra or unsupported meaning: %s', (userText, context) => {
    expect(parseMachineBoundEffortAnswerV5({ userText, ...context })).toBeNull();
  });
});

function boundEffortInput(userText: string) {
  const input = createFocusedContextualBindingInputFixtureV5(undefined, userText);
  input.publicStateSummary!.pendingQuestion = {
    actionId: 'j1-question-8',
    questionCode: 'missing_effort_estimate',
    targetFactId: 'workload-private-id',
    graphRevision: 8,
    effortMeasurement: 'duration_per_unit',
  };
  return input;
}

describe('provider-free fast path or unchanged Jev/Luna fallback', () => {
  it('accepts a fully bound per-problem answer with zero AI dispatches and original evidence', async () => {
    const createChatCompletion = vi.fn(async () => {
      throw new Error('Provider must not be called for this bound answer.');
    });
    const client: OpenAiCompatibleClient = { createChatCompletion };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize(
      boundEffortInput('1問5分くらい'),
    );
    expect(result.status).toBe('accepted');
    expect(result.diagnostics).toMatchObject({
      attemptCount: 0,
      providerDispatch: { count: 0, anyFailure: false, complete: true },
    });
    expect(result.document?.tasks[0].effortEstimates).toEqual([
      expect.objectContaining({
        targetLocalId: 'workload-private-id',
        kind: 'duration_per_unit',
        minutes: 5,
        precision: 'approximate',
        unitCode: 'problem',
        sourceText: '1問5分くらい',
      }),
    ]);
    expect(createChatCompletion).not.toHaveBeenCalled();
  });

  it('retains the existing focused AI route for a mixed instruction', async () => {
    const createChatCompletion = vi.fn(async () => JSON.stringify({
      decision: 'fallback', effortTarget: null, effortMeasurement: null,
      minutes: null, precision: null, quantityRole: null,
    }));
    const result = await tryFocusedContextualAnswerRouteV5(
      new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion }, boundEffortInput('5分、あと英語も追加して')),
    );
    expect(result).toBeNull();
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('never bypasses AI for a missing or stale committed graph', async () => {
    const createChatCompletion = vi.fn(async () => JSON.stringify({
      decision: 'effort_answer', effortTarget: 'question_target',
      effortMeasurement: 'duration_per_unit', minutes: 5,
      precision: 'exact', quantityRole: null,
    }));
    const input = boundEffortInput('1問5分');
    delete input.committedGraph;
    const result = await tryFocusedContextualAnswerRouteV5(
      new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion }, input),
    );
    expect(result?.status).toBe('accepted');
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });

  it('does not parse when the pending measurement has not been resolved', async () => {
    const createChatCompletion = vi.fn(async () => JSON.stringify({
      decision: 'effort_answer', effortTarget: 'question_target',
      effortMeasurement: 'duration_per_unit', minutes: 5,
      precision: 'exact', quantityRole: null,
    }));
    const input = boundEffortInput('1問5分');
    delete (input.publicStateSummary!.pendingQuestion as Record<string, unknown>).effortMeasurement;
    await tryFocusedContextualAnswerRouteV5(
      new WeeklyPlanningSemanticNormalizerRunV5({ createChatCompletion }, input),
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(1);
  });
});
