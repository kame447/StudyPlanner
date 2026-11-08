import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';
import {
  createWeeklyPlanningStableV5DialoguePrompt,
  weeklyPlanningStableV5DialogueMessages,
} from './weeklyPlanningStableV5DialoguePrompt';

// #977: the provider's prompt cache keys on a byte-identical prefix. The renderer's turn-independent
// instructions must therefore sit in the system message, ahead of every per-turn value.
function input(overrides: Partial<WeeklyPlanningStableV5DialogueRenderInput> = {}): WeeklyPlanningStableV5DialogueRenderInput {
  return {
    actionId: 'stable-v5:request-1:quantity_role_unresolved',
    currentUserMessage: 'どういうこと？',
    recentConversation: [{ role: 'user', content: '院試は2分野それぞれ3時間やりたい' }],
    planningInformation: { tasks: [{ title: '院試', category: 'study' }], workloads: [] },
    actionKind: 'question',
    questionCode: 'quantity_role_unresolved',
    requiredLabels: ['院試'],
    fallbackText: '今回進めたい量ですか？',
    previewCount: 0,
    ...overrides,
  };
}

const variants: Array<[string, WeeklyPlanningStableV5DialogueRenderInput]> = [
  ['plain question', input()],
  ['other ids and text', input({ actionId: 'stable-v5:request-9:other', currentUserMessage: '数学を30ページ', requiredLabels: ['数学'] })],
  ['preview ready', input({ actionKind: 'preview_ready', questionCode: null, previewCount: 2, previewPromotionControlLabel: 'この内容で仮予定にする' })],
  ['recovery', input({ recovery: { reason: 'stale' } as never })],
  ['reference context', input({ referenceContext: { note: 'ref' } as never })],
];

describe('Stable V5 renderer prompt cache prefix (#977)', () => {
  it('sends a system message that is byte-identical for every turn', () => {
    const systems = variants.map(([, v]) => weeklyPlanningStableV5DialogueMessages(createWeeklyPlanningStableV5DialoguePrompt(v))[0]);
    for (const system of systems) {
      expect(system.role).toBe('system');
      expect(system.content).toBe(systems[0].content);
    }
    const bytes = new TextEncoder().encode(systems[0].content).byteLength;
    // Provider prefix caching needs a prefix over 1024 tokens; keep a growth guard too.
    expect(bytes).toBeGreaterThan(3_000);
    expect(bytes).toBeLessThanOrEqual(6_000);
  });

  it('keeps per-turn values and conditional instructions out of the fixed system message', () => {
    for (const [, v] of variants) {
      const prompt = createWeeklyPlanningStableV5DialoguePrompt(v);
      const system = weeklyPlanningStableV5DialogueMessages(prompt)[0].content;
      for (const dynamic of [v.actionId, v.currentUserMessage, ...v.requiredLabels, v.previewPromotionControlLabel ?? null]) {
        if (dynamic) expect(system).not.toContain(dynamic);
      }
      expect(system).not.toContain('復帰ではgroundingContext');
      expect(system).not.toContain('conversationReferencesは参考です');
      expect(system).not.toContain('プレビューがあれば承認案内');
    }
  });

  it('moves instructions without losing or duplicating any: fixed ones are in system only, conditional ones in request only', () => {
    const recovery = createWeeklyPlanningStableV5DialoguePrompt(variants[3][1]);
    const request = String((JSON.parse(recovery.userPrompt) as { request: string }).request);
    expect(request).toContain('復帰ではgroundingContext');
    expect(request).not.toContain('applicationDecisionに従い自然な日本語を返す');
    expect(recovery.instructionPrompt).toContain('applicationDecisionに従い自然な日本語を返す');
    expect(recovery.instructionPrompt).toContain('previewPromotionControlLabelがあれば候補は生成済みです');
    expect(request).not.toContain('previewPromotionControlLabelがあれば候補は生成済みです');
  });

  it('sends the system message first and the per-turn JSON as the last message', () => {
    const messages = weeklyPlanningStableV5DialogueMessages(createWeeklyPlanningStableV5DialoguePrompt(input()));
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(JSON.parse(messages[1].content)).toMatchObject({ actionId: 'stable-v5:request-1:quantity_role_unresolved' });
  });
});
