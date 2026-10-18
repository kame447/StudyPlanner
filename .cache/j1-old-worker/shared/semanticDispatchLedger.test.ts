import { describe, expect, it } from 'vitest';
import { pairedSemanticDispatchDelta, summarizeSemanticTurn, type SemanticDispatch, type SemanticRequestObservation, type SemanticTurnObservation } from './semanticDispatchLedger';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const population = { source: 'fixture', domain: 'weekly-planning', arm: 'baseline', corpusId: id(99) } as const;
const turn = (): SemanticTurnObservation => ({ version: 1, population, turnId: id(1), pairId: id(2), expectedRequestIds: [id(3)], sealed: true, startedAtMs: 0, completedAtMs: 100, semanticResolution: 'failure' });
const dispatch = (n = 4): SemanticDispatch => ({ dispatchId: id(n), requestId: id(3), turnId: id(1), provider: 'openai', family: 'luna', stage: 'focused', startedAtMs: 10, completedAtMs: 50, outcome: 'network_error', usage: { inputTokens: null, outputTokens: null, costUsd: null } });
const request = (): SemanticRequestObservation => ({ version: 1, population, turnId: id(1), requestId: id(3), stage: 'focused', boundary: 'worker', startedAtMs: 0, mainCompletedAtMs: 60, settledAtMs: 90, integrity: 'complete', dispatchIds: [id(4)], dispatches: [dispatch()] });

describe('all-turn provider dispatch ledger', () => {
  it('counts failed real calls without usage, deduplicates ingestion and retains real retries', () => {
    const row = request(); row.dispatches.push({ ...dispatch(5), stage: 'retry' }); row.dispatchIds?.push(id(5));
    const summary = summarizeSemanticTurn(turn(), [row, structuredClone(row)]);
    expect(summary).toMatchObject({ status: 'known', lunaDispatches: 2, lunaFree: false, elapsedMs: 100, usage: { costUsd: null, inputTokens: null }, dispatchesByStage: { focused: 1, retry: 1 } });
  });
  it('reports a known pre-provider zero separately from successful semantic resolution', () => {
    const row = request(); row.dispatches = []; row.dispatchIds = [];
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ lunaDispatches: 0, lunaFree: true, semanticResolution: 'failure', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } });
  });
  it('counts Jev then Luna in the same proxy request; Jev-only is zero Luna', () => {
    const row = request(); row.dispatches = [{ ...dispatch(6), family: 'jev', provider: 'openrouter' }, dispatch()]; row.dispatchIds = [id(6), id(4)];
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ lunaDispatches: 1, jevDispatches: 1, lunaFree: false });
    row.dispatches.pop(); row.dispatchIds.pop();
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ lunaDispatches: 0, jevDispatches: 1, lunaFree: true });
  });
  it.each(['missing', 'unobserved', 'dropped', 'unjoined', 'unfinished', 'mixed', 'conflict', 'extra', 'unsealed'])("never counts %s evidence as a free turn", (fault) => {
    const row = request(); const input = turn(); let rows = [row];
    if (fault === 'missing') rows = [];
    if (fault === 'unobserved') row.boundary = 'unobserved_proxy';
    if (fault === 'dropped') row.integrity = 'unknown';
    if (fault === 'unjoined') row.dispatches[0].requestId = id(18);
    if (fault === 'unfinished') row.settledAtMs = null;
    if (fault === 'mixed') row.population = { ...population, domain: 'user-context' };
    if (fault === 'conflict') rows.push({ ...row, dispatches: [] });
    if (fault === 'extra') input.expectedRequestIds = [];
    if (fault === 'unsealed') input.sealed = false;
    expect(summarizeSemanticTurn(input, rows)).toMatchObject({ status: 'unknown', lunaDispatches: null, lunaFree: null, elapsedMs: null, usage: { costUsd: null } });
  });
  it('keeps partial usage unknown per metric and measures one elapsed interval for parallel work', () => {
    const row = request(); row.dispatches[0].usage = { inputTokens: 10, outputTokens: null, costUsd: null };
    row.dispatches.push({ ...dispatch(7), stage: 'race', startedAtMs: 15, completedAtMs: 80, usage: { inputTokens: 20, outputTokens: 5, costUsd: 0.01 } }); row.dispatchIds?.push(id(7));
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ elapsedMs: 100, usage: { inputTokens: 30, outputTokens: null, costUsd: null } });
  });
  it('joins only identical paired turns in separate arms and populations', () => {
    const baseline = summarizeSemanticTurn(turn(), [request()]);
    const input = turn(); input.population = { ...population, arm: 'treatment' };
    const row = request(); row.population = input.population; row.dispatches = []; row.dispatchIds = [];
    const treatment = summarizeSemanticTurn(input, [row]);
    expect(pairedSemanticDispatchDelta(baseline, treatment)).toBe(-1);
    expect(pairedSemanticDispatchDelta(baseline, { ...treatment, pairId: id(20) })).toBeNull();
    expect(pairedSemanticDispatchDelta(baseline, { ...treatment, population: { ...input.population, source: 'synthetic' } })).toBeNull();
  });
  it.each(['family-unrecognized', 'family-missing', 'boundary', 'population', 'stage', 'outcome', 'usage-null', 'usage-missing', 'dispatch-array-missing', 'dispatch-record-dropped', 'version'])('rejects imported %s evidence at the reducer itself', (fault) => {
    const input = request();
    const malformed = input as unknown as Record<string, unknown>;
    const call = input.dispatches[0] as unknown as Record<string, unknown>;
    if (fault === 'family-unrecognized') call.family = 'unrecognized';
    if (fault === 'family-missing') delete call.family;
    if (fault === 'boundary') malformed.boundary = 'browser-success';
    if (fault === 'population') malformed.population = { ...population, source: 'unknown' };
    if (fault === 'stage') call.stage = 'renderer';
    if (fault === 'outcome') call.outcome = 'accepted';
    if (fault === 'usage-null') call.usage = null;
    if (fault === 'usage-missing') delete call.usage;
    if (fault === 'dispatch-array-missing') delete malformed.dispatches;
    if (fault === 'dispatch-record-dropped') input.dispatches = [];
    if (fault === 'version') malformed.version = 9;
    expect(summarizeSemanticTurn(turn(), [input])).toMatchObject({ status: 'unknown', lunaDispatches: null, lunaFree: null });
  });
  it('supports genuine other-model calls while unknown family stays unknown', () => {
    const row = request(); row.dispatches[0].family = 'other';
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ status: 'known', lunaDispatches: 0, lunaFree: true });
    row.dispatches[0].family = 'unknown';
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ status: 'unknown', lunaDispatches: null, lunaFree: null });
  });
  it('allows observation closure after the semantic interval, without adding telemetry-only time', () => {
    const row = request(); row.settledAtMs = 500;
    expect(summarizeSemanticTurn(turn(), [row])).toMatchObject({ elapsedMs: 100, status: 'known' });
  });
});
