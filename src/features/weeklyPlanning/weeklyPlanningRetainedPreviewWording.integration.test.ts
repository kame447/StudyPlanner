import './application/weeklyPlanningStableV5InstrumentedRuntimeExecutor';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as rendererAdapter from './dialogue/weeklyPlanningStableV5AiDialogueRenderer';
import { WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT } from './dialogue/weeklyPlanningInteractionFallbackText';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime, scriptedRendererReply } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { eventDocument, eventRendererReply, eventStudyTask } from './testUtils/weeklyPlanningFixedEventOnlyFixture';

type Json = Record<string, unknown>;
const CONTROL = 'この内容で仮予定にする';
const INITIAL = '来週、数学を20分勉強する';
const CONSULT = '週末にまとめるのはどう？';
let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
afterEach(() => { vi.restoreAllMocks(); provider?.restore(); resetScriptedConversationRuntime(); });

function initial() {
  return eventDocument({ planningIntent: 'create_plan', planningWindow: {
    localId: 'week', kind: 'relative_week', value: 'next_week', start: null, end: null, sourceText: '来週',
  }, tasks: [eventStudyTask()], conversationActs: [] });
}

describe('R28 retained-preview wording through the controller', () => {
  it.each(['different', 'same'] as const)('compares the %s alternative only from typed task/date state', async relation => {
    let consulting = false;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') return consulting
        ? JSON.stringify({ ...JSON.parse(scriptedRendererReply(call, `今の候補でよければ「${CONTROL}」を押してください。`)), feasibilityClaim: 'fits' })
        : eventRendererReply(call);
      if (!consulting) return JSON.stringify(initial());
      const tasks = (call.payload!.publicStateSummary as Json).tasks as Json[];
      return JSON.stringify(eventDocument({ conversationActs: [{ kind: 'consultation_request', targetPublicId: tasks[0].publicId,
        placementAlternative: { scope: 'task', dateExpressions: relation === 'different'
          ? ['weekday:saturday', 'weekday:sunday'] : ['weekday:monday', 'weekday:tuesday'], sourceText: CONSULT },
      }] }));
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2030-01-07', now: () => '2030-01-01T00:00:00.000Z' });
    await conversation.submit(INITIAL);
    const graphBefore = structuredClone(conversation.graph());
    const previewBefore = structuredClone(conversation.getState().previewCandidates);
    expect(previewBefore?.length).toBeGreaterThan(0);
    consulting = true;
    const turn = await conversation.submit(CONSULT);
    expect(turn.result?.failure).toBeUndefined();
    const renderers = turn.calls.filter(call => call.kind === 'renderer');
    expect(turn.calls.map(call => call.kind)).toEqual(relation === 'different'
      ? ['semantic_generic', 'renderer', 'renderer'] : ['semantic_generic', 'renderer']);
    const decision = renderers[0].payload!.applicationDecision as Json;
    expect((decision.communication as Json).alternativeRequiresAdoption).toBe(relation === 'different' ? true : undefined);
    expect(decision.previewPromotionControlLabel).toBe(relation === 'different' ? null : CONTROL);
    expect(turn.result?.responseSource).toBe(relation === 'different' ? 'deterministic_fallback' : 'ai');
    expect(turn.result?.message.includes(CONTROL)).toBe(relation === 'same');
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
    expect(conversation.graph()).toEqual({ ...graphBefore, appliedTurnKeys: conversation.graph()!.appliedTurnKeys });
    expect(conversation.getState().pendingApproval).toBeUndefined();
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    for (const call of turn.calls.filter(call => call.kind.startsWith('semantic'))) {
      expect(call.payload).not.toHaveProperty('currentPreview');
      expect(JSON.stringify(call.payload)).not.toContain('"currentPreview":');
    }
  });

  it.each(['healthy', 'claims-status', 'invalid', 'throws'] as const)('keeps a retained preview through semantic recovery and %s renderer behavior', async rendererMode => {
    let failing = false;
    provider = installScriptedWeeklyPlanningProvider(call => {
      if (call.kind === 'renderer') {
        if (!failing) return eventRendererReply(call);
        if (rendererMode === 'invalid') return '{invalid-renderer-json';
        // A rendered status claim cannot be checked for unaccepted values, so only the
        // application states that the preview was kept (R28b).
        return scriptedRendererReply(call, rendererMode === 'claims-status'
          ? '変更内容をうまく受け取れませんでした。今の候補はそのままです。変えたい点を教えてください。'
          : '変更内容をうまく受け取れませんでした。変えたい点を教えてください。');
      }
      return failing ? '{invalid-semantic-json' : JSON.stringify(initial());
    });
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1', weekStartDate: '2030-01-07', now: () => '2030-01-01T00:00:00.000Z' });
    await conversation.submit(INITIAL);
    const graphBefore = structuredClone(conversation.graph());
    const previewBefore = structuredClone(conversation.getState().previewCandidates);
    failing = true;
    if (rendererMode === 'throws') vi.spyOn(rendererAdapter, 'createAiWeeklyPlanningStableV5DialogueRenderer')
      .mockReturnValue({ render: async () => { throw new Error('synthetic renderer crash'); } });
    const turn = await conversation.submit('締切を変えたい');
    expect(turn.result?.interactionOutcome).toMatchObject({ kind: 'recover', failure: 'semantic', representedQuestion: false });
    expect(turn.result?.failure).toBeDefined();
    expect(turn.result?.message).not.toMatch(/分けて|少しずつ|言い換え|再送|この内容で仮予定にする/u);
    expect(turn.result?.message).toContain(WEEKLY_PLANNING_RETAINED_PREVIEW_UNCHANGED_TEXT);
    expect(turn.result?.message).not.toContain('候補はそのまま');
    expect(turn.result?.message).toContain('変えたい点');
    expect(turn.result?.responseSource).toBe(rendererMode === 'healthy' ? 'ai' : 'deterministic_fallback');
    if (rendererMode === 'claims-status') {
      expect(turn.result?.dialogueRendererTrace?.response.reason).toBe('preview_claim_without_preview');
    }
    expect(conversation.graph()).toEqual(graphBefore);
    expect(conversation.getState().previewCandidates).toEqual(previewBefore);
    expect(conversation.getState().pendingApproval).toBeUndefined();
    expect(turn.result?.state.shouldSavePlan).not.toBe(true);
    if (rendererMode !== 'throws') {
      const call = turn.calls.find(item => item.kind === 'renderer')!;
      const decision = call.payload!.applicationDecision as Json;
      expect(decision.communication).toMatchObject({ goal: 'clarify_turn', askQuestion: false, retainedPreviewUnchanged: true });
      expect(call.payload!.request).toContain('Invite the specific edit, never splitting/rephrasing');
      expect(decision.previewPromotionControlLabel).toBeNull();
    }
  });
});
