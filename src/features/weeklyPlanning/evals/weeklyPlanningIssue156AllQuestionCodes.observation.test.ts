import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAiConfig } from '../../../lib/aiConfig';
import { createAiWeeklyPlanningStableV5DialogueRenderer } from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import type { WeeklyPlanningStableV5DialogueRenderInput } from '../dialogue/weeklyPlanningStableV5DialogueContracts';
import {
  questionIntentForStableV5Dialogue,
} from '../dialogue/weeklyPlanningStableV5DialogueContext';

const shouldRun = process.env.WEEKLY_PLANNING_ISSUE156_REAL_API === '1';
const outputDir = process.env.WEEKLY_PLANNING_ISSUE156_OUTPUT_DIR
  ?? 'artifacts/issue156-real-api';

type Target = Parameters<typeof questionIntentForStableV5Dialogue>[0]['questionTarget'];

const task = { id: 'task-1', category: 'study', title: 'レポート' };
const workload = {
  id: 'workload-1',
  taskId: 'task-1',
  componentId: null,
  quantityRole: 'completed',
  amount: 8,
  unitCode: 'page',
  unitLabel: 'ページ',
};
const unknownWorkload = { ...workload, id: 'workload-unknown', quantityRole: 'unknown', amount: 20 };

function renderInput(params: {
  code: string;
  user: string;
  target?: Target;
  effortMeasurement?: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  const target = params.target ?? null;
  const intent = questionIntentForStableV5Dialogue({
    questionCode: params.code,
    questionTarget: target,
    effortMeasurement: params.effortMeasurement ?? null,
  });
  return {
    actionId: `issue156:all:${params.code}`,
    currentUserMessage: params.user,
    recentConversation: [],
    planningInformation: null,
    currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
    actionKind: 'question',
    questionCode: params.code,
    questionTarget: target,
    questionIntent: intent,
    previewPromotionControlLabel: null,
    requiredLabels: [],
    fallbackText: '必要な情報を一つ教えてください。',
    previewCount: 0,
  };
}

const cases = [
  { code: 'missing_schedulable_work', user: 'レポートを終わらせたい', target: { collection: 'tasks', fact: task } as Target },
  { code: 'semantic_uncertainty', user: 'そこが曖昧です', target: { collection: 'uncertainties', fact: { id: 'u-1', field: 'workload', reason: 'ambiguous meaning' } } as Target },
  { code: 'invalid_planning_horizon', user: 'いつにしようかな' },
  { code: 'ambiguous_planning_window', user: '来週か週末がいいです' },
  { code: 'quantity_role_unresolved', user: '20ページです', target: { collection: 'workloads', fact: unknownWorkload } as Target },
  { code: 'missing_effort_estimate', user: '8ページ終わっています', target: { collection: 'workloads', fact: workload } as Target, effortMeasurement: 'total_duration' },
  { code: 'ambiguous_effort_estimate', user: 'たぶん1時間くらいです' },
  { code: 'missing_availability_date_scope', user: '14時から20時は空いてません', target: { collection: 'availabilityDeclarations', fact: { id: 'a-1', startTime: '14:00', endTime: '20:00' } } as Target },
  { code: 'missing_time_bounds', user: '明日はバイトです', target: { collection: 'availabilityDeclarations', fact: { id: 'a-2', dateExpression: 'tomorrow' } } as Target },
  { code: 'invalid_time_interval', user: '時間を間違えました', target: { collection: 'availabilityDeclarations', fact: { id: 'a-3', dateExpression: 'tomorrow' } } as Target },
  { code: 'named_time_period_unresolved', user: '夜にやります', target: { collection: 'availabilityDeclarations', fact: { id: 'a-4', namedTimePeriod: 'evening' } } as Target },
  { code: 'missing_commitment_date_scope', user: 'この時間は絶対です', target: { collection: 'temporalConstraints', fact: { id: 't-1', targetFactId: 'task-1' } } as Target },
  { code: 'invalid_commitment_interval', user: '時間帯を直します', target: { collection: 'temporalConstraints', fact: { id: 't-2', targetFactId: 'task-1' } } as Target },
  { code: 'conflicting_task_date_rule', user: 'その日はやるともやらないとも言いました', target: { collection: 'taskDateRules', fact: { id: 'd-1', taskId: 'task-1' } } as Target },
  { code: 'constraint_source_unavailable', user: 'カレンダーを使いたいです', target: { collection: 'constraintSourceRequests', fact: { id: 's-1', kind: 'calendar' } } as Target },
  { code: 'active_constraint_source_missing', user: '時間割を使ってください', target: { collection: 'constraintSourceRequests', fact: { id: 's-2', kind: 'timetable' } } as Target },
  { code: 'orphan_relation_task', user: 'レポートの後に練習したい' },
  { code: 'self_relation', user: 'レポートの後にレポートをやる、みたいな指定です' },
] as const;

const run = shouldRun ? describe : describe.skip;

run('Issue #156 all Stable V5 question-code real API matrix', () => {
  it('keeps every runtime question backed by a typed intent and fail-closes only on grounded safety checks', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig());
    const observations: Array<Record<string, unknown>> = [];
    for (const entry of cases) {
      const input = renderInput(entry);
      expect(input.questionIntent, entry.code).not.toBeNull();
      const result = await renderer.render(input);
      observations.push({ code: entry.code, intent: input.questionIntent, result });
    }

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/all-question-codes.json`,
      `${JSON.stringify(observations, null, 2)}\n`,
    );

    const unexpectedFallbacks = observations.filter((entry) => {
      const result = entry.result as { status?: string; reason?: string };
      return result.status === 'fallback' && result.reason !== 'ungrounded_text';
    });
    expect(unexpectedFallbacks).toEqual([]);
  }, 300_000);
});
