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

function input(params: {
  actionId: string;
  questionCode: string;
  currentUserMessage: string;
  previousAssistant: string;
  target: { collection: string; fact: Record<string, unknown> } | null;
  fallbackText: string;
}): WeeklyPlanningStableV5DialogueRenderInput {
  const questionIntent = questionIntentForStableV5Dialogue({
    questionCode: params.questionCode,
    questionTarget: params.target,
  });
  return {
    actionId: params.actionId,
    currentUserMessage: params.currentUserMessage,
    recentConversation: [
      { role: 'assistant', content: params.previousAssistant },
      { role: 'user', content: params.currentUserMessage },
    ],
    planningInformation: null,
    currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
    actionKind: 'question',
    questionCode: params.questionCode,
    questionTarget: params.target,
    questionIntent,
    previewPromotionControlLabel: null,
    requiredLabels: [],
    fallbackText: params.fallbackText,
    previewCount: 0,
  };
}

const run = shouldRun ? describe : describe.skip;

run('Issue #156 typed renderer real API stress matrix', () => {
  it('preserves quantity-role and relation meaning across repeated Luna generations', async () => {
    const renderer = createAiWeeklyPlanningStableV5DialogueRenderer(getAiConfig());
    const observations: Array<Record<string, unknown>> = [];

    const quantityVariants = [
      '20ページです',
      'だいたい20ページくらい',
      '20ページあります',
      '量は20ページですね',
      'ページ数なら20です',
    ];
    for (let i = 0; i < quantityVariants.length; i += 1) {
      const workload = {
        id: `workload-${i}`,
        taskId: 'task-report',
        componentId: null,
        quantityRole: 'unknown',
        amount: 20,
        unitCode: 'page',
        unitLabel: 'ページ',
      };
      const renderInput = input({
        actionId: `issue156:quantity:${i}`,
        questionCode: 'quantity_role_unresolved',
        currentUserMessage: quantityVariants[i],
        previousAssistant: 'レポートの量を教えてください。',
        target: { collection: 'workloads', fact: workload },
        fallbackText: '20ページは今回進めたい量ですか、それとも残っている全体量ですか？',
      });
      const result = await renderer.render(renderInput);
      observations.push({ kind: 'quantity_role', variant: quantityVariants[i], intent: renderInput.questionIntent, result });
      expect(result.status).toBe('rendered');
      if (result.status === 'rendered') {
        expect(result.text, `quantity variant ${i + 1}`).toMatch(/今回|この予定|この計画/);
        expect(result.text, `quantity variant ${i + 1}`).toMatch(/残|未完了/);
        expect(result.text, `quantity variant ${i + 1}`).not.toMatch(/1回分|1回あたり/);
      }
    }

    const relationVariants = [
      'レポートの後に発表練習をしたい',
      '資料作成のあとで練習したい',
      '課題Aが終わってから課題Bをやりたい',
      '先にレポート、その後に復習です',
      '発表準備は資料の後に進めたいです',
    ];
    for (let i = 0; i < relationVariants.length; i += 1) {
      const renderInput = input({
        actionId: `issue156:relation:${i}`,
        questionCode: 'orphan_relation_task',
        currentUserMessage: relationVariants[i],
        previousAssistant: '順番の希望があれば教えてください。',
        target: null,
        fallbackText: '順序関係の対象を確認できませんでした。どの予定をどの順番にするか教えてください。',
      });
      const result = await renderer.render(renderInput);
      observations.push({ kind: 'task_relation', variant: relationVariants[i], intent: renderInput.questionIntent, result });
      expect(result.status).toBe('rendered');
      if (result.status === 'rendered') {
        expect(result.text, `relation variant ${i + 1}`).not.toMatch(/追加しますか|追加する|登録しますか/);
      }
    }

    const genericCases: Array<Parameters<typeof input>[0]> = [
      {
        actionId: 'issue156:uncertainty',
        questionCode: 'semantic_uncertainty',
        currentUserMessage: 'そこが曖昧です',
        previousAssistant: '作業量について確認しています。',
        target: { collection: 'uncertainties', fact: { id: 'unc-1', field: 'workload', reason: 'amount role ambiguous' } },
        fallbackText: '曖昧な意味をもう少し具体的に教えてください。',
      },
      {
        actionId: 'issue156:availability-date',
        questionCode: 'missing_availability_date_scope',
        currentUserMessage: '14時から20時は空いてません',
        previousAssistant: '固定予定はありますか？',
        target: { collection: 'availabilityDeclarations', fact: { id: 'a-1', startTime: '14:00', endTime: '20:00' } },
        fallbackText: 'その時間条件はどの日ですか？',
      },
      {
        actionId: 'issue156:availability-time',
        questionCode: 'missing_time_bounds',
        currentUserMessage: '明日はバイトです',
        previousAssistant: '固定予定はありますか？',
        target: { collection: 'availabilityDeclarations', fact: { id: 'a-2', dateExpression: 'tomorrow' } },
        fallbackText: '開始時刻と終了時刻を教えてください。',
      },
      {
        actionId: 'issue156:planning-window',
        questionCode: 'ambiguous_planning_window',
        currentUserMessage: '来週か週末かな',
        previousAssistant: 'いつの予定ですか？',
        target: null,
        fallbackText: '今回使う計画期間を一つ教えてください。',
      },
    ];
    for (const generic of genericCases) {
      const renderInput = input(generic);
      const result = await renderer.render(renderInput);
      observations.push({ kind: generic.questionCode, intent: renderInput.questionIntent, result });
      expect(renderInput.questionIntent).not.toBeNull();
      expect(result.status, generic.questionCode).toBe('rendered');
    }

    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      `${outputDir}/typed-renderer-stress.json`,
      `${JSON.stringify(observations, null, 2)}\n`,
    );
  }, 240_000);
});
