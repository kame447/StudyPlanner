import { describe, expect, it } from 'vitest';
import { ACTUAL_CENSUS_RULES, buildActualSemanticCensus, censusRandom } from './semantic-dispatch-actual-census';
import { projectSemanticCensusMetadata, type SemanticCensusEvent } from '../shared/semanticTurnCensus';

/** Mock telemetry only. These tests are never exported or reported as production frequency. */
function documents(count: number, domain: 'weekly-planning' | 'user-context' = 'weekly-planning', dayOffset = 0) {
  return Array.from({ length: count }, (_, index) => {
    const turnId = crypto.randomUUID(); const requestId = crypto.randomUUID();
    const occurredAt = new Date(Date.parse('2026-08-02T00:00:00.000Z') + dayOffset * 86400_000 + index).toISOString();
    const base = { version: 1 as const, domain, turnId, occurredAt };
    const metadata = projectSemanticCensusMetadata({ questionCode: domain === 'weekly-planning' ? 'quantity_role_unresolved' : null, freshness: 'matched', targetCount: 1 });
    const events: SemanticCensusEvent[] = [
      { ...base, kind: 'start', metadata },
      { ...base, kind: 'request', requestId, joined: true, stage: 'initial', integrity: 'complete', route: 'luna', outcome: 'success', latencyMs: 10, lateWork: false,
        lunaDispatches: 1, jevDispatches: 0, observedLunaDispatches: 1, observedJevDispatches: 0, usage: { inputTokens: 2, outputTokens: 1, costUsd: null },
        dispatches: [{ family: 'luna', stage: 'initial', outcome: 'success', latencyMs: 5, usage: { inputTokens: 2, outputTokens: 1, costUsd: null } }] },
      { ...base, kind: 'closure', metadata, requestIds: [requestId], integrity: 'complete', semanticResolution: 'success', latencyMs: 20 },
    ];
    return events.map((payload) => ({ eventType: 'semantic_turn_census', environment: 'production', actorSubjectId: `actor-00000000-0000-4000-8000-${String(index % 10).padStart(12, '0')}`, payload }));
  }).flat();
}
const artifact = (rows = documents(200), phase = 'initial') => ({ version: 2, source: 'observability_events', environment: 'production', activationAt: '2026-08-01T01:00:00.000Z', phase, documents: rows });
const at = Date.parse('2026-09-01T00:00:00.000Z');
describe('preregistered actual-only aggregation, using mock telemetry', () => {
  it('matches an independently computed SHA256/xoshiro128** known-answer vector and first cluster draws', () => {
    const random = censusRandom();
    expect(Array.from({ length: 8 }, random)).toEqual([3496505266, 3172068920, 222532698, 2499666478, 677103084, 2071857059, 511931924, 2760286072]);
    const first = censusRandom(); expect(Array.from({ length: 3 }, () => Math.floor(first() * 3 / 2 ** 32))).toEqual([2, 2, 0]);
    expect(() => censusRandom('changed')).toThrow('preregistration');
  });
  it('retains every started turn, counts unknown as ineligible, and keeps missing cost/correctness NA', () => {
    const rows = documents(201); rows.pop(); // last turn has no closure
    const result = buildActualSemanticCensus(artifact(rows), at);
    const weekly = result.populations[0];
    expect(weekly).toMatchObject({ allTurns: 201, completeTurns: 200, unknownTurns: 1, knownActors: 10,
      d1: { numerator: 200, denominator: 201, primaryRate: 200 / 201, completeOnlyRate: 1 },
      lunaDispatches: null, usage: { costUsd: null }, correctlyResolvedAndFreeRate: null });
    expect(weekly.structure.D5).toMatchObject({ eligible: 0, unknown: 1, denominator: 201 });
    const output = JSON.stringify(result);
    for (const document of rows) {
      expect(output).not.toContain(document.payload.turnId);
      expect(output).not.toContain(document.actorSubjectId);
      if (document.payload.kind === 'request') expect(output).not.toContain(document.payload.requestId);
    }
    expect(output).not.toContain('actorSubjectId');
  });
  it('separates weekly and user-context populations and never treats machine state as proposition truth', () => {
    const result = buildActualSemanticCensus(artifact([...documents(200), ...documents(4, 'user-context')]), at);
    expect(result.populations.map((item) => item.allTurns)).toEqual([200, 4]);
    expect(result.populations[0].d1.oneSided95LowerBound).toBe(1);
    expect(result.status).toBe('PASS-STRUCTURE-ONLY');
    expect(result.populations[1].structure.C5.eligible).toBe(0);
  });
  it('deduplicates ingestion, but inconsistent duplicate/count records cannot be complete', () => {
    const rows = documents(201); rows.push(structuredClone(rows[0]));
    expect(buildActualSemanticCensus(artifact(rows), at).populations[0].allTurns).toBe(201);
    const broken = rows[rows.length - 3].payload;
    if (broken.kind !== 'request') throw new Error('Expected request');
    broken.lunaDispatches = 0;
    const result = buildActualSemanticCensus(artifact(rows), at);
    expect(result.populations[0]).toMatchObject({ allTurns: 201, completeTurns: 200, unknownTurns: 1 });
  });
  it('does not misclassify unjoined provider requests as semantic turns or free evidence', () => {
    const rows = documents(200); const orphan = documents(1)[1];
    if (orphan.payload.kind !== 'request') throw new Error('Expected request');
    orphan.payload.joined = false; rows.push(orphan, structuredClone(orphan));
    const result = buildActualSemanticCensus(artifact(rows), at);
    expect(result.status).toBe('HOLD-UNJOINED-REQUESTS');
    expect(result.unjoinedRequests).toEqual({ 'weekly-planning': 1, 'user-context': 0 });
    expect(result.populations).toEqual([]);
    expect(result.diagnostics).toMatchObject({ startedWeeklyTurns: 200, observedUnjoinedLunaDispatches: 1, rawFreeTurns: null, semanticLunaFreeTurns: null });
  });
  it('ignores unjoined requests outside the closed window and isolates user-context coverage gaps', () => {
    const rows = [...documents(200), ...documents(1, 'user-context')];
    const outside = documents(1, 'weekly-planning', 40)[1];
    const orphan = documents(1, 'user-context')[1];
    if (outside.payload.kind !== 'request' || orphan.payload.kind !== 'request') throw new Error('Expected requests');
    outside.payload.joined = false; orphan.payload.joined = false; rows.push(outside, orphan);
    const result = buildActualSemanticCensus(artifact(rows), at);
    expect(result.status).toBe('PASS-STRUCTURE-ONLY');
    expect(result.populations[0].completeTurns).toBe(200);
    expect(result.populations[1]).toMatchObject({ allTurns: 1, completeTurns: 0, lunaDispatches: null, semanticLunaFreeTurns: null, unjoinedObservedLunaDispatches: 1 });
  });
  it('does not fabricate an elapsed whole-turn measurement from late Worker work', () => {
    const rows = documents(200); const request = rows[1].payload;
    if (request.kind !== 'request') throw new Error('Expected request'); request.lateWork = true;
    const result = buildActualSemanticCensus(artifact(rows), at);
    expect(result.populations[0].latencyMs).toMatchObject({ knownTurns: 199, unknownTurns: 1 });
  });
  it('holds when unknown actors would otherwise inflate the known cluster count', () => {
    const rows = documents(200); rows.forEach((row) => { row.actorSubjectId = 'unknown'; });
    const result = buildActualSemanticCensus(artifact(rows), at);
    expect(result.populations[0].knownActors).toBe(0); expect(result.status).toBe('HOLD');
  });
  it('uses next JST midnight, refuses peeking/overrides and extends once based only on complete count', () => {
    expect(() => buildActualSemanticCensus(artifact(), Date.parse('2026-08-14'))).toThrow('peeking');
    expect(() => buildActualSemanticCensus({ ...artifact(), seed: 'favorable' }, at)).toThrow('preregistration');
    expect(() => buildActualSemanticCensus({ ...artifact(), windowStart: '2026-08-01' }, at)).toThrow('preregistration');
    const initial = buildActualSemanticCensus(artifact(documents(199)), at);
    expect(initial).toMatchObject({ status: 'EXTEND-ONCE', completeTurns: 199, populations: [], window: { start: '2026-08-01T15:00:00.000Z', end: '2026-08-15T15:00:00.000Z' } });
    expect(() => buildActualSemanticCensus(artifact(documents(200), 'extended'), at)).toThrow('Extension prohibited');
    const extended = buildActualSemanticCensus(artifact([...documents(199), ...documents(1, 'weekly-planning', 16)], 'extended'), at);
    expect(extended.populations[0].completeTurns).toBe(200);
    expect(() => buildActualSemanticCensus({ ...artifact(), environment: 'test' }, at)).toThrow('Fixtures');
    expect(ACTUAL_CENSUS_RULES.replicates).toBe(20000);
  });
});
