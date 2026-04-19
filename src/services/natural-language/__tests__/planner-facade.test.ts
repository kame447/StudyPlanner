import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NaturalLanguageSuggestion, Plan } from '../../../types/domain';
import type { SuggestionInput } from '../../naturalLanguageRules';
import * as planner from '../../naturalLanguagePlanner';

const facadeState = vi.hoisted(() => ({
  provider: 'rules' as 'rules' | 'openai',
  legacyDebugEnabled: false,
  mode: 'pipeline' as 'legacy' | 'pipeline' | 'hybrid',
  addPipelineRun: {
    pipelineResult: undefined,
    suggestions: [] as NaturalLanguageSuggestion[],
  },
  editPipelineRun: {
    pipelineResult: undefined,
    suggestions: [] as NaturalLanguageSuggestion[],
  },
}));

const addAdapterSpy = vi.hoisted(() => vi.fn(() => facadeState.addPipelineRun));
const editAdapterSpy = vi.hoisted(() => vi.fn(() => facadeState.editPipelineRun));

vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: facadeState.provider }),
  getAiProviderLabel: () =>
    facadeState.provider === 'rules' ? 'ルールベース' : 'OpenAI互換',
}));

vi.mock('../adapter', () => ({
  getNaturalLanguageRulesPipelineMode: () => facadeState.mode,
  isNaturalLanguageLegacyDebugEnabled: () => facadeState.legacyDebugEnabled,
  runRulesPipelineWithAdapter: addAdapterSpy,
  runRulesPipelineEditWithAdapter: editAdapterSpy,
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
  facadeState.provider = 'rules';
  facadeState.legacyDebugEnabled = false;
  facadeState.mode = 'pipeline';
  facadeState.addPipelineRun = {
    pipelineResult: undefined,
    suggestions: [],
  };
  facadeState.editPipelineRun = {
    pipelineResult: undefined,
    suggestions: [],
  };
  addAdapterSpy.mockClear();
  editAdapterSpy.mockClear();
});

describe('naturalLanguagePlanner facade', () => {
  it('legacy mode 設定があっても debug flag なしでは add は current pipeline を使う', async () => {
    const adapterSuggestion = createMockSuggestion('明日19時から数学を1時間');
    facadeState.mode = 'legacy';
    facadeState.addPipelineRun = {
      pipelineResult: undefined,
      suggestions: [adapterSuggestion],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode では add adapter 経路を優先する', async () => {
    const adapterSuggestion = createMockSuggestion('明日19時から数学を1時間');
    facadeState.mode = 'pipeline';
    facadeState.addPipelineRun = {
      pipelineResult: undefined,
      suggestions: [adapterSuggestion],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode で add が 0 件でも legacy fallback しない', async () => {
    facadeState.mode = 'pipeline';
    facadeState.addPipelineRun = {
      pipelineResult: undefined,
      suggestions: [],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([]);
  });

  it('legacy mode 設定があっても debug flag なしでは edit は current pipeline を使う', async () => {
    const adapterSuggestion = createMockSuggestion('数学を20時に変更', {
      mode: 'edit',
      matchedPlanId: 'plan-1',
    });
    facadeState.mode = 'legacy';
    facadeState.editPipelineRun = {
      pipelineResult: undefined,
      suggestions: [adapterSuggestion],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode では new pipeline + edit adapter を優先する', async () => {
    const adapterSuggestion = createMockSuggestion('数学を20時に変更', {
      mode: 'edit',
      matchedPlanId: 'plan-1',
    });
    facadeState.mode = 'pipeline';
    facadeState.editPipelineRun = {
      pipelineResult: undefined,
      suggestions: [adapterSuggestion],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([adapterSuggestion]);
  });

  it('pipeline mode で edit が 0 件でも legacy fallback しない', async () => {
    facadeState.mode = 'pipeline';
    facadeState.editPipelineRun = {
      pipelineResult: undefined,
      suggestions: [],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createEditInput('数学を20時に変更'),
    );

    expect(editAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toEqual([]);
  });

  it('debug flag が有効な legacy mode だけ既存 rules 経路へ退避できる', async () => {
    facadeState.legacyDebugEnabled = true;
    facadeState.mode = 'legacy';
    facadeState.addPipelineRun = {
      pipelineResult: undefined,
      suggestions: [createMockSuggestion('unused')],
    };

    const suggestions = await planner.generateNaturalLanguageSuggestions(
      createAddInput('明日19時から数学を1時間'),
    );

    expect(addAdapterSpy).toHaveBeenCalledTimes(1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].assumptions).not.toContain('mock adapter suggestion');
  });

  it('AI assist は rules provider では使わず、unsupported / unresolved でだけ使う', () => {
    const input = createAddInput('今週は数学を合計10時間やりたい');

    expect(
      planner.shouldUseAiAssist(input, {
        suggestions: [],
      }),
    ).toBe(false);

    facadeState.provider = 'openai';

    expect(
      planner.shouldUseAiAssist(input, {
        suggestions: [createMockSuggestion('pipeline')],
      }),
    ).toBe(true);

    expect(
      planner.shouldUseAiAssist(createAddInput('明日19時から数学を1時間'), {
        suggestions: [
          createMockSuggestion('pipeline', {
            unresolvedFields: ['startTime'],
            status: 'needs_review',
          }),
        ],
      }),
    ).toBe(true);
  });
});
