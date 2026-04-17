import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NaturalLanguageSuggestion, Plan } from '../../../types/domain';
import type { SuggestionInput } from '../../naturalLanguageRules';
import * as planner from '../../naturalLanguagePlanner';

const facadeState = vi.hoisted(() => ({
  mode: 'legacy' as 'legacy' | 'pipeline' | 'hybrid',
  addSuggestions: [] as NaturalLanguageSuggestion[],
  editSuggestions: [] as NaturalLanguageSuggestion[],
}));

const addAdapterSpy = vi.hoisted(() => vi.fn(() => facadeState.addSuggestions));
const editAdapterSpy = vi.hoisted(() => vi.fn(() => facadeState.editSuggestions));

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'rules' }),
  getAiProviderLabel: () => 'ルールベース',
}));

vi.mock('../adapter', () => ({
  getNaturalLanguageRulesPipelineMode: () => facadeState.mode,
  runRulesPipelineThroughAdapter: addAdapterSpy,
  runRulesPipelineEditThroughAdapter: editAdapterSpy,
}));

function createAddInput(text: string): SuggestionInput {
  return {
    mode: 'add',
    text,
    selectedDate: '2026-04-16',
    plans: [],
    userId: 'user-1',
  };
}

function createRecurringPlan(): Plan {
  return {
    id: 'plan-1',
    seriesId: 'series-1',
    userId: 'user-1',
    title: '数学',
    subject: '数学',
    date: '2026-04-16',
    startTime: '19:00',
    endTime: '20:00',
    repeat: 'daily',
    repeatUntil: null,
    excludedDates: [],
    recurrenceRules: [],
    type: 'study',
    memo: '',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  };
}

function createEditInput(text: string): SuggestionInput {
  return {
    mode: 'edit',
    text,
    selectedDate: '2026-04-16',
    plans: [createRecurringPlan()],
    userId: 'user-1',
  };
}

function createMockSuggestion(
  text: string,
  overrides: Partial<NaturalLanguageSuggestion> = {},
): NaturalLanguageSuggestion {
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
    ...overrides,
  };
}

afterEach(() => {
  facadeState.mode = 'legacy';
  facadeState.addSuggestions = [];
  facadeState.editSuggestions = [];
  addAdapterSpy.mockClear();
  editAdapterSpy.mockClear();
});

describe('naturalLanguagePlanner facade', () => {
  it('legacy mode では既存 add rules 経路を使う', async () => {
    facadeState.mode = 'legacy';
    facadeState.addSuggestions = [createMockSuggestion('unused')];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).not.toHaveBeenCalled();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('pipeline mode では add adapter 経路を優先する', async () => {
    const adapterSuggestion = createMockSuggestion('明日19時から数学を1時間');
    facadeState.mode = 'pipeline';
    facadeState.addSuggestions = [adapterSuggestion];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode でも add が 0 件なら既存 rules 経路へ fallback する', async () => {
    facadeState.mode = 'pipeline';
    facadeState.addSuggestions = [];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].parsedPlan.title).toBe('数学');
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('legacy mode では既存 edit rules 経路を使う', async () => {
    facadeState.mode = 'legacy';
    facadeState.editSuggestions = [createMockSuggestion('unused')];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).not.toHaveBeenCalled();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].matchedPlanId).toBe('plan-1');
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('pipeline mode では new pipeline + edit adapter を優先する', async () => {
    const adapterSuggestion = createMockSuggestion('数学を20時に変更', {
      mode: 'edit',
      matchedPlanId: 'plan-1',
    });
    facadeState.mode = 'pipeline';
    facadeState.editSuggestions = [adapterSuggestion];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode でも edit が 0 件なら既存 rules 経路へ fallback する', async () => {
    facadeState.mode = 'pipeline';
    facadeState.editSuggestions = [];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].matchedPlanId).toBe('plan-1');
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('hybrid mode の edit は pipeline 優先だが fallback 条件は add と同じ', async () => {
    const adapterSuggestion = createMockSuggestion('数学を20時に変更', {
      mode: 'edit',
      matchedPlanId: 'plan-1',
    });
    facadeState.mode = 'hybrid';
    facadeState.editSuggestions = [adapterSuggestion];

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });
});
