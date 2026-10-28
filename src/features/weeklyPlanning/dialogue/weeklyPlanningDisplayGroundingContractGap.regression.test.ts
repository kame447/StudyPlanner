import { describe, it, expect } from 'vitest';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

const renderInput: WeeklyPlanningStableV5DialogueRenderInput = {
  actionId: 'status-evidence', actionKind: 'status', questionCode: null,
  currentUserMessage: '数学90分と英語45分をやりたい', recentConversation: [],
  planningInformation: { tasks: [{ id: 'math', title: '数学' }, { id: 'english', title: '英語' }],
    effortEstimates: [
      { id: 'math-effort', taskId: 'math', targetFactId: 'math', kind: 'total_duration', minutes: 90, precision: 'exact' },
      { id: 'english-effort', taskId: 'english', targetFactId: 'english', kind: 'total_duration', minutes: 45, precision: 'exact' },
    ] },
  currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
  requiredLabels: [], fallbackText: '', previewCount: 0,
};

describe('Issue #876 structural display-grounding security boundary', () => {
  it('does not mistake the text validator for a guarantee about which task owns a duration', () => {
    const raw = JSON.stringify({ actionId: renderInput.actionId, actionKind: 'status', questionCode: null,
      groundingAcknowledgement: null, text: '英語は90分ですね。' });
    const result = parseWeeklyPlanningStableV5DialogueRendererResponse(raw, renderInput);
    expect(result.status).toBe('rendered');
    expect(renderInput.planningInformation?.effortEstimates).toMatchObject([
      { taskId: 'math', minutes: 90 }, { taskId: 'english', minutes: 45 },
    ]);
  });
  it('uses typed preview existence rather than requiring the model to quote a button label', () => {
    const preview = { ...renderInput, actionKind: 'preview_ready' as const,
      previewCount: 1, previewPromotionControlLabel: 'この内容で仮予定にする' };
    const raw = JSON.stringify({ actionId: preview.actionId, actionKind: 'preview_ready', questionCode: null,
      groundingAcknowledgement: null, text: '仮予定の候補を作成しました。内容をご確認ください。' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, preview).status).toBe('rendered');
  });

  it('still rejects a false save-completed claim even though prose is not a source of authorization', () => {
    const preview = { ...renderInput, actionKind: 'preview_ready' as const,
      previewCount: 1, previewPromotionControlLabel: 'この内容で仮予定にする' };
    const raw = JSON.stringify({ actionId: preview.actionId, actionKind: 'preview_ready', questionCode: null,
      groundingAcknowledgement: null, text: '予定を保存しました。' });
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, preview).status).toBe('fallback');
  });

});
