import { describe, expect, it } from 'vitest';
import {
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
  it('describes unknown work breakdown generically without scenario labels', () => {
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('field work_breakdown');
    expect(prompt).toContain('umbrella or category');
    for (const word of SCENARIO_WORDS) expect(prompt).not.toContain(word);
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

  it('tells the renderer to ask one answerable breakdown question before totals', () => {
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
    expect(prompt.userPrompt).toContain('fieldがwork_breakdown');
    expect(prompt.userPrompt).toContain('量や合計時間より先に');
    expect(prompt.userPrompt).toContain('文型・列挙順・語句をコピーする必要はありません');
  });
});
