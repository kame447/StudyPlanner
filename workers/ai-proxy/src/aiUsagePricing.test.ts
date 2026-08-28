import { describe, expect, it } from 'vitest';
import {
  AI_PRICING_VERSION,
  estimateAiRequestCost,
} from './aiUsagePricing';

describe('AI usage pricing', () => {
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
