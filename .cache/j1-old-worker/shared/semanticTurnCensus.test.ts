import { describe, expect, it } from 'vitest';
import { createSemanticRequestRecorder } from './semanticDispatchRecorder';
import { parseSemanticCensusEvent, parseSemanticCensusJoin, projectSemanticCensusMetadata, projectSemanticCensusRequest, SEMANTIC_CENSUS_MAX_BYTES } from './semanticTurnCensus';

async function observation() {
  const recorder = createSemanticRequestRecorder({ population: { source: 'actual', domain: 'weekly-planning', arm: 'baseline', corpusId: crypto.randomUUID() }, turnId: crypto.randomUUID(), requestId: crypto.randomUUID(), stage: 'initial', boundary: 'worker' });
  await recorder.providerFetch('openai', 'luna', 'initial', async () => Response.json({ choices: [{ message: { content: 'private-generated-sentinel' } }] }))('https://provider.test/private', { body: '生の発話-sentinel', headers: { Authorization: 'secret-sentinel' } });
  recorder.finishMain(); await recorder.settle(); return recorder.snapshot();
}
describe('production census closed schema', () => {
  it('projects only enumerations/counts/hash metadata; arbitrary strings and properties disappear', () => {
    const value = projectSemanticCensusMetadata({ questionCode: 'private-label', targetCount: -1, propositionCategories: ['private-text'], candidateHash: { algorithm: 'sha256', digest: 'secret' }, binding: 'private-context', extra: 'private-text' });
    expect(value).toEqual({ questionCode: null, targetCount: null, propositionCount: null, propositionCategories: null, candidateCount: null, candidateHash: null, binding: 'unknown', freshness: 'unknown' });
  });
  it('does not persist raw utterance, generated text, authorization or laboratory IDs', async () => {
    const input = await observation(); const event = projectSemanticCensusRequest(input, true, 200);
    expect(parseSemanticCensusEvent(event)).toEqual(event);
    const serialized = JSON.stringify(event);
    for (const forbidden of ['private-', 'sentinel', input.population.corpusId, input.dispatches[0].dispatchId, 'pairId', 'provider']) expect(serialized).not.toContain(forbidden);
    expect(event).toMatchObject({ integrity: 'complete', lunaDispatches: 1, jevDispatches: 0, usage: { inputTokens: null, outputTokens: null, costUsd: null } });
  });
  it.each(['family', 'unobserved_proxy', 'turn_join', 'time_reversal', 'missing_manifest', 'duplicate_dispatch'] as const)('keeps %s observation unknown before removing correlation IDs', async (variant) => {
    const input = await observation();
    if (variant === 'family') input.dispatches[0].family = 'unrecognized' as never;
    if (variant === 'unobserved_proxy') { input.boundary = 'unobserved_proxy'; input.dispatches = []; input.dispatchIds = []; }
    if (variant === 'turn_join') input.dispatches[0].turnId = crypto.randomUUID();
    if (variant === 'time_reversal') input.dispatches[0].completedAtMs = input.dispatches[0].startedAtMs - 1;
    if (variant === 'missing_manifest') input.dispatchIds = [];
    if (variant === 'duplicate_dispatch') { input.dispatches.push(input.dispatches[0]); input.dispatchIds!.push(input.dispatchIds![0]); }
    const event = projectSemanticCensusRequest(input, true, 200);
    expect(event).toMatchObject({ integrity: 'unknown', lunaDispatches: null, jevDispatches: null, route: 'unknown', latencyMs: null });
    expect(parseSemanticCensusEvent(event)).not.toBeNull();
  });
  it('rejects self-contradicting counts/usage and added raw fields at the receiving boundary', async () => {
    const event = projectSemanticCensusRequest(await observation(), true, 200);
    expect(parseSemanticCensusEvent({ ...event, lunaDispatches: 0 })).toBeNull();
    expect(parseSemanticCensusEvent({ ...event, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } })).toBeNull();
    expect(parseSemanticCensusEvent({ ...event, generatedText: 'private-sentinel' })).toBeNull();
    expect(parseSemanticCensusEvent({ ...event, dispatches: event.dispatches.map((item) => ({ ...item, secret: 'sentinel' })) })).toBeNull();
  });
  it('rejects arbitrary join IDs and byte-budget violations', () => {
    expect(parseSemanticCensusJoin({ version: 1, domain: 'weekly-planning', turnId: 'private-user-id', requestId: crypto.randomUUID(), stage: 'initial' })).toBeNull();
    const event = { version: 1, kind: 'start', domain: 'weekly-planning', turnId: crypto.randomUUID(), occurredAt: new Date().toISOString(), metadata: projectSemanticCensusMetadata(null) };
    expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThan(SEMANTIC_CENSUS_MAX_BYTES);
    expect(parseSemanticCensusEvent({ ...event, oversized: 'x'.repeat(SEMANTIC_CENSUS_MAX_BYTES) })).toBeNull();
  });
});
