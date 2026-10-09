import { describe, expect, it } from 'vitest';
import { communicationContextForStableV5Dialogue } from './dialogue/weeklyPlanningStableV5CommunicationContext';
import { createWeeklyPlanningStableV5DialoguePrompt } from './dialogue/weeklyPlanningStableV5DialoguePrompt';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './dialogue/weeklyPlanningStableV5DialogueContracts';

// Live D (「その分け方では進められません」) and X5 (the split echoed beside a one-block preview): the
// application states typed goals; the renderer instruction must keep the reply from characterising
// the request's feasibility or repeating a split the preview does not hold. Prompt-only, provisional.
function request(options: { outcome?: { kind: 'recover'; failure: 'semantic' }; actionKind: 'question' | 'preview_ready'; previewCount: number; architecture: 'interaction_v1' | 'legacy_v5' }): string {
  const questionIntent = null;
  const input: WeeklyPlanningStableV5DialogueRenderInput = {
    actionId: 'truth', currentUserMessage: 'synthetic message', recentConversation: [], planningInformation: null,
    actionKind: options.actionKind, questionCode: null, questionIntent,
    communication: communicationContextForStableV5Dialogue({ outcome: options.outcome as never, facts: undefined,
      actionKind: options.actionKind, questionCode: null, questionIntent }),
    requiredLabels: [], fallbackText: '', previewCount: options.previewCount, conversationArchitecture: options.architecture,
  };
  return (JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt) as { request: string }).request;
}

describe('renderer instructions that keep the reply truthful', () => {
  it('a recovery says nothing about the request being impossible', () => {
    const text = request({ outcome: { kind: 'recover', failure: 'semantic' }, actionKind: 'question', previewCount: 0, architecture: 'interaction_v1' });
    expect(text).toContain('goal=clarify_turn');
    expect(text).toContain('実現できるかどうかには触れない');
  });

  it('a preview announcement does not repeat a split when there is one block, and legacy is untouched', () => {
    const text = request({ actionKind: 'preview_ready', previewCount: 1, architecture: 'interaction_v1' });
    expect(text).toContain('goal=present_preview');
    expect(text).toContain('previewCount=1: 分割');
    expect(request({ actionKind: 'preview_ready', previewCount: 2, architecture: 'interaction_v1' })).not.toContain('previewCount=1: 分割');
    expect(request({ actionKind: 'preview_ready', previewCount: 1, architecture: 'legacy_v5' })).not.toContain('previewCount=1: 分割');
  });
});
