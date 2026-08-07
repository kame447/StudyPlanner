import { describe, expect, it } from 'vitest';
import {
  createWeeklyPlanningSemanticSystemPromptV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticNormalizerV5';

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe('Stable V5 semantic prompt budget', () => {
  it('keeps normalizer policy overhead small and scenario independent', () => {
    const corePrompt = createWeeklyPlanningSemanticSystemPromptV5();
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '申請書を2件、参考資料を4ページ確認したいです',
      recentConversation: [
        { role: 'user', content: '来週の作業を整理したいです' },
      ],
      publicStateSummary: {
        pendingQuestion: null,
      },
    });
    const systemPrompt = messages[0]?.content ?? '';
    const policyOverhead = systemPrompt.slice(corePrompt.length);

    expect(systemPrompt.startsWith(corePrompt)).toBe(true);
    expect(byteLength(policyOverhead)).toBeLessThanOrEqual(1800);
    expect(systemPrompt).not.toContain('申請書');
    expect(systemPrompt).not.toContain('参考資料');
    expect(systemPrompt).not.toContain('Do not drop a later coordinated item');
    expect(systemPrompt).not.toContain('split the independent subjects');
    expect(systemPrompt).not.toContain('次の日, 翌日, and 明日 mean tomorrow');
  });
});
