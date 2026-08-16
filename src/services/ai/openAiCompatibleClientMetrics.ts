import type { AiChatPurpose } from '../../lib/aiModelPolicy';

export interface OpenAiCompatibleRequestMetric {
  sequence: number;
  purpose: AiChatPurpose | 'general';
  phase: 'initial' | 'repair' | 'single';
  model: string;
  transport: 'direct' | 'proxy';
  status: 'success' | 'failure';
  requestBytes: number;
  responseBytes: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

const MAX_METRICS = 100;
let metrics: OpenAiCompatibleRequestMetric[] = [];
let metricSequence = 0;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function recordOpenAiCompatibleRequestMetric(
  metric: Omit<OpenAiCompatibleRequestMetric, 'sequence'>,
): void {
  metricSequence += 1;
  const recorded = { sequence: metricSequence, ...metric };
  metrics.push(recorded);
  if (metrics.length > MAX_METRICS) {
    metrics = metrics.slice(-MAX_METRICS);
  }
  // Evaluation-only caller enables collection explicitly. Do not include prompts,
  // responses, API keys, user identifiers, or provider error bodies in this log.
  console.info('[AI Eval Metric]', JSON.stringify(recorded));
}

export function takeOpenAiCompatibleRequestMetrics(): OpenAiCompatibleRequestMetric[] {
  const snapshot = metrics.map((metric) => ({ ...metric }));
  metrics = [];
  return snapshot;
}

export function resetOpenAiCompatibleRequestMetricsForTest(): void {
  metrics = [];
  metricSequence = 0;
}
