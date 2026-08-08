import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
  type WeeklyPlanningStableV5DialogueRenderInput,
} from './weeklyPlanningStableV5AiDialogueRenderer';

function missingWorkInput(): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:guardrail:missing_schedulable_work',
    currentUserMessage: '来週の勉強を進めたい',
    recentConversation: [],
    planningInformation: {
      tasks: [{ title: '学習タスク', category: 'study' }],
      workloads: [],
    },
    actionKind: 'question',
    questionCode: 'missing_schedulable_work',
    requiredLabels: ['学習タスク'],
    fallbackText: '作業量を確認します。',
    previewCount: 0,
  };
}

describe('Stable V5 dialogue planning guardrails', () => {
  it('asks for current range/progress before a new target when progress is unknown', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(missingWorkInput());

    expect(prompt.userPrompt).toContain(
      '全体の範囲と現在どこまで終わっているかを一つの確認として尋ねてください',
    );
    expect(prompt.userPrompt).toContain(
      '完了済み・現在位置がすでにdecidedFactsまたはrecentConversationから分かる場合に限って、次に今回の計画期間でどこまで進めたいかを尋ねてください',
    );
  });

  it('keeps progress questions unit-generic instead of hard-coding pages', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(missingWorkInput());

    for (const unit of ['問題数', '単語数', '章', '節', '回', '時間']) {
      expect(prompt.userPrompt).toContain(unit);
    }
    expect(prompt.userPrompt).toContain('ページに固定せず');
  });

  it('keeps typo repair semantic and scenario-independent', () => {
    const prompt = createWeeklyPlanningStableV5DialoguePrompt(missingWorkInput());

    expect(prompt.systemPrompt).toContain('誤字や崩れた文でも意味が一意なら自然に補正して理解');
    expect(prompt.systemPrompt).toContain('意味が複数通りあり得る場合は推測を事実として言い直さず');
    expect(prompt.systemPrompt).not.toContain('数楽');
    expect(prompt.systemPrompt).not.toContain('レボート');
    expect(prompt.systemPrompt).not.toContain('問代集');
  });
});