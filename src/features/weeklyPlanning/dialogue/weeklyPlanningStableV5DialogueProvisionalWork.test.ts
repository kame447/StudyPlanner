import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';
import { parseWeeklyPlanningStableV5DialogueRendererResponse } from './weeklyPlanningStableV5DialogueValidation';

// Stage B SB9 option 1: the reply may say how long a provisionally placed work is only because the application states it.
const LABEL = 'この内容で仮予定にする';
function previewInput(provisionalMinutes: number | null): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:preview_ready', actionKind: 'preview_ready', questionCode: null,
    currentUserMessage: '時間は分からないので、仮で置いてください。', recentConversation: [],
    planningInformation: { tasks: [{ title: '数学プリント', category: 'study' }] }, currentTurnGrounding: { mode: 'none', acceptedFacts: [] },
    communication: { goal: 'present_preview', askQuestion: false,
      ...(provisionalMinutes === null ? {} : { provisionalWork: [{ taskId: 'task-1', label: '数学プリント', minutes: provisionalMinutes }] }) },
    previewPromotionControlLabel: LABEL, requiredLabels: [LABEL], fallbackText: '仮の候補を用意しました。', previewCount: 1,
  };
}
const reply = (input: WeeklyPlanningStableV5DialogueRenderInput, text: string) => parseWeeklyPlanningStableV5DialogueRendererResponse(JSON.stringify({
  actionId: input.actionId, actionKind: input.actionKind, questionCode: input.questionCode, text, groundingAcknowledgement: null }), input);

describe('provisional work in the renderer input', () => {
  it('adds the instruction to the request only when the fact is present, and leaves every other request unchanged', () => {
    const request = (input: WeeklyPlanningStableV5DialogueRenderInput) => String((JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt) as { request: string }).request);
    expect(request(previewInput(60))).toContain('communication.provisionalWork');
    expect(request(previewInput(60))).toContain('承認する前に');
    // A reading with provisional and estimated works must still describe the estimated ones (it dropped them before this sentence).
    expect(request(previewInput(60))).toContain('provisionalWorkにない作業');
    expect(request(previewInput(60))).toContain('省かず通常どおり');
    expect(request(previewInput(null))).not.toContain('provisionalWork');
    // The fact only extends the request; with no fact the prompt is the same as for an input without the key.
    const plain = previewInput(null);
    expect(createWeeklyPlanningStableV5DialoguePrompt(plain).userPrompt)
      .toBe(createWeeklyPlanningStableV5DialoguePrompt({ ...plain, communication: { ...plain.communication!, provisionalWork: undefined } }).userPrompt);
  });

  it('does not change what the production reply check accepts: a reply claiming the work is saved is still refused', () => {
    // The production check is syntactic: durations are not validated there, so the fact needs no grounding exception;
    // what it must keep refusing is a claim that the application did something it did not.
    const input = previewInput(60);
    expect(reply(input, `数学プリントは仮に60分で置いた候補です。承認する前に所要時間が分かれば教えてください。${LABEL}`)).toMatchObject({ status: 'rendered' });
    expect(reply(input, `数学プリントを60分で保存しました。${LABEL}`)).toMatchObject({ status: 'fallback', reason: 'ungrounded_text' });
  });
});
