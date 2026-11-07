import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import previewCapture from './fixtures/issue876-remaining-effort-renderer.json';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import { createWeeklyPlanningStableV5DialoguePrompt } from './weeklyPlanningStableV5DialoguePrompt';

function question(): WeeklyPlanningStableV5DialogueRenderInput {
  return { actionId: 'renderer-cache-turn-a', currentUserMessage: '今日、研究を進めたい', recentConversation: [],
    planningInformation: { tasks: [{ id: 'research', category: 'study', title: '研究' }], workloads: [] },
    actionKind: 'question', questionCode: 'missing_schedulable_work', requiredLabels: ['研究'],
    fallbackText: '研究の進め方を教えてください。', previewCount: 0 };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

function semanticDigest(input: WeeklyPlanningStableV5DialogueRenderInput): string {
  const prompt = createWeeklyPlanningStableV5DialoguePrompt(input);
  return createHash('sha256').update(JSON.stringify(canonical({
    systemPrompt: prompt.systemPrompt, payload: JSON.parse(prompt.userPrompt),
  }))).digest('hex');
}

function fixtures(): Record<string, WeeklyPlanningStableV5DialogueRenderInput> {
  return {
    question: question(),
    preview: structuredClone(previewCapture.input) as unknown as WeeklyPlanningStableV5DialogueRenderInput,
    recovery: { ...question(), recovery: { planningDetailsNotApplied: true, acceptedStateUnchanged: true,
      retainedPreviewUnchanged: true } },
    reference: { ...question(), referenceContext: { referenceDate: '2026-11-02', pastActivities: [
      { source: 'completed', label: '数学', date: '2026-11-01' }], targetDateCommitments: [] } },
  };
}

describe('renderer prompt cache prefix', () => {
  it('preserves every field, directive and system byte from the pre-reorder fixtures', () => {
    // Captured on 022931a8 before the #977 key-order change. Sorting object keys
    // removes order only; changed strings, arrays or missing fields still fail.
    const hashes = Object.fromEntries(Object.entries(fixtures()).map(([name, input]) => [name, semanticDigest(input)]));
    expect(hashes).toEqual({
      question: '44b12229018153dd4bdb89e12e2491efc5a66e458e05d55b0c0b8b9558e98caa',
      preview: 'e7e3d1d51c045ee33ddb899f128c188ea70d137c70cb6a4ac01b54aa9ae64748',
      recovery: '97619df4f08f9d9a1946997b396eee9ff853908b184c28e2c96ab284186c6880',
      reference: '9fe85f2cd5d7052d464f97f982f5f3f0eef1e38efcecff7f1c5873f9984c4494',
    });
  });

  it('puts the stable directive bytes before changing turn IDs, messages and facts', () => {
    const firstInput = question();
    const before = structuredClone(firstInput);
    const first = createWeeklyPlanningStableV5DialoguePrompt(firstInput);
    const second = createWeeklyPlanningStableV5DialoguePrompt({ ...firstInput, actionId: 'other-conversation-turn-b',
      currentUserMessage: '数学を進めたい', recentConversation: [{ role: 'user', content: '今日は30分あります' }],
      planningInformation: { tasks: [{ id: 'math', category: 'study', title: '数学' }], workloads: [] } });
    const firstPayload = JSON.parse(first.userPrompt);
    const secondPayload = JSON.parse(second.userPrompt);
    expect(Object.keys(firstPayload)[0]).toBe('request');
    expect(first.systemPrompt).toBe(second.systemPrompt);
    expect(firstPayload.request).toBe(secondPayload.request);
    const expectedPrefix = JSON.stringify({ request: firstPayload.request }).slice(0, -1);
    expect(first.userPrompt.startsWith(expectedPrefix)).toBe(true);
    expect(second.userPrompt.startsWith(expectedPrefix)).toBe(true);
    const encode = (text: string) => new TextEncoder().encode(text);
    expect(encode(first.userPrompt).slice(0, encode(expectedPrefix).length))
      .toEqual(encode(second.userPrompt).slice(0, encode(expectedPrefix).length));
    expect(firstPayload.actionId).not.toBe(secondPayload.actionId);
    expect(firstPayload.currentUserMessage).not.toBe(secondPayload.currentUserMessage);
    expect(firstInput).toEqual(before);
  });
});
