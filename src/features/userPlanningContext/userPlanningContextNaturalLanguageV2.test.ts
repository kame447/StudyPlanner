import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleClient } from '../../services/ai/openAiCompatibleClient';
import {
  interpretUserPlanningContextNaturalLanguageV2,
  parseUserPlanningContextNaturalLanguageResultV2,
  userPlanningContextExternalOwnerMessageV2,
} from './userPlanningContextNaturalLanguageV2';

function clientWithResponse(response: unknown): OpenAiCompatibleClient {
  return {
    createChatCompletion: vi.fn().mockResolvedValue(JSON.stringify(response)),
  };
}

describe('userPlanningContextNaturalLanguageV2', () => {
  it('accepts durable user context without exposing category choice to the caller', async () => {
    const client = clientWithResponse({
      targetDomain: 'user_context',
      kind: 'learning_preference',
      label: '暗記学習',
      value: '15分程度に分けたい',
      dateExpression: null,
      displayText: '英単語は15分くらいに分けて勉強したい。',
      reason: '複数の計画で使う継続的な学習方法の好み',
    });

    const result = await interpretUserPlanningContextNaturalLanguageV2({
      text: '英単語は15分くらいに分けたい',
      client,
    });

    expect(result).toMatchObject({
      targetDomain: 'user_context',
      kind: 'learning_preference',
      label: '暗記学習',
      displayText: '英単語は15分くらいに分けて勉強したい。',
    });
    expect(client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'user_context_interpreter',
    }));
  });

  it('routes material progress to the bookshelf source of truth instead of memory', async () => {
    const result = await interpretUserPlanningContextNaturalLanguageV2({
      text: '金フレは120ページまで終わった',
      client: clientWithResponse({
        targetDomain: 'bookshelf',
        kind: null,
        label: null,
        value: null,
        dateExpression: null,
        displayText: '金フレは120ページまで終わった。',
        reason: '教材の現在進捗はStudyMaterialが正本',
      }),
    });

    expect(result.targetDomain).toBe('bookshelf');
    expect(userPlanningContextExternalOwnerMessageV2('bookshelf')).toContain('本棚');
  });

  it('rejects provider output that mixes another source of truth with memory fields', () => {
    expect(() => parseUserPlanningContextNaturalLanguageResultV2({
      targetDomain: 'timetable',
      kind: 'concern',
      label: '数学',
      value: '毎週月曜3限',
      dateExpression: null,
      displayText: '毎週月曜3限に数学がある。',
      reason: '時間割',
    })).toThrow('保存先を安全に判定できませんでした');
  });

  it('does not allow a date expression on a non-event memory kind', () => {
    expect(() => parseUserPlanningContextNaturalLanguageResultV2({
      targetDomain: 'user_context',
      kind: 'concern',
      label: '数学',
      value: '確率が苦手',
      dateExpression: '2026-12-01',
      displayText: '数学では確率が苦手。',
      reason: '継続的な苦手',
    })).toThrow('時期の情報を安全に整理できませんでした');
  });
});
