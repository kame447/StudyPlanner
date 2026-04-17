import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NaturalLanguageSuggestion } from '../../../types/domain';
import type { SuggestionInput } from '../../naturalLanguageRules';

function createInput(text: string): SuggestionInput {
  return {
    mode: 'add',
    text,
    selectedDate: '2026-04-16',
    plans: [],
    userId: 'user-1',
  };
}

function createMockSuggestion(text: string): NaturalLanguageSuggestion {
  return {
    mode: 'add',
    rawText: text,
    confidence: 0.9,
    reason: 'mock',
    source: 'rules',
    providerLabel: 'ルールベース',
    status: 'ready',
    parsedPlan: {
      userId: 'user-1',
      title: '数学',
      subject: '数学',
      date: '2026-04-17',
      startTime: '19:00',
      endTime: '20:00',
      repeat: 'none',
      repeatUntil: null,
      excludedDates: [],
      recurrenceRules: [],
      type: 'study',
      memo: '',
    },
    assumptions: ['mock adapter suggestion'],
    unresolvedFields: [],
    issues: [],
  };
}

async function loadPlannerWithMocks(options: {
  mode: 'legacy' | 'pipeline' | 'hybrid';
  adapterSuggestions: NaturalLanguageSuggestion[];
}) {
  vi.resetModules();
  vi.clearAllMocks();

  vi.doMock('../../../lib/aiConfig', () => ({
    getAiConfig: () => ({ provider: 'rules' }),
    getAiProviderLabel: () => 'ルールベース',
  }));

  const adapterSpy = vi.fn(() => options.adapterSuggestions);

  vi.doMock('../adapter', async () => {
    const actual =
      await vi.importActual<typeof import('../adapter')>('../adapter');
    return {
      ...actual,
      getNaturalLanguageRulesPipelineMode: () => options.mode,
      runRulesPipelineThroughAdapter: adapterSpy,
    };
  });

  const planner = await import('../../naturalLanguagePlanner');
  return { planner, adapterSpy };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unmock('../../../lib/aiConfig');
  vi.unmock('../adapter');
});

describe('naturalLanguagePlanner facade', () => {
  it('legacy mode では既存 rules 経路を使う', async () => {
    const { planner, adapterSpy } = await loadPlannerWithMocks({
      mode: 'legacy',
      adapterSuggestions: [createMockSuggestion('unused')],
    });

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createInput('明日19時から数学を1時間'),
    );

    expect(adapterSpy).not.toHaveBeenCalled();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('pipeline mode では adapter 経路を優先する', async () => {
    const adapterSuggestion = createMockSuggestion('明日19時から数学を1時間');
    const { planner, adapterSpy } = await loadPlannerWithMocks({
      mode: 'pipeline',
      adapterSuggestions: [adapterSuggestion],
    });

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createInput('明日19時から数学を1時間'),
    );

    expect(adapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode でも 0 件なら既存 rules 経路へ fallback する', async () => {
    const { planner, adapterSpy } = await loadPlannerWithMocks({
      mode: 'pipeline',
      adapterSuggestions: [],
    });

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createInput('明日19時から数学を1時間'),
    );

    expect(adapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe('数学');
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });
});
