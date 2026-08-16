import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/summarize-ai-eval-metrics.mjs <log> <output-json>');
}

// Input lines contain only the opt-in privacy-safe metric payload emitted by
// openAiCompatibleClientMetrics; prompts and responses are never parsed here.
const prefix = '[AI Eval Metric] ';
const lines = readFileSync(inputPath, 'utf8').split(/\r?\n/);
const metrics = [];
for (const line of lines) {
  const markerIndex = line.indexOf(prefix);
  if (markerIndex < 0) continue;
  const payload = line.slice(markerIndex + prefix.length).trim();
  if (!payload) continue;
  try {
    metrics.push(JSON.parse(payload));
  } catch {
    // Keep evaluation summarization tolerant of unrelated console formatting.
  }
}

function emptyAggregate() {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    requestBytes: 0,
    responseBytes: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    providerUsageSamples: 0,
    durationMs: 0,
  };
}

function addMetric(aggregate, metric) {
  aggregate.requestCount += 1;
  aggregate.successCount += metric.status === 'success' ? 1 : 0;
  aggregate.failureCount += metric.status === 'failure' ? 1 : 0;
  aggregate.requestBytes += Number(metric.requestBytes) || 0;
  aggregate.responseBytes += Number(metric.responseBytes) || 0;
  aggregate.durationMs += Number(metric.durationMs) || 0;
  if (Number.isFinite(metric.totalTokens)) {
    aggregate.providerUsageSamples += 1;
    aggregate.promptTokens += Number(metric.promptTokens) || 0;
    aggregate.completionTokens += Number(metric.completionTokens) || 0;
    aggregate.totalTokens += Number(metric.totalTokens) || 0;
  }
}

const total = emptyAggregate();
const byPurpose = {};
const byPhase = {};
for (const metric of metrics) {
  addMetric(total, metric);
  const purpose = String(metric.purpose ?? 'unknown');
  const phase = String(metric.phase ?? 'unknown');
  byPurpose[purpose] ??= emptyAggregate();
  byPhase[phase] ??= emptyAggregate();
  addMetric(byPurpose[purpose], metric);
  addMetric(byPhase[phase], metric);
}

const summary = {
  schemaVersion: 'studyplanner-ai-eval-metrics-v1',
  total,
  byPurpose,
  byPhase,
  metrics,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`[AI Eval Metrics Summary] requests=${total.requestCount} durationMs=${total.durationMs}`);
