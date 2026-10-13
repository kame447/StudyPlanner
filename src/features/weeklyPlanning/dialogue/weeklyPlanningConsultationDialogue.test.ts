import { describe, expect, it } from 'vitest';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

function input(status: 'fits' | 'does_not_fit' | 'not_evaluated'): WeeklyPlanningStableV5DialogueRenderInput {
  return { actionId: 'consultation', currentUserMessage: '週末にまとめてはどう？', recentConversation: [],
    planningInformation: null, actionKind: 'status', questionCode: null, requiredLabels: [], fallbackText: '', previewCount: 0,
    communication: { goal: 'acknowledge_aside', askQuestion: false, alternativeRequiresAdoption: true,
      consultation: { mode: 'advisory_only', assessmentScope: 'proposed_days',
        alternative: { scope: 'task', taskIds: ['task'], taskLabels: ['研究メモ'], dates: ['2026-10-17', '2026-10-18'] },
        feasibility: status === 'not_evaluated' ? { status, reason: 'planning_details_missing' } : { status, basis: 'alternative_scheduler' },
        missingQuestionCodes: [], workEstimates: [], dailyLimits: [], nextAction: 'offer_alternative_adoption' } } };
}
function response(claim: unknown, text = '条件を確認しましょう。') {
  return JSON.stringify({ actionId: 'consultation', actionKind: 'status', questionCode: null,
    groundingAcknowledgement: null, feasibilityClaim: claim, text });
}
describe('consultation presentation uses only finite evaluation evidence', () => {
  it.each(['fits', 'does_not_fit', 'not_evaluated'] as const)('permits none or exactly the evaluated status %s', status => {
    for (const claim of ['none', 'fits', 'does_not_fit', 'unknown', undefined]) {
      const valid = claim === 'none' || (status !== 'not_evaluated' && claim === status);
      expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response(claim), input(status)).status)
        .toBe(valid ? 'rendered' : 'fallback');
    }
  });
  it('grounds dates only after this exact alternative was evaluated', () => {
    const raw = response('none', '10月17日と10月18日の条件を確認しましょう。');
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, input('fits')).status).toBe('rendered');
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(raw, input('not_evaluated'))).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
  it('does not turn a retained preview control into alternative adoption', () => {
    expect(parseWeeklyPlanningStableV5DialogueRendererResponse(response('fits', 'この内容で仮予定にするを押してください。'), input('fits')))
      .toMatchObject({ status: 'fallback', reason: 'unadopted_alternative_promotion' });
  });
});
