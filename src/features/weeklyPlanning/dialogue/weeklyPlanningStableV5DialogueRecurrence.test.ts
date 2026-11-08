import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueGroundingFact, WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';

// #958 item 2: an accepted repetition (a typed recurrence fact) is stated in the reply only because the request says so.
// The sentence is conditional: no recurrence fact this turn, no sentence, and nothing else in the prompt changes.
function questionInput(acceptedFacts: WeeklyPlanningStableV5DialogueGroundingFact[]): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:question', actionKind: 'question', questionCode: 'missing_schedulable_work',
    currentUserMessage: '来週から毎週月曜日に英語を勉強する予定にしてください。', recentConversation: [],
    planningInformation: { tasks: [{ title: '英語の勉強', category: 'study' }] },
    currentTurnGrounding: { mode: acceptedFacts.length ? 'recommended' : 'none', acceptedFacts },
    communication: { goal: 'ask_question', askQuestion: true },
    previewPromotionControlLabel: null, requiredLabels: [], fallbackText: '月曜日のどの時間帯なら取り組めそうですか？', previewCount: 0,
  };
}
const recurrenceFact = (data: Record<string, unknown>): WeeklyPlanningStableV5DialogueGroundingFact => ({ factId: 'recurrence-1', kind: 'recurrence', sourceText: '毎週月曜日', data });
const taskFact: WeeklyPlanningStableV5DialogueGroundingFact = { factId: 'task-1', kind: 'task', sourceText: '英語を勉強', data: { category: 'study', title: '英語の勉強' } };
const request = (input: WeeklyPlanningStableV5DialogueRenderInput) =>
  String((JSON.parse(createWeeklyPlanningStableV5DialoguePrompt(input).userPrompt) as { request: string }).request);

describe('the accepted repetition in the renderer request', () => {
  it('adds the sentence only when a recurrence fact was accepted this turn', () => {
    const withWeekly = questionInput([taskFact, recurrenceFact({ taskId: 'task-1', kind: 'weekly', days: ['weekday:monday'], count: null })]);
    expect(request(withWeekly)).toContain('acceptedFactsのrecurrence');
    expect(request(withWeekly)).toContain('識別子');
    expect(request(withWeekly)).toContain('足さない');
    // The other kinds use the same sentence; the fact's own data (kind, days, count) is what the model reads.
    expect(request(questionInput([recurrenceFact({ taskId: 'task-1', kind: 'times_per_week', days: [], count: 3 })]))).toContain('acceptedFactsのrecurrence');
    // No recurrence this turn: the request has no such sentence, with or without other accepted facts.
    expect(request(questionInput([]))).not.toContain('recurrence');
    expect(request(questionInput([taskFact]))).not.toContain('recurrence');
  });

  it('leaves every other request, and the fixed instructions, unchanged', () => {
    const plain = questionInput([taskFact]);
    const withRecurrence = questionInput([taskFact, recurrenceFact({ taskId: 'task-1', kind: 'weekly', days: ['weekday:monday'], count: null })]);
    // The sentence is the only difference in the request string: removing it gives the request of the same input without the fact.
    const sentence = request(withRecurrence).replace(request(plain), '');
    expect(sentence).toContain('acceptedFactsのrecurrence');
    expect(request(plain)).toBe(request(questionInput([taskFact])));
    // The fixed system and instruction prompts do not depend on the input (the trace records only their fingerprint).
    expect(createWeeklyPlanningStableV5DialoguePrompt(withRecurrence).systemPrompt).toBe(createWeeklyPlanningStableV5DialoguePrompt(plain).systemPrompt);
    expect(createWeeklyPlanningStableV5DialoguePrompt(withRecurrence).instructionPrompt).toBe(createWeeklyPlanningStableV5DialoguePrompt(plain).instructionPrompt);
  });
});
