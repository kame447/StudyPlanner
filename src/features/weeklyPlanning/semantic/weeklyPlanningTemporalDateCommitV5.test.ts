import { describe, expect, it, vi } from 'vitest';
import { createCandidateManifest, createSelectionLedger, type CandidateChoiceRequest } from '../application/candidateSelection';
import { fixturePolicy, responseFor } from '../application/candidateSelection/fixtures.testUtils';
import { createTemporalDateBasisV5, selectTemporalDateChoiceV5, type TemporalDateTupleV5, type TemporalDateViewV5 } from './weeklyPlanningTemporalDateChoiceV5';
import { prepareTemporalDateCommitV5, createTemporalDateControlledAdapterV5 } from './weeklyPlanningTemporalDateCommitV5';
import { temporalDateFixtureV5 } from './weeklyPlanningTemporalDateChoiceV5.testUtils';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';

async function fixture(options: { withIndependentCondition?: boolean; kind?: 'available' | 'unavailable' } = {}) {
  const f = temporalDateFixtureV5(options.withIndependentCondition);
  if (options.kind) f.target.kind = options.kind;
  const captured = createTemporalDateBasisV5({ input: f.input, binding: f.binding, calendar: f.calendar, domainPolicyVersion: f.domainPolicyVersion })!;
  const view: TemporalDateViewV5 = { input: f.input, binding: f.binding, calendar: f.calendar, domainPolicyVersion: f.domainPolicyVersion, questionBasis: structuredClone({ scope: captured.binding.scope, sources: captured.binding.sources }), sourceAccess: 'allowed', intentProvenance: 'validated_current_turn', questionPresentation: 'fresh' };
  const basis = createTemporalDateBasisV5(view)!; const manifest = await createCandidateManifest(basis);
  const choose = vi.fn(async (request: CandidateChoiceRequest<TemporalDateTupleV5>, beforeDispatch: () => void) => {
    beforeDispatch(); const leaf = request.menu.options.find(option => option.kind === 'leaf' && option.candidate.id === 'temporal-date:2');
    return responseFor(request, leaf!.id);
  });
  const port = { choicePolicy: fixturePolicy(manifest, 7), readCurrent: () => view, choose };
  const staged = await selectTemporalDateChoiceV5(port);
  if (!staged) throw new Error('Expected fixture date selection');
  const atomic = { ...view, ledger: createSelectionLedger('owner', 'conversation'), turnId: 'date-answer-turn' };
  return { f, view, port, staged, atomic, choose };
}

describe('D5prime single-date formal correction adapter', () => {
  it('replaces exactly one date, retains clocks/polarity and supersedes the old fact with current answer evidence', async () => {
    const h = await fixture(); const before = JSON.stringify(h.f.graph);
    const result = prepareTemporalDateCommitV5(h.staged, h.atomic);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') throw new Error(JSON.stringify(result));
    const replacement = result.graph.availabilityDeclarations.find(fact => fact.id !== h.f.target.id)!;
    expect(replacement).toMatchObject({ dateExpression: '2026-10-07', startTime: '18:00', endTime: '20:00', kind: 'unavailable', constraintLevel: 'hard', source: { sourceText: '10月7日です' } });
    expect(isWeeklyPlanningFactActiveV5(result.graph, h.f.target.id)).toBe(false);
    expect(isWeeklyPlanningFactActiveV5(result.graph, replacement.id)).toBe(true);
    expect(result.nextLedger.consumed).toHaveLength(1);
    expect(result.semanticContribution.canonicalization.diff?.superseded).toContainEqual({ kind: 'availability_declaration', id: h.f.target.id });
    expect(result.semanticContribution.canonicalization.diff?.added).toContainEqual({ kind: 'availability_declaration', id: replacement.id });
    expect(h.choose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.f.graph)).toBe(before);
  });
  it.each(['available', 'unavailable'] as const)('preserves a separate interpreted availability when repairing %s', async kind => {
    const h = await fixture({ withIndependentCondition: true, kind });
    const independent = h.f.graph.availabilityDeclarations[1];
    const before = structuredClone(independent);
    const result = prepareTemporalDateCommitV5(h.staged, h.atomic);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') throw new Error(JSON.stringify(result));
    expect(result.graph.availabilityDeclarations.find(fact => fact.id === independent.id)).toEqual(before);
    expect(isWeeklyPlanningFactActiveV5(result.graph, independent.id)).toBe(true);
    expect(result.semanticContribution.canonicalization.diff?.superseded).toEqual([{ kind: 'availability_declaration', id: h.f.target.id }]);
    const replacement = result.graph.availabilityDeclarations.find(fact => !h.f.graph.availabilityDeclarations.some(old => old.id === fact.id));
    expect(replacement).toMatchObject({ kind, dateExpression: '2026-10-07', startTime: '18:00', endTime: '20:00' });
    expect(result.graph.decisionIntents).toEqual([]);
  });
  it.each(['input', 'source', 'horizon', 'epoch', 'presentation', 'permission', 'graph revision', 'other target', 'reference date', 'timezone', 'week start', 'domain policy'])(
    'rejects %s drift after the choice with no partial graph/ledger write', async kind => {
      const h = await fixture(); const live = structuredClone(h.atomic);
      if (kind === 'input') live.input.userText += '保存もして';
      if (kind === 'source') live.input.committedGraph!.availabilityDeclarations[0].startTime = '17:00';
      if (kind === 'horizon') { live.input.committedGraph!.planningWindows[0].end = '2026-10-10'; live.input.committedGraph!.planningWindows[0].value = '2026-10-05/2026-10-10'; }
      if (kind === 'epoch') live.binding = { ...live.binding, selectionEpoch: 2 };
      if (kind === 'presentation') live.binding = { ...live.binding, question: { ...live.binding.question, presentingMessageId: 'new-question' } };
      if (kind === 'permission') live.sourceAccess = 'denied';
      if (kind === 'graph revision') live.input.committedGraph!.revision++;
      if (kind === 'reference date') live.calendar = { ...live.calendar, referenceDate: '2026-10-06' };
      if (kind === 'timezone') live.calendar = { ...live.calendar, timeZone: 'UTC' };
      if (kind === 'domain policy') live.domainPolicyVersion = 'diagnostic-date-policy-v2';
      if (kind === 'week start') live.calendar = { ...live.calendar, weekStartsOn: 'sunday' };
      if (kind === 'other target') live.binding = { ...live.binding, target: { kind: 'availability_declaration', id: 'foreign-source' } };
      expect(prepareTemporalDateCommitV5(h.staged, live).status).toBe('rejected');
      expect(live.ledger.consumed).toEqual([]);
    },
  );
  it('rejects a date outside the complete menu and repeated consumption', async () => {
    const h = await fixture();
    const forged = { ...h.staged, selection: { ...h.staged.selection, candidate: { ...h.staged.selection.candidate, tuple: { ...h.staged.selection.candidate.tuple, dateExpression: '2026-11-01' } } } };
    expect(prepareTemporalDateCommitV5(forged, h.atomic).status).toBe('rejected');
    const result = prepareTemporalDateCommitV5(h.staged, h.atomic);
    if (result.status !== 'prepared') throw new Error(JSON.stringify(result));
    expect(prepareTemporalDateCommitV5(h.staged, { ...h.atomic, ledger: result.nextLedger }).status).toBe('rejected');
  });
  it.each(['none', 'mixed', 'low probability', 'unavailable'])(
    'returns no selection for %s so the caller can preserve the whole original fallback', async kind => {
      const h = await fixture();
      h.port.choose = vi.fn(async (request, beforeDispatch) => {
        beforeDispatch();
        if (kind === 'unavailable') return { status: 'unavailable' } as never;
        const response = responseFor(request, kind === 'none' ? 'none' : request.menu.options.find(option => option.kind === 'leaf' && option.candidate.id === 'temporal-date:2')!.id);
        if (kind === 'mixed') response.semanticSufficiency = 'other_or_uncertain';
        if (kind === 'low probability') response.probabilities = request.menu.options.map(option => ({ optionId: option.id, probability: 1 / request.menu.options.length }));
        return response;
      });
      expect(await selectTemporalDateChoiceV5(h.port)).toBeNull();
      expect(h.view.input.userText).toBe('10月7日です');
      expect(h.atomic.ledger.consumed).toEqual([]);
    },
  );
  it('retains the structural controlled port handoff; no branded reducer receipt is fabricated', async () => {
    const h = await fixture(); const ledger = { ...h.atomic.ledger, version: 1 as const, lastEpoch: 1 };
    let runtime = h.f.graph; let guard = () => false;
    const bridge = {
      readCurrent: () => ({ ...h.atomic, ledger, current: { intakeState: { c5SelectionLedger: ledger } } }),
      readRuntimeGraph: () => runtime,
      prepareLocalCandidateReducerCommit: vi.fn((input: { revalidateFinalized(): boolean }) => { guard = input.revalidateFinalized; return 'receipt-issued-by-controller'; }),
    };
    const adapter = createTemporalDateControlledAdapterV5(h.staged, bridge)!;
    expect(adapter.prepare()).toBe('receipt-issued-by-controller');
    expect(guard()).toBe(false);
    runtime = adapter.selected.graph;
    expect(guard()).toBe(true);
    // readCurrent retains atomic observation; an actual consumer must independently re-read it.
    h.atomic.sourceAccess = 'denied';
    expect(guard()).toBe(false);
  });
  it('exposes only the fixed typed scope and whole current reply, never source history/owner/ledger', async () => {
    const h = await fixture(); const request = h.choose.mock.calls[0][0];
    const wire = JSON.stringify(request);
    expect(wire).toContain('10月7日です'); expect(wire).toContain('18:00'); expect(wire).toContain('20:00');
    expect(wire).not.toContain(h.f.target.source.sourceText);
    expect(request).not.toHaveProperty('binding'); expect(request.context).not.toHaveProperty('sources');
    expect(request.context).not.toHaveProperty('ownerId'); expect(request.context).not.toHaveProperty('ledger');
    expect(Buffer.byteLength(wire)).toBeLessThan(8000);
  });
  it('revalidates after an async authentication step before the first provider send', async () => {
    const h = await fixture(); let sends = 0;
    const result = await selectTemporalDateChoiceV5({ ...h.port, choose: async (request, beforeDispatch) => {
      await Promise.resolve(); h.view.input.committedGraph!.revision++;
      beforeDispatch(); sends++; return responseFor(request, 'leaf:2');
    } });
    expect(result).toBeNull(); expect(sends).toBe(0); expect(h.atomic.ledger.consumed).toEqual([]);
  });

  it('rejects calendar changes already present before the reply and legacy missing question basis', async () => {
    const h = await fixture();
    const shifted = { ...h.view, calendar: { ...h.view.calendar, referenceDate: '2026-10-06' } };
    const choose = vi.fn(h.port.choose);
    expect(await selectTemporalDateChoiceV5({ ...h.port, readCurrent: () => shifted, choose })).toBeNull();
    expect(choose).not.toHaveBeenCalled();
    expect(await selectTemporalDateChoiceV5({ ...h.port, readCurrent: () => ({ ...h.view, questionBasis: null }), choose })).toBeNull();
    expect(choose).not.toHaveBeenCalled();
  });

});
