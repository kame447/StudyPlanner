import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../../services/ai/openAiCompatibleClientTypes';
import { LEARNING_CONSULTATION_ANSWER_VERSION, LEARNING_CONSULTATION_TURN_PURPOSE_VERSION } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningVNextConsultation, VNEXT_ADVICE_NOTICE, type WeeklyPlanningVNextConsultationInput } from './weeklyPlanningVNextConsultation';

const input: WeeklyPlanningVNextConsultationInput = {
  userText: '英語が苦手なんだけど何から始めればいい？',
  recentConversation: [1, 2, 3, 4, 5, 6].map(index => ({ role: index % 2 ? 'user' as const : 'assistant' as const, content: `m${index}` })),
  activeTaskTitles: ['数学'], rememberedBackground: [{ kind: 'concern', label: '英語', value: '長文が遅い' }], currentDate: '2026-11-08',
};
const recommendation = { recommendationKind: 'study_method', rationale: '土台が先です。', assumptionRefs: ['高校レベル'], evidenceRefs: [], uncertainty: 'medium' };
const proposal = { schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION, kind: 'proposal',
  userFacingAnswer: 'まず文法の基礎問題集を1周しましょう。', options: [{ title: '基礎固め', strategySummary: '文法から', recommendations: [recommendation], tradeoffs: ['時間がかかる'] }],
  assumptions: ['高校レベル'], overallUncertainty: 'medium' };
const clarification = { schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION, kind: 'clarification',
  userFacingAnswer: '受験はいつですか？', requestedMeaning: '受験時期', whyItMatters: '期間で進め方が変わる', allowedUnknown: true };

function client(...replies: Array<unknown | Error>) {
  const requests: Parameters<OpenAiCompatibleClient['createChatCompletion']>[0][] = [];
  const queue = [...replies];
  const port: OpenAiCompatibleClient = { async createChatCompletion(request) {
    requests.push(request);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'string' ? next : JSON.stringify(next);
  } };
  return { port, requests };
}
const purpose = (kind: string) => ({ schemaVersion: LEARNING_CONSULTATION_TURN_PURPOSE_VERSION, kind });

describe('learning consultation provider calls (#246)', () => {
  it('classifies with a strict, small request that carries the words and the last four messages as data', async () => {
    const c = client(purpose('learning_consultation'));
    expect(await createWeeklyPlanningVNextConsultation(c.port).classify(input)).toBe('learning_consultation');
    const [request] = c.requests;
    expect(request).toMatchObject({ temperature: 0, purpose: 'weekly_planning_interpreter', maxCompletionTokens: 100,
      responseFormat: { type: 'json_schema', json_schema: { name: 'weekly_planning_vnext_turn_purpose_v1', strict: true } } });
    const data = JSON.parse(request.messages[1].content);
    expect(data.currentUserMessage).toBe(input.userText);
    expect(data.recentConversation.map((message: { content: string }) => message.content)).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(Object.keys(data).sort()).toEqual(['currentUserMessage', 'recentConversation']);
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThan(3_000);
  });

  it.each([
    ['planning_operation', 'planning_operation'], ['unresolved', 'unresolved'],
  ])('returns the %s purpose without routing it', async (kind, expected) => {
    expect(await createWeeklyPlanningVNextConsultation(client(purpose(kind)).port).classify(input)).toBe(expected);
  });

  it.each([
    ['a provider failure', new Error('503')], ['not JSON', 'こんにちは'], ['an unknown kind', purpose('smalltalk')],
    ['a wrong version', { schemaVersion: 'other', kind: 'unresolved' }], ['an extra field', { ...purpose('unresolved'), advice: '勝手な助言' }],
  ])('treats %s as no classification, so the planning path decides', async (_name, reply) => {
    expect(await createWeeklyPlanningVNextConsultation(client(reply).port).classify(input)).toBeNull();
  });

  it('asks for advice with the known context only, and shows a proposal with the notice that it is not a plan', async () => {
    const c = client(proposal);
    const answer = await createWeeklyPlanningVNextConsultation(c.port).answer(input);
    expect(answer).toEqual({ kind: 'proposal', text: `まず文法の基礎問題集を1周しましょう。\n\n${VNEXT_ADVICE_NOTICE}` });
    const [request] = c.requests;
    expect(request).toMatchObject({ temperature: 0.3, purpose: 'weekly_planning_renderer', maxCompletionTokens: 1800,
      responseFormat: { type: 'json_schema', json_schema: { name: 'weekly_planning_vnext_advice_v1' } } });
    expect(JSON.parse(request.messages[1].content)).toEqual({ currentDate: '2026-11-08', currentUserMessage: input.userText,
      recentConversation: input.recentConversation.slice(-4), knownTasks: ['数学'], rememberedBackground: input.rememberedBackground });
    expect(request.messages[0].content).toContain('evidenceRefs は常に []');
    expect(request.messages[0].content).toContain('予定・保存・承認を作った');
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeLessThan(6_000);
  });

  it('shows a clarification as the question itself, without the notice', async () => {
    expect(await createWeeklyPlanningVNextConsultation(client(clarification).port).answer(input))
      .toEqual({ kind: 'clarification', text: '受験はいつですか？' });
  });

  it('drops keys that belong to the other kind, then validates the rest', async () => {
    const mixed = { ...clarification, options: proposal.options, assumptions: ['x'], overallUncertainty: 'low' };
    expect(await createWeeklyPlanningVNextConsultation(client(mixed).port).answer(input)).toEqual({ kind: 'clarification', text: '受験はいつですか？' });
  });

  it.each([
    ['a provider failure', new Error('503')],
    ['text that is not JSON', 'こうしましょう'],
    ['an explanation, which answers an existing proposal', { schemaVersion: LEARNING_CONSULTATION_ANSWER_VERSION, kind: 'explanation',
      userFacingAnswer: 'x', rationale: 'y', assumptionRefs: [], evidenceRefs: [], tradeoffs: [], historical: false }],
    ['a wrong version', { ...proposal, schemaVersion: 'v0' }],
    ['a proposal without its assumptions', (() => { const { assumptions: _a, ...rest } = proposal; return rest; })()],
    ['an empty answer', { ...proposal, userFacingAnswer: '  ' }],
    ['no option', { ...proposal, options: [] }],
    ['evidence it was never given', { ...proposal, options: [{ ...proposal.options[0], recommendations: [{ ...recommendation, evidenceRefs: ['src-1'] }] }] }],
    ['a clarification that allows no unknown', { ...clarification, allowedUnknown: false }],
    ['an unknown field inside a recommendation', { ...proposal, options: [{ ...proposal.options[0], recommendations: [{ ...recommendation, savePlan: true }] }] }],
  ])('refuses %s, so the planning path decides', async (_name, reply) => {
    expect(await createWeeklyPlanningVNextConsultation(client(reply).port).answer(input)).toBeNull();
  });

  it('never throws to the turn', async () => {
    const throwing: OpenAiCompatibleClient = { createChatCompletion: vi.fn(async () => { throw new Error('network down'); }) };
    const port = createWeeklyPlanningVNextConsultation(throwing);
    await expect(port.classify(input)).resolves.toBeNull();
    await expect(port.answer(input)).resolves.toBeNull();
  });
});
