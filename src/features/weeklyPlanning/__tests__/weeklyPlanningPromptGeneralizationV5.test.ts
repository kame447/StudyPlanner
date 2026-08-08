import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from '../semantic/weeklyPlanningSemanticNormalizerV5';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
} from '../dialogue/weeklyPlanningStableV5AiDialogueRenderer';

const SCENARIO_WORDS = ['夏休み', '共通テスト', '数学が結構まずい'];

describe('Stable V5 prompt generalization contracts', () => {
  it('requires every provider task to classify planning granularity without scenario labels', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('Every task must classify decompositionStatus');
    expect(prompt).toContain('needs_breakdown');
    expect(prompt).toContain('collection, project, program, or category');
    for (const word of SCENARIO_WORDS) expect(prompt).not.toContain(word);

    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as any;
    const taskSchema = schema.properties.tasks.items;
    expect(taskSchema.required).toContain('decompositionStatus');
    expect(taskSchema.properties.decompositionStatus.enum).toEqual([
      'atomic',
      'decomposed',
      'needs_breakdown',
    ]);
  });

  it('states recurrence consistency as a generic cadence invariant', () => {
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '繰り返し学習したい',
      publicStateSummary: {},
    });
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    expect(system).toContain('Any explicit recurring cadence');
    expect(system).not.toContain('Explicit daily/weekdays/weekends repetition');
  });

  it('forbids regression-specific typo instructions while preserving generic ambiguity guards', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).not.toContain('Obvious spelling, kana/kanji, speech-input, or OCR noise');
    expect(prompt).not.toContain('Do not keep an obvious typo as the canonical entity name');
    expect(prompt).toContain('must have a uniquely supported semantic target');
    expect(prompt).toContain('more than one independently schedulable candidate');
    expect(prompt).toContain('do not assign, duplicate, distribute, or attach it by proximity');
    expect(prompt).not.toContain('数楽ワーク');
    expect(prompt).not.toContain('英語レボート');

    const dialogue = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'ambiguity-1',
      currentUserMessage: '入力が少し崩れています',
      recentConversation: [],
      planningInformation: {
        uncertainties: [{
          id: 'uncertainty-ambiguous',
          targetFactId: null,
          field: 'workload_target',
          reason: 'quantity target has multiple plausible readings',
          source: { sourceText: 'この部分' },
        }],
      },
      actionKind: 'question',
      questionCode: 'semantic_uncertainty',
      requiredLabels: [],
      fallbackText: '曖昧な部分だけ確認してください。',
      previewCount: 0,
    });
    expect(dialogue.systemPrompt).not.toContain('誤字や崩れた文でも意味が一意なら自然に補正');
    expect(dialogue.systemPrompt).not.toContain('明白な誤字をそのまま名称として繰り返さない');
    expect(dialogue.userPrompt).toContain('semantic_uncertaintyの場合はsourceTextとreasonを使い、意味を決め打ちせず');
    expect(dialogue.userPrompt).toContain('一つの確認だけ');
  });

  it('keeps breakdown and missing-quantity questions as distinct renderer intents', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt({
      actionId: 'action-1',
      currentUserMessage: '大きな作業を進めたいです。',
      recentConversation: [],
      planningInformation: {
        uncertainties: [{
          id: 'uncertainty-1',
          targetFactId: 'task-1',
          field: 'work_breakdown',
          reason: 'constituent work is not yet known',
          source: { sourceText: '大きな作業' },
        }],
      },
      actionKind: 'question',
      questionCode: 'semantic_uncertainty',
      requiredLabels: ['大きな作業'],
      fallbackText: '中身を教えてください。',
      previewCount: 0,
    });
    expect(prompt.systemPrompt).toContain('一度に複数の独立した回答を要求せず');
    expect(prompt.userPrompt).toContain('fieldがwork_breakdownの項目がある場合だけ');
    expect(prompt.userPrompt).toContain('questionCodeがmissing_schedulable_workの場合は追加の分解を求めません');
    expect(prompt.userPrompt).toContain('現在の全体範囲や進捗をまだ把握していないなら');
    expect(prompt.userPrompt).toContain('全体の範囲と現在どこまで終わっているか');
    expect(prompt.userPrompt).toContain('ページに固定せず');
    expect(prompt.userPrompt).toContain('問題数、単語数、章、節、回、時間');
    expect(prompt.userPrompt).toContain('完了済み・現在位置がすでにdecidedFactsまたはrecentConversationから分かる場合に限って');
    expect(prompt.userPrompt).toContain('今回の計画期間でどこまで進めたいか');
    expect(prompt.userPrompt).toContain('文型・列挙順・語句をコピーする必要はありません');
  });
});
