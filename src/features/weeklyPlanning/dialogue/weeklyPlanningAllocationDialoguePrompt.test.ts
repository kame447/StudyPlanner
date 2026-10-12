import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import type { WeeklyPlanningAllocationBreakdown } from '../semantic/weeklyPlanningAllocationBreakdown';

const breakdown: WeeklyPlanningAllocationBreakdown = {
  estimatedMinutes: 60, calibratedMinutes: 60, bufferedMinutes: 66, allocatedMinutes: 70,
  marginMinutes: 10, reasons: ['estimate_margin', 'rounding'],
};
function input(): WeeklyPlanningStableV5DialogueRenderInput & { allocationBreakdown?: WeeklyPlanningAllocationBreakdown } {
  return { actionId: 'allocation-prompt', currentUserMessage: '', recentConversation: [], planningInformation: null,
    actionKind: 'preview_ready', questionCode: null, requiredLabels: [], fallbackText: '', previewCount: 1, allocationBreakdown: breakdown };
}
describe('allocation disclosure request boundary', () => {
  it('keeps the optional numeric evidence compact without weakening factual ACK or promotion', () => {
    const withEvidence = createWeeklyPlanningStableV5DialoguePrompt(input());
    const without = createWeeklyPlanningStableV5DialoguePrompt({ ...input(), allocationBreakdown: undefined } as WeeklyPlanningStableV5DialogueRenderInput);
    const payload = JSON.parse(withEvidence.userPrompt);
    expect(payload.applicationDecision.allocationBreakdown).toEqual(breakdown);
    expect(payload.request).toContain('見積もり・余裕の内訳はUI表示に任せ');
    expect(payload.request).toContain('再計算');
    expect(payload.request).toContain('理由の推測');
    expect(payload.request).toContain('明示した具体値がある場合');
    expect(payload.request).toContain('previewPromotionControlLabel');
    const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
    expect(bytes(withEvidence.userPrompt) - bytes(without.userPrompt)).toBeLessThanOrEqual(650);
    expect(bytes(payload.request)).toBeLessThanOrEqual(4500);
  });
  it.each(['question', 'status', 'empty_preview', 'absent'] as const)('withholds summary and disclosure instruction for %s', mode => {
    const value = input();
    if (mode === 'question' || mode === 'status') value.actionKind = mode;
    if (mode === 'empty_preview') value.previewCount = 0;
    if (mode === 'absent') delete value.allocationBreakdown;
    const prompt = JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(value).userPrompt);
    expect(prompt.applicationDecision).not.toHaveProperty('allocationBreakdown');
    expect(prompt.request).not.toContain('見積もり・余裕の内訳はUI表示に任せ');
  });
});
