import { describe, expect, it } from 'vitest';
import {
  AI_PRICING_VERSION,
  GPT_6_LUNA_PRICING_VERSION,
  estimateAiRequestCost,
  estimateLunaTextUsageCostRange,
} from './aiUsagePricing';

describe('AI usage pricing', () => {
  it('prices GPT-6 Luna independently from historical GPT-5.6 usage', () => {
    expect(estimateAiRequestCost({
      provider: 'openai',
      model: 'gpt-6-luna',
      operationKind: 'chat_completion',
      usage: {
        promptTokens: 1000,
        completionTokens: 100,
        totalTokens: 1100,
        cachedTokens: 600,
        cacheWriteTokens: 200,
      },
    })).toEqual({
      pricingVersion: GPT_6_LUNA_PRICING_VERSION,
      estimatedCostMicros: 101,
    });
    expect(GPT_6_LUNA_PRICING_VERSION).not.toBe(AI_PRICING_VERSION);
  });

  it.each([
    { promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cachedTokens: 600, cacheWriteTokens: null },
    { promptTokens: 272001, completionTokens: 100, totalTokens: 272101, cachedTokens: 0, cacheWriteTokens: 0 },
    { promptTokens: 1000, completionTokens: 100, totalTokens: 1100, cachedTokens: 900, cacheWriteTokens: 200 },
  ])('leaves GPT-6 Luna cost unknown when usage is incomplete or outside known pricing', (usage) => {
    expect(estimateAiRequestCost({
      provider: 'openai', model: 'gpt-6-luna', operationKind: 'chat_completion', usage,
    })).toEqual({ pricingVersion: GPT_6_LUNA_PRICING_VERSION, estimatedCostMicros: null });
  });

  it('does not apply GPT-6 text pricing to image attachment usage', () => {
    expect(estimateAiRequestCost({
      provider: 'openai', model: 'gpt-6-luna', operationKind: 'planning_attachment',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, cachedTokens: 0, cacheWriteTokens: 0 },
    })).toEqual({ pricingVersion: null, estimatedCostMicros: null });
  });

  it('estimates Luna text cost from actual uncached, cached, cache-write and output tokens', () => {
    expect(estimateAiRequestCost({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      operationKind: 'chat_completion',
      usage: {
        promptTokens: 1000,
        completionTokens: 100,
        totalTokens: 1100,
        cachedTokens: 600,
        cacheWriteTokens: 200,
      },
    })).toEqual({
      pricingVersion: AI_PRICING_VERSION,
      estimatedCostMicros: 222,
    });
  });

  it('does not estimate Luna cost when cache accounting is incomplete', () => {
    expect(estimateAiRequestCost({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      operationKind: 'chat_completion',
      usage: {
        promptTokens: 1000,
        completionTokens: 100,
        totalTokens: 1100,
        cachedTokens: 600,
        cacheWriteTokens: null,
      },
    })).toEqual({
      pricingVersion: AI_PRICING_VERSION,
      estimatedCostMicros: null,
    });
  });

  it('bounds Luna cost when aggregate usage omits the cache breakdown', () => {
    expect(estimateLunaTextUsageCostRange({
      promptTokens: 1000,
      completionTokens: 100,
    })).toEqual({
      pricingVersion: AI_PRICING_VERSION,
      minimumCostMicros: 140,
      maximumCostMicros: 370,
    });
    expect(estimateLunaTextUsageCostRange({
      promptTokens: null,
      completionTokens: 100,
    })).toEqual({
      pricingVersion: AI_PRICING_VERSION,
      minimumCostMicros: null,
      maximumCostMicros: null,
    });
  });

  it('does not apply short-context Luna pricing above the long-context threshold', () => {
    expect(estimateAiRequestCost({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      operationKind: 'chat_completion',
      usage: {
        promptTokens: 272001,
        completionTokens: 100,
        totalTokens: 272101,
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    })).toEqual({
      pricingVersion: AI_PRICING_VERSION,
      estimatedCostMicros: null,
    });
  });

  it('does not price unsupported providers or operation kinds', () => {
    expect(estimateAiRequestCost({
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      operationKind: 'timetable_ocr',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cachedTokens: null,
        cacheWriteTokens: null,
      },
    })).toEqual({
      pricingVersion: null,
      estimatedCostMicros: null,
    });

    expect(estimateAiRequestCost({
      provider: 'openai',
      model: 'gpt-5.6-luna',
      operationKind: 'planning_attachment',
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cachedTokens: 0,
        cacheWriteTokens: 0,
      },
    })).toEqual({
      pricingVersion: null,
      estimatedCostMicros: null,
    });
  });
});
