import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSemanticCensus, parseCensusArtifact, structuralEligibility } from './semantic-dispatch-census-core.ts';
import { legacyArtifactRows, unknownCensusLabel } from './semantic-dispatch-census-inventory.ts';
import { runSemanticCensus } from './semantic-dispatch-census.mjs';

function row(overrides = {}) {
  const corpusId = crypto.randomUUID(); const turnId = crypto.randomUUID(); const requestId = crypto.randomUUID();
  const population = { source: 'fixture', domain: 'weekly-planning', arm: 'baseline', corpusId };
  return { turn: { version: 1, population, turnId, pairId: crypto.randomUUID(), expectedRequestIds: [requestId], sealed: true, startedAtMs: 1, completedAtMs: 100, semanticResolution: 'success', mutatingCommit: false }, requests: [{ version: 1, population, turnId, requestId, stage: 'initial', boundary: 'worker', startedAtMs: 1, mainCompletedAtMs: 90, settledAtMs: 100, integrity: 'complete', dispatchIds: [], dispatches: [] }], questionCode: 'ambiguous_effort_estimate', route: 'jev', baselineModel: 'luna', mode: 'fixture', label: { ...unknownCensusLabel(crypto.randomUUID()), source: 'human', use: 'fresh', independence: 'independent', targetCount: 1, propositionCount: 1, openValueKinds: [], c5Reference: 'ordinal', manifestComplete: true, scopeClosed: true, candidateCount: 2, jointCorrect: true }, ...overrides };
}
afterEach(() => vi.unstubAllGlobals());

describe('Phase 0 structural census, never lexical semantics', () => {
  it('requires complete typed tuples and provenance; missing labels are NA', () => {
    const input = row(); expect(structuralEligibility(input, 'C5')).toBe('eligible');
    expect(structuralEligibility({ ...input, label: null }, 'C5')).toBe('unknown');
    expect(structuralEligibility({ ...input, label: { ...input.label, c5Reference: 'new-value' } }, 'C5')).toBe('ineligible');
    const d5 = { ...input, questionCode: 'missing_effort_estimate', label: { ...input.label, valueTuple: 'single-value', tupleComplete: true } };
    expect(structuralEligibility(d5, 'D5')).toBe('eligible');
    const clock = { ...d5, questionCode: 'missing_time_bounds', label: { ...d5.label, valueTuple: 'one-side-fixed', overnight: false, endAt24: false, exceptions: false } };
    expect(structuralEligibility(clock, 'D5-prime')).toBe('eligible');
    expect(structuralEligibility({ ...clock, label: { ...clock.label, valueTuple: 'both-sides', tupleComplete: null } }, 'D5-prime')).toBe('unknown');
    expect(structuralEligibility({ ...clock, label: { ...clock.label, overnight: true } }, 'D5-prime')).toBe('ineligible');
    const material = { ...input, questionCode: 'selected_material_remaining', label: { ...input.label, materialAdapter: true, explicitCurrentIntent: true, selectedMaterialCount: 1 } };
    expect(structuralEligibility(material, 'D6')).toBe('eligible');
    expect(structuralEligibility({ ...material, label: { ...material.label, explicitCurrentIntent: null } }, 'D6')).toBe('unknown');
  });
  it('keeps all turns in the denominator, with unknown intervals and three distinct rates', () => {
    const a = row(); const b = row(); b.turn.population = a.turn.population; b.requests[0].population = a.turn.population; b.turn.sealed = false;
    const report = buildSemanticCensus([a, b]); const group = report.populations[0];
    expect(group).toMatchObject({ allTurns: 2, knownTurns: 1, unknownTurns: 1, semanticLunaFreeRate: null, semanticLunaFreeRateBounds: [.5, 1], lunaDispatchesPerTurn: null, usage: { costUsd: null }, rates: { rawDispatchFreeRate: null, correctSemanticResolutionAndFreeRate: null, mutatingCommitRate: 0 } });
    expect(group.questions[0].eligibility.C5.structurallyEligibleRates.denominator).toBe(2);
    expect(buildSemanticCensus([a]).populations[0].rates).toEqual({ denominator: 1, rawDispatchFreeRate: 1, correctSemanticResolutionAndFreeRate: 1, mutatingCommitRate: 0 });
  });
  it('never pools source, domain, arm, corpus, model or mode', () => {
    const input = row();
    const rows = [input, ...[{ source: 'actual' }, { source: 'synthetic' }, { domain: 'user-context' }, { arm: 'treatment' }, { corpusId: crypto.randomUUID() }].map((change) => {
      const next = structuredClone(input); Object.assign(next.turn.population, change); next.requests[0].population = next.turn.population; next.turn.turnId = crypto.randomUUID(); next.requests[0].turnId = next.turn.turnId; return next;
    }), { ...row(), baselineModel: 'other' }, { ...row(), mode: 'off' }];
    expect(buildSemanticCensus(rows).populations).toHaveLength(8);
  });
  it('does not reinterpret text, expected routes, attempts or missing measurements in historical artifacts', () => {
    const imported = legacyArtifactRows({ cases: [{ currentUserText: 'private-text', expectedRoute: 'external_owner', lunaCalled: false, attemptCount: 0, durationMs: 0 }] }, { artifactIdentity: 'diagnostic-test', domain: 'user-context', arm: 'baseline' });
    const report = buildSemanticCensus(imported);
    expect(report.populations[0]).toMatchObject({ allTurns: 1, unknownTurns: 1, lunaDispatchesPerTurn: null, usage: { costUsd: null }, latencyMs: { p50: null } });
    expect(report.actualFrequency).toContain('unknown'); expect(JSON.stringify(report)).not.toContain('private-text');
  });
  it('deduplicates exact ingestion and marks conflicting ingestion unknown', () => {
    const input = row(); expect(buildSemanticCensus([input, structuredClone(input)]).populations[0].allTurns).toBe(1);
    const changed = structuredClone(input); changed.requests[0].integrity = 'unknown';
    expect(buildSemanticCensus([input, changed]).populations[0]).toMatchObject({ allTurns: 1, unknownTurns: 1, semanticLunaFreeRate: null });
  });
  it('sanitizes user fields and refuses invalid framing; truncated dispatch lists are unknown', () => {
    const input = row(); input.rawUserText = 'private-sentinel'; input.label.privateNote = 'private-sentinel'; input.turn.population.user = 'private-sentinel'; input.questionCode = 'private-sentinel';
    const parsed = parseCensusArtifact({ version: 1, rows: [input] }); expect(JSON.stringify(buildSemanticCensus(parsed))).not.toContain('private-sentinel');
    delete input.requests[0].dispatches;
    expect(buildSemanticCensus(parseCensusArtifact({ version: 1, rows: [input] })).populations[0].unknownTurns).toBe(1);
    delete input.turn.expectedRequestIds;
    expect(() => parseCensusArtifact({ version: 1, rows: [input] })).toThrow('manifest');
  });
  it('cannot make correctness or extra meaning from machine-state telemetry', () => {
    const input = row(); input.label.source = 'machine-state'; input.label.openValueKinds = ['new_title'];
    const report = buildSemanticCensus(parseCensusArtifact({ version: 1, rows: [input] }));
    expect(report.populations[0].rates.correctSemanticResolutionAndFreeRate).toBeNull();
    expect(report.populations[0].questions[0]).toMatchObject({ propositions: { NA: 1 }, openValueKinds: { NA: 1 } });
  });
  it('executes the offline CLI with the shared reducer and persists only the sanitized aggregate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'semantic-census-test-'));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Offline tooling attempted network.'); }));
    try {
      const input = join(directory, 'input.json'); const output = join(directory, 'output.json');
      const source = row(); source.rawUserText = 'private-census-sentinel';
      await writeFile(input, JSON.stringify({ version: 1, rows: [source] }));
      const report = await runSemanticCensus(['--input', input, '--output', output]);
      expect(report.populations[0].knownTurns).toBe(1);
      expect(await readFile(output, 'utf8')).not.toContain('private-census-sentinel');
      expect(fetch).not.toHaveBeenCalled();
      await expect(runSemanticCensus(['--input', input, '--output', output])).rejects.toThrow();
    } finally { await rm(directory, { recursive: true }); }
  });
});
