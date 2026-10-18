import type { AiRequestMetricPayload } from '../../../shared/productObservabilityContract';
import type { AiRequestUsage } from './aiRequestObservability';

export const AI_PRICING_VERSION = 'openai-public-2026-07-30-v1';
export const GPT_6_LUNA_PRICING_VERSION = 'openai-public-2026-10-12-v1';

interface TokenPricing {
  inputMicrosPerMillion: number;
  cachedInputMicrosPerMillion?: number;
  cacheWriteMicrosPerMillion?: number;
  outputMicrosPerMillion: number;
}

interface PricingEstimate {
  pricingVersion: string | null;
  estimatedCostMicros: number | null;
}

export interface LunaTextCostRangeEstimate {
  pricingVersion: string | null;
  minimumCostMicros: number | null;
  maximumCostMicros: number | null;
}

const GPT_5_6_LUNA_TEXT: TokenPricing = {
  inputMicrosPerMillion: 200_000,
  cachedInputMicrosPerMillion: 20_000,
  cacheWriteMicrosPerMillion: 250_000,
  outputMicrosPerMillion: 1_200_000,
};

// Standard short-context text rates, verified 2026-10-12:
// https://developers.openai.com/api/docs/models/gpt-6-luna
const GPT_6_LUNA_TEXT: TokenPricing = {
  inputMicrosPerMillion: 100_000,
  cachedInputMicrosPerMillion: 10_000,
  cacheWriteMicrosPerMillion: 125_000,
  outputMicrosPerMillion: 500_000,
};

const GPT_4O_MINI_TRANSCRIBE_AUDIO: TokenPricing = {
  inputMicrosPerMillion: 1_250_000,
  outputMicrosPerMillion: 5_000_000,
};

const LUNA_LONG_CONTEXT_THRESHOLD = 272_000;

function costMicros(tokens: number, rateMicrosPerMillion: number): number {
  return Math.round((tokens * rateMicrosPerMillion) / 1_000_000);
}

function hasCoreUsage(usage: AiRequestUsage): usage is AiRequestUsage & {
  promptTokens: number;
  completionTokens: number;
} {
  return usage.promptTokens !== null && usage.completionTokens !== null;
}

function estimateLunaTextUsage(usage: AiRequestUsage, pricing: TokenPricing): number | null {
  if (!hasCoreUsage(usage)) return null;
  if (usage.promptTokens > LUNA_LONG_CONTEXT_THRESHOLD) return null;
  if (usage.cachedTokens === null || usage.cacheWriteTokens === null) return null;

  const uncachedTokens = usage.promptTokens - usage.cachedTokens - usage.cacheWriteTokens;
  if (uncachedTokens < 0) return null;

  return costMicros(uncachedTokens, pricing.inputMicrosPerMillion)
    + costMicros(usage.cachedTokens, pricing.cachedInputMicrosPerMillion ?? 0)
    + costMicros(usage.cacheWriteTokens, pricing.cacheWriteMicrosPerMillion ?? 0)
    + costMicros(usage.completionTokens, pricing.outputMicrosPerMillion);
}

export function estimateLunaTextUsageCostRange(params: {
  promptTokens: number | null;
  completionTokens: number | null;
}): LunaTextCostRangeEstimate {
  const { promptTokens, completionTokens } = params;
  const validPrompt = promptTokens !== null
    && Number.isSafeInteger(promptTokens)
    && promptTokens >= 0
    && promptTokens <= LUNA_LONG_CONTEXT_THRESHOLD;
  const validCompletion = completionTokens !== null
    && Number.isSafeInteger(completionTokens)
    && completionTokens >= 0;
  if (!validPrompt || !validCompletion) {
    return {
      pricingVersion: AI_PRICING_VERSION,
      minimumCostMicros: null,
      maximumCostMicros: null,
    };
  }
  const outputCost = costMicros(
    completionTokens,
    GPT_5_6_LUNA_TEXT.outputMicrosPerMillion,
  );
  return {
    pricingVersion: AI_PRICING_VERSION,
    minimumCostMicros: costMicros(
      promptTokens,
      GPT_5_6_LUNA_TEXT.cachedInputMicrosPerMillion ?? 0,
    ) + outputCost,
    maximumCostMicros: costMicros(
      promptTokens,
      Math.max(
        GPT_5_6_LUNA_TEXT.inputMicrosPerMillion,
        GPT_5_6_LUNA_TEXT.cacheWriteMicrosPerMillion ?? 0,
      ),
    ) + outputCost,
  };
}

function estimateTranscriptionUsage(usage: AiRequestUsage): number | null {
  if (!hasCoreUsage(usage)) return null;
  return costMicros(usage.promptTokens, GPT_4O_MINI_TRANSCRIBE_AUDIO.inputMicrosPerMillion)
    + costMicros(usage.completionTokens, GPT_4O_MINI_TRANSCRIBE_AUDIO.outputMicrosPerMillion);
}

export function estimateAiRequestCost(params: {
  provider: AiRequestMetricPayload['provider'];
  model: string;
  operationKind: AiRequestMetricPayload['operationKind'];
  usage: AiRequestUsage;
}): PricingEstimate {
  if (params.provider !== 'openai') {
    return { pricingVersion: null, estimatedCostMicros: null };
  }

  if (
    params.model === 'gpt-5.6-luna'
    && params.operationKind === 'chat_completion'
  ) {
    return {
      pricingVersion: AI_PRICING_VERSION,
      estimatedCostMicros: estimateLunaTextUsage(params.usage, GPT_5_6_LUNA_TEXT),
    };
  }

  if (
    params.model === 'gpt-6-luna'
    && params.operationKind === 'chat_completion'
  ) {
    return {
      pricingVersion: GPT_6_LUNA_PRICING_VERSION,
      estimatedCostMicros: estimateLunaTextUsage(params.usage, GPT_6_LUNA_TEXT),
    };
  }

  if (
    params.model === 'gpt-4o-mini-transcribe'
    && params.operationKind === 'planning_transcription'
  ) {
    return {
      pricingVersion: AI_PRICING_VERSION,
      estimatedCostMicros: estimateTranscriptionUsage(params.usage),
    };
  }

  return { pricingVersion: null, estimatedCostMicros: null };
}
