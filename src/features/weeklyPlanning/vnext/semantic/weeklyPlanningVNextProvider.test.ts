import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createEmptyWeeklyPlanningVNextState, applyWeeklyPlanningVNextTurn } from './weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextProviderInterpreter } from './weeklyPlanningVNextProvider';
import { decodeVNextProviderOutput, VNEXT_PROVIDER_RESPONSE_FORMAT } from './weeklyPlanningVNextProviderSchema';
import { buildWeeklyPlanningVNextProviderMessages } from './weeklyPlanningVNextProviderPrompt';
import { checkVNextProviderScenario, VNEXT_PROVIDER_SCENARIOS } from './weeklyPlanningVNextProviderScenarios';

const emptyDelta = () => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task = (localId = 'task', title = 'Math') => ({ kind: 'task', localId, category: 'study', title });
const workload = (localId = 'work', amount: unknown = 7) => ({ kind: 'workload', localId,
  taskRef: { localId: 'task' }, componentRef: null, quantityRole: 'remaining', amount,
  unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const output = (add: unknown[] = [], answer: unknown = null) => ({ delta: { ...emptyDelta(), add }, answer });
function input(responses: (string | Error)[]): WeeklyPlanningVNextInterpretationInput {
  const state = createEmptyWeeklyPlanningVNextState();
  return { client: { createChatCompletion: vi.fn(async () => {
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error('Unexpected extra model call');
    return response;
  }) }, state, projection: projectWeeklyPlanningVNext(state), presentedQuestion: null, userText: '数学は残り7枚です',
  clock: { currentDate: '2026-10-30', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' } };
}

describe('VNext native provider', () => {
  it('every synthetic observation seed is valid and has a projectable typed state before any API call', () => {
    expect(VNEXT_PROVIDER_SCENARIOS.length).toBe(23);
    expect(new Set(VNEXT_PROVIDER_SCENARIOS.map(scenario => scenario.id)).size).toBe(23);
    for (const scenario of VNEXT_PROVIDER_SCENARIOS) {
      let state = createEmptyWeeklyPlanningVNextState();
      if (scenario.seed.length) {
        const seeded = applyWeeklyPlanningVNextTurn(state, { ...emptyDelta(), add: scenario.seed }, {
          expectedRevision: 0, turnKey: `seed:${scenario.id}`, conversationId: 'synthetic', turnId: 'seed', sourceText: 'Synthetic evidence',
        });
        expect(seeded.status, `${scenario.id}: ${JSON.stringify(seeded)}`).toBe('applied');
        if (seeded.status === 'applied') state = seeded.state;
      }
      expect(() => projectWeeklyPlanningVNext(state), scenario.id).not.toThrow();
    }
  });

  it('deadline oracle preserves tomorrow 13:00 as an end bound under the captured August 26 clock', () => {
    const scenario = VNEXT_PROVIDER_SCENARIOS.find(item => item.id === 'deadline-tomorrow-1300')!;
    expect(scenario.clock?.currentDate).toBe('2026-08-26');
    const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { ...emptyDelta(), add: scenario.seed },
      { expectedRevision: 0, turnKey: 'seed-bound', conversationId: 'synthetic', turnId: 'seed', sourceText: 'seed' });
    if (seed.status !== 'applied') throw new Error('setup');
    const reading = { status: 'interpreted' as const, delta: emptyDelta(), answer: null,
      metrics: { calls: 1, repairs: 0, latencyMs: 0 } };
    for (const misplaced of [false, true]) {
      const candidate = structuredClone(seed.state);
      candidate.graph.temporalConstraints.push({ id: 'bound', taskId: candidate.graph.tasks[0].id,
        targetFactId: candidate.graph.tasks[0].id, kind: 'deadline', constraintLevel: 'hard', dateExpression: 'tomorrow',
        namedTimePeriod: null, startTime: misplaced ? '13:00' : null, endTime: misplaced ? null : '13:00', precision: 'exact',
        source: candidate.graph.tasks[0].source, createdRevision: 1 });
      candidate.graph.factLifecycles.push({ factId: 'bound', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
      const failures = checkVNextProviderScenario(scenario.turns[0].expected, seed.state, candidate, reading);
      if (misplaced) expect(failures).toContainEqual(expect.stringContaining('missing temporal bound'));
      else expect(failures).toEqual([]);
    }
  });
  it('uses an object root, required properties and closed objects in every strict-schema branch', () => {
    type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean;
      anyOf?: Schema[]; items?: Schema };
    const root = VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.schema as Schema;
    expect(root.type).toBe('object');
    expect(root.anyOf).toBeUndefined();
    const inspect = (schema: Schema) => {
      if (schema.type === 'object') {
        expect(schema.additionalProperties).toBe(false);
        expect(schema.required!.sort()).toEqual(Object.keys(schema.properties!).sort());
        Object.values(schema.properties!).forEach(inspect);
      }
      schema.anyOf?.forEach(inspect);
      if (schema.items) inspect(schema.items);
    };
    inspect(root);
  });

  it('decodes every native add kind and all three reference namespaces', () => {
    const decoded = decodeVNextProviderOutput(output([task(), workload(),
      { kind: 'component', localId: 'component', taskRef: { factId: 'saved' }, parentComponentRef: null, role: 'material', label: 'Book' },
      { kind: 'effort_estimate', localId: 'effort', taskRef: { factId: 'saved' }, targetRef: { workLineageId: 'work' },
        effortKind: 'total_duration', minutes: 45, unitCode: null, unitLabel: null, precision: 'exact' },
      { kind: 'temporal_constraint', localId: 'date', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-02', namedTimePeriod: null,
        startTime: null, endTime: null, precision: 'exact' },
    ]));
    expect(decoded.status).toBe('decoded');
  });

  it('calls the provider once, validates a native delta and never mutates accepted state', async () => {
    const params = input([JSON.stringify(output([task(), workload()]))]);
    const before = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result.status).toBe('interpreted');
    expect(result.metrics).toMatchObject({ calls: 1, repairs: 0 });
    expect(params.state).toEqual(before);
    expect(params.client.createChatCompletion).toHaveBeenCalledWith(expect.objectContaining({ responseFormat: VNEXT_PROVIDER_RESPONSE_FORMAT }));
  });

  it('splices the erroneous field by local ID even if the repair reorders facts or changes unrelated content', async () => {
    const first = output([task(), workload('work', '7'), task('independent', 'English')]);
    const repaired = output([task('independent', 'silently changed'), workload('work', 7), task('task', 'silently changed too')]);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([JSON.stringify(first), JSON.stringify(repaired)]));
    expect(result.status).toBe('interpreted');
    expect(result.metrics).toMatchObject({ calls: 2, repairs: 1 });
    if (result.status === 'interpreted') {
      expect(result.delta.add[0]).toMatchObject({ title: 'Math' });
      expect(result.delta.add[1]).toMatchObject({ amount: 7 });
      expect(result.delta.add[2]).toMatchObject({ title: 'English' });
    }
  });

  it('repairs a transaction rejection once using the same field address', async () => {
    const params = input([JSON.stringify(output([task(), workload('work', -1)])), JSON.stringify(output([task(), workload('work', 7)]))]);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result.status).toBe('interpreted');
    expect(result.metrics.repairs).toBe(1);
  });

  it('stops after the single unsuccessful formal repair and retains the original state', async () => {
    const bad = JSON.stringify(output([task(), workload('work', -1)]));
    const params = input([bad, bad, JSON.stringify(output([task(), workload()]))]);
    const before = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result.status).toBe('failed');
    expect(result.metrics).toMatchObject({ calls: 2, repairs: 1 });
    expect(params.state).toEqual(before);
  });

  it('fails closed if the repair drops the addressed local ID', async () => {
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([
      JSON.stringify(output([task(), workload('work', -1)])), JSON.stringify(output([task()])),
    ]));
    expect(result.status).toBe('failed');
  });

  it.each([['not JSON', 'unparseable'], [new Error('network failure'), 'provider_error']] as const)(
    'does not retry %s', async (response, reason) => {
      const result = await createWeeklyPlanningVNextProviderInterpreter()(input([response]));
      expect(result).toMatchObject({ status: 'failed', reason, metrics: { calls: 1, repairs: 0 } });
    });

  it('fails unaddressable whole-clause errors without a semantic reread', async () => {
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([JSON.stringify({ delta: null, answer: null })]));
    expect(result).toMatchObject({ status: 'failed', metrics: { calls: 1, repairs: 0 } });
  });

  it.each([
    [{ kind: 'option', optionId: 'unverified-option', minutes: null }, { kind: 'option', optionId: 'unverified-option' }],
    [{ kind: 'estimate_minutes', optionId: null, minutes: 45 }, { kind: 'estimate_minutes', minutes: 45 }],
  ])('decodes answers without selecting or binding them (%j)', async (wire, answer) => {
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([JSON.stringify(output([], wire))]));
    expect(result).toMatchObject({ status: 'interpreted', answer });
  });

  it('accepts a no-contribution turn without sending an empty delta to the transaction', async () => {
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([JSON.stringify(output())]));
    expect(result.status).toBe('interpreted');
  });

  it('decodes and dry-runs a value-only patch without refilling unit or scope', async () => {
    const params = input([]);
    const seeded = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [
      { kind: 'task', localId: 'task', title: 'Math', category: 'study' },
      { kind: 'workload', localId: 'work', taskRef: { localId: 'task' }, componentRef: null,
        quantityRole: 'remaining', amount: 7, unitCode: 'custom', unitLabel: '枚', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: 'this_week' },
    ] }, { expectedRevision: 0, turnKey: 'seed', conversationId: 'c', turnId: 'seed', sourceText: 'evidence' });
    if (seeded.status !== 'applied') throw new Error('setup');
    params.state = seeded.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    const patch = { kind: 'workload', localId: 'p', targetFactId: params.state.graph.workloads[0].id,
      amountDelta: null, changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } };
    params.client = input([JSON.stringify({ delta: { ...emptyDelta(), patch: [patch] }, answer: null })]).client;
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', delta: { patch: [patch] } });
    expect(params.state.graph.workloads[0].amount).toBe(7);
  });

  it('rejects unknown/inherited-key fields and mixed answer payloads', () => {
    expect(decodeVNextProviderOutput(JSON.parse('{"delta":{"add":[],"patch":[],"remove":[],"relate":[],"defer":[]},"answer":null,"constructor":{}}')).status).toBe('rejected');
    expect(decodeVNextProviderOutput(output([], { kind: 'option', optionId: 'x', minutes: 45 })).status).toBe('rejected');
  });

  it('keeps experimental provider/session requests outside production trace and outbox', () => {
    // Explicit exclusion contract: synthetic experiment receipts are artifacts, never production trace.
    const files = ['./weeklyPlanningVNextProvider.ts', './weeklyPlanningVNextProviderPrompt.ts',
      './weeklyPlanningVNextProviderSchema.ts', '../application/weeklyPlanningVNextExperimentalSession.ts'];
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)].map(match => match[2]);
      expect(imports.filter(path => /(?:\/trace\/|[Oo]utbox|[Tt]raceRuntime|workers\/)/.test(path)), file).toEqual([]);
      expect(source, file).not.toMatch(/\b(?:recordWeeklyPlanningStableV5DebugTrace|appendWeeklyPlanningTrace|enqueueWeeklyPlanningTrace)\s*\(/);
    }
  });

  it('prompt includes clock, active IDs, open/presented questions and omits historical inactive facts', () => {
    const params = input([]);
    const added = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [{ kind: 'task', localId: 't', category: 'study', title: 'Original' }] },
      { expectedRevision: 0, turnKey: 'setup', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    if (added.status !== 'applied') throw new Error('setup');
    const changed = applyWeeklyPlanningVNextTurn(added.state, { ...emptyDelta(), patch: [{ kind: 'task', localId: 'p',
      targetFactId: added.state.graph.tasks[0].id, changes: { title: 'Changed', category: null } }] },
    { expectedRevision: 1, turnKey: 'change', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    if (changed.status !== 'applied') throw new Error('setup');
    params.state = changed.state;
    const message = JSON.parse(buildWeeklyPlanningVNextProviderMessages(params)[1].content);
    expect(message.clock).toEqual(params.clock);
    expect(message.activeFacts.tasks).toHaveLength(1);
    expect(message.activeFacts.tasks[0].title).toBe('Changed');
  });
});
