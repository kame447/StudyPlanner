import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { WeeklyPlanningVNextInterpretationInput } from '../weeklyPlanningVNextInterpretationContract';
import type { VNextAddFact } from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { createEmptyWeeklyPlanningVNextState, applyWeeklyPlanningVNextTurn } from './weeklyPlanningVNextTransaction';
import { createWeeklyPlanningVNextProviderInterpreter } from './weeklyPlanningVNextProvider';
import { decodeVNextProviderOutput, describeVNextProviderField, VNEXT_PROVIDER_RESPONSE_FORMAT,
  VNEXT_CONSTRAINT_LEVEL_REQUIREMENT, VNEXT_ESTIMATE_ANSWER_REQUIREMENT, VNEXT_NAMED_TIME_PERIOD_REQUIREMENT, VNEXT_QUANTITY_ROLE_REQUIREMENT, VNEXT_RELATE_REFERENCE_REQUIREMENT,
  VNEXT_TEMPORAL_TARGET_REQUIREMENT, VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT } from './weeklyPlanningVNextProviderSchema';
import { buildWeeklyPlanningVNextProviderMessages } from './weeklyPlanningVNextProviderPrompt';
import { checkVNextProviderScenario, VNEXT_PROVIDER_SCENARIOS } from './weeklyPlanningVNextProviderScenarios';
import { resolveWeeklyPlanningVNextTurnDelta } from '../application/weeklyPlanningVNextAnswerBinding';
import { SEMANTIC_RECURRENCE_KINDS_V5, SEMANTIC_TASK_DATE_RULE_KINDS_V5, SEMANTIC_AVAILABILITY_KINDS_V5,
  SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5 } from '../../semantic/weeklyPlanningSemanticSchemaV5';
import { VNEXT_RECURRENCE_REQUIREMENT, VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT,
  VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT } from './weeklyPlanningVNextProviderSchema';

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

function changedUnitInput(): WeeklyPlanningVNextInterpretationInput {
  const params = input([]);
  const seed = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add:
    VNEXT_PROVIDER_SCENARIOS.find(scenario => scenario.id === 'custom-unit-change')!.seed }, {
    expectedRevision: 0, acceptedDate: params.clock.currentDate, turnKey: 'unit-seed',
    conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic',
  });
  if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
  const changed = applyWeeklyPlanningVNextTurn(seed.state, { ...emptyDelta(), patch: [{ kind: 'workload',
    localId: 'unit', targetFactId: seed.state.graph.workloads[0].id, amountDelta: null,
    changes: { amount: 2, unitCode: null, unitLabel: 'セット', quantityRole: null, rangeStart: null, rangeEnd: null,
      perOccurrence: null, periodExpression: null } }] }, {
    expectedRevision: seed.state.graph.revision, acceptedDate: params.clock.currentDate, turnKey: 'unit-change',
    conversationId: 'synthetic', turnId: 'change', sourceText: '残り2セット',
  });
  if (changed.status !== 'applied') throw new Error(JSON.stringify(changed));
  params.state = changed.state;
  params.projection = projectWeeklyPlanningVNext(changed.state);
  params.presentedQuestion = params.projection.questions[0];
  params.userText = '1セットあたり20分です。';
  expect(params.presentedQuestion).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 2, unitLabel: 'セット' } });
  return params;
}

describe('VNext native provider', () => {
  it('reuses the five ported V5 vocabularies in its strict schema and shared prompt', () => {
    type Schema = { properties?: Record<string, Schema>; enum?: readonly string[]; items?: Schema; anyOf?: Schema[] };
    const root = VNEXT_PROVIDER_RESPONSE_FORMAT.json_schema.schema as Schema;
    const variants = root.properties!.delta.properties!.add.items!.anyOf!;
    const variant = (kind: string) => variants.find(schema => schema.properties!.kind.enum![0] === kind)!;
    const v5 = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as Schema;
    expect(variant('planning_window').properties!.windowKind.enum).toBe(v5.properties!.planningWindow.anyOf![0].properties!.kind.enum);
    expect(variant('relation').properties!.relationKind.enum).toBe(v5.properties!.relations.items!.properties!.kind.enum);
    expect(variant('recurrence').properties!.recurrenceKind.enum).toBe(SEMANTIC_RECURRENCE_KINDS_V5);
    expect(variant('task_date_rule').properties!.ruleKind.enum).toBe(SEMANTIC_TASK_DATE_RULE_KINDS_V5);
    expect(variant('availability_declaration').properties!.availabilityKind.enum).toBe(SEMANTIC_AVAILABILITY_KINDS_V5);
    expect(variant('availability_declaration').properties!.recurrenceKind.anyOf![0].enum).toBe(SEMANTIC_AVAILABILITY_RECURRENCE_KINDS_V5);
    const prompt = buildWeeklyPlanningVNextProviderMessages(input([]))[0].content;
    for (const requirement of [VNEXT_PLANNING_WINDOW_REQUIREMENT, VNEXT_RECURRENCE_REQUIREMENT, VNEXT_TASK_DATE_RULE_REQUIREMENT,
      VNEXT_AVAILABILITY_REQUIREMENT, VNEXT_TASK_RELATION_REQUIREMENT]) expect(prompt).toContain(requirement);
  });

  it('decodes and dry-runs all five ported fact shapes without a V5 state update', async () => {
    const wire = output([task(), task('other', 'Other'), { ...workload('daily', 20), quantityRole: 'target', unitCode: 'minute', unitLabel: '分', perOccurrence: true },
      { kind: 'planning_window', localId: 'window', windowKind: 'relative_week', value: 'next_week', start: null, end: null },
      { kind: 'recurrence', localId: 'repeat', taskRef: { localId: 'task' }, targetRef: { localId: 'task' }, recurrenceKind: 'daily', count: null, days: [] },
      { kind: 'task_date_rule', localId: 'exclude', taskRef: { localId: 'task' }, targetRef: { localId: 'task' }, ruleKind: 'excluded_date', dateExpression: 'weekday:friday', constraintLevel: 'hard' },
      { kind: 'availability_declaration', localId: 'busy', availabilityKind: 'unavailable', dateExpression: 'tomorrow', namedTimePeriod: null,
        startTime: '09:00', endTime: '10:00', recurrenceKind: null, days: [], capacityMinutes: null, constraintLevel: 'hard' },
      { kind: 'relation', localId: 'order', relationKind: 'before', fromTaskRef: { localId: 'task' }, toTaskRef: { localId: 'other' } },
    ]);
    const params = input([JSON.stringify(wire)]);
    const before = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 1, repairs: 0 } });
    expect(params.state).toEqual(before);
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    const applied = applyWeeklyPlanningVNextTurn(params.state, result.delta, { expectedRevision: 0, acceptedDate: params.clock.currentDate,
      turnKey: 'ported', conversationId: 'synthetic', turnId: 'turn', sourceText: 'synthetic typed port' });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    expect(applied.state.graph.planningWindows[0]).toMatchObject({ kind: 'absolute', start: '2026-11-02', end: '2026-11-08' });
    expect(applied.state.graph.recurrences[0]).toMatchObject({ kind: 'daily', targetFactId: applied.state.graph.tasks[0].id });
    expect(applied.state.graph.taskDateRules[0]).toMatchObject({ kind: 'excluded_date', dateExpression: 'weekday:friday' });
    expect(applied.state.graph.availabilityDeclarations[0]).toMatchObject({ kind: 'unavailable', dateExpression: '2026-10-31', resolutionStatus: 'unresolved' });
    expect(applied.state.graph.relations[0]).toMatchObject({ kind: 'before', fromTaskId: applied.state.graph.tasks[0].id, toTaskId: applied.state.graph.tasks[1].id });
  });

  it('repairs a ported recurrence field once using the same vocabulary, retaining its per-occurrence workload', async () => {
    const repeat = { kind: 'recurrence', localId: 'repeat', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      recurrenceKind: 'times_per_week', count: 0, days: [] };
    const work = { ...workload('work', 20), quantityRole: 'target', unitCode: 'minute', unitLabel: '分', perOccurrence: true };
    const params = input([JSON.stringify(output([task(), work, repeat])),
      JSON.stringify(output([task(), { ...work, amount: 999 }, { ...repeat, count: 2 }]))]);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    const messages = vi.mocked(params.client.createChatCompletion).mock.calls[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.errors).toContainEqual(expect.objectContaining({ path: 'add[2].count', localId: 'repeat', requirement: VNEXT_RECURRENCE_REQUIREMENT }));
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    expect(result.delta.add[1]).toMatchObject({ amount: 20, perOccurrence: true });
    expect(result.delta.add[2]).toMatchObject({ recurrenceKind: 'times_per_week', count: 2 });
  });

  it('every synthetic observation seed is valid and has a projectable typed state before any API call', () => {
    expect(VNEXT_PROVIDER_SCENARIOS.length).toBe(24);
    expect(new Set(VNEXT_PROVIDER_SCENARIOS.map(scenario => scenario.id)).size).toBe(24);
    for (const scenario of VNEXT_PROVIDER_SCENARIOS) {
      let state = createEmptyWeeklyPlanningVNextState();
      if (scenario.seed.length) {
        const seeded = applyWeeklyPlanningVNextTurn(state, { ...emptyDelta(), add: scenario.seed }, {
          expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: `seed:${scenario.id}`, conversationId: 'synthetic', turnId: 'seed', sourceText: 'Synthetic evidence',
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
      { expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: 'seed-bound', conversationId: 'synthetic', turnId: 'seed', sourceText: 'seed' });
    if (seed.status !== 'applied') throw new Error('setup');
    const reading = { status: 'interpreted' as const, delta: emptyDelta(), answer: null,
      metrics: { calls: 1, repairs: 0, latencyMs: 0 } };
    for (const [misplaced, level] of [[false, 'hard'], [true, 'hard'], [false, 'unknown']] as const) {
      const candidate = structuredClone(seed.state);
      candidate.graph.temporalConstraints.push({ id: 'bound', taskId: candidate.graph.tasks[0].id,
        // Stored form: dates are fixed to the accepting turn (2026-08-26 + 1) by the transaction.
        targetFactId: candidate.graph.tasks[0].id, kind: 'deadline', constraintLevel: level, dateExpression: '2026-08-27',
        namedTimePeriod: null, startTime: misplaced ? '13:00' : null, endTime: misplaced ? null : '13:00', precision: 'exact',
        source: candidate.graph.tasks[0].source, createdRevision: 1 });
      candidate.graph.factLifecycles.push({ factId: 'bound', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null });
      const failures = checkVNextProviderScenario(scenario.turns[0].expected, seed.state, candidate, reading);
      if (misplaced || level === 'unknown') expect(failures).toContainEqual(expect.stringContaining('missing temporal bound'));
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

  it('publishes the same workload role/label requirements in schema and prompt, separately from estimate units', () => {
    const wire = output([task(), workload()]);
    expect(describeVNextProviderField('add[1].quantityRole', wire)).toBe(VNEXT_QUANTITY_ROLE_REQUIREMENT);
    expect(describeVNextProviderField('delta.add[1].unitLabel', wire)).toBe(VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT);
    const messages = buildWeeklyPlanningVNextProviderMessages(input([]));
    expect(messages[0].content).toContain(VNEXT_QUANTITY_ROLE_REQUIREMENT);
    expect(messages[0].content).toContain(VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT);
    expect(describeVNextProviderField('add[0].unitLabel', output([{ kind: 'effort_estimate', localId: 'e',
      taskRef: { localId: 'task' }, targetRef: { localId: 'task' }, effortKind: 'total_duration', minutes: 45,
      unitCode: null, unitLabel: null, precision: 'exact' }]))).toBeNull();
    expect(describeVNextProviderField('unrecognized.path', wire)).toBeNull();
  });

  it('distinguishes an intended remainder from a target without weakening the native-add-rate oracle', async () => {
    const scenario = VNEXT_PROVIDER_SCENARIOS.find(scenario => scenario.id === 'native-add-rate')!;
    // Controlled readings test the typed contract/oracle, not the model's language interpretation.
    for (const role of ['remaining', 'target'] as const) {
      const wire = output([task(), { ...workload(), quantityRole: role }, { kind: 'effort_estimate', localId: 'rate',
        taskRef: { localId: 'task' }, targetRef: { localId: 'work' }, effortKind: 'duration_per_unit', minutes: 5,
        unitCode: 'custom', unitLabel: '枚', precision: 'exact' }]);
      const params = input([JSON.stringify(wire)]);
      params.userText = scenario.turns[0].text;
      const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
      if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
      const prompt = vi.mocked(params.client.createChatCompletion).mock.calls[0][0].messages[0].content;
      const requirement = describeVNextProviderField('add[1].quantityRole', wire)!;
      expect(prompt).toContain(requirement);
      expect(requirement).toContain('remaining = an amount stated as what is left of a bounded whole, even when the user also intends to do it in this planning period');
      expect(requirement).toContain('target = an amount intended for this planning period that is not stated as a remainder');
      const applied = applyWeeklyPlanningVNextTurn(params.state, result.delta, { expectedRevision: 0,
        acceptedDate: params.clock.currentDate, turnKey: role, conversationId: 'synthetic', turnId: 'turn', sourceText: params.userText });
      if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
      const failures = checkVNextProviderScenario(scenario.turns[0].expected, params.state, applied.state, result);
      if (role === 'remaining') expect(failures).toEqual([]);
      else expect(failures).not.toEqual([]);
    }
  });

  it('binds a time answer for presented percentage work without creating another workload, and keeps unasked time-only work', async () => {
    const params = input([JSON.stringify(output([], { kind: 'estimate_minutes', optionId: null, minutes: 90, per: 'whole_work' }))]);
    const seed = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [
      { kind: 'task', localId: 't', category: 'study', title: 'Slides' },
      { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null,
        quantityRole: 'remaining', amount: 50, unitCode: 'custom', unitLabel: '%', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null },
    ] }, { expectedRevision: 0, acceptedDate: params.clock.currentDate, turnKey: 'percentage',
      conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic' });
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    params.state = seed.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    params.presentedQuestion = params.projection.questions[0];
    expect(params.presentedQuestion).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 50, unitLabel: '%' } });
    params.userText = '残りは1時間半くらいです';
    const interpreted = await createWeeklyPlanningVNextProviderInterpreter()(params);
    if (interpreted.status !== 'interpreted') throw new Error(JSON.stringify(interpreted));
    const prompt = vi.mocked(params.client.createChatCompletion).mock.calls[0][0].messages[0].content;
    expect(prompt).toContain('When a presented question asks for a value and the utterance supplies exactly that value for the asked work, use answer rather than creating a new workload');
    expect(prompt).toContain('When no presented question asks for that value and the only quantity stated for a work is time');
    expect(describeVNextProviderField('answer.per', output([], { kind: 'estimate_minutes', minutes: 90, optionId: null, per: 'whole_work' })))
      .toBe(VNEXT_ESTIMATE_ANSWER_REQUIREMENT);
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
      presented: { questionKey: params.presentedQuestion.key, graphRevision: params.projection.graphRevision },
      projection: params.projection, graph: params.state.graph, interpreted });
    if (resolved.status !== 'delta') throw new Error(JSON.stringify(resolved));
    const applied = applyWeeklyPlanningVNextTurn(params.state, resolved.delta, { expectedRevision: params.state.graph.revision,
      acceptedDate: params.clock.currentDate, turnKey: 'answer', conversationId: 'synthetic', turnId: 'answer', sourceText: params.userText });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    expect(applied.state.graph.workloads).toEqual(params.state.graph.workloads);
    const projection = projectWeeklyPlanningVNext(applied.state);
    expect(projection.questions).toEqual([]);
    expect(projection.owners[0].work).toEqual([expect.objectContaining({ amount: 50, minutes: 90 })]);

    const unasked = input([JSON.stringify(output([task(), { ...workload('work', 45), quantityRole: 'target', unitCode: 'minute', unitLabel: '分' }]))]);
    unasked.userText = '英語の音読を45分やりたいです';
    expect(unasked.presentedQuestion).toBeNull();
    const timeWork = await createWeeklyPlanningVNextProviderInterpreter()(unasked);
    if (timeWork.status !== 'interpreted') throw new Error(JSON.stringify(timeWork));
    const created = applyWeeklyPlanningVNextTurn(unasked.state, timeWork.delta, { expectedRevision: 0,
      acceptedDate: unasked.clock.currentDate, turnKey: 'unasked', conversationId: 'synthetic', turnId: 'unasked', sourceText: unasked.userText });
    if (created.status !== 'applied') throw new Error(JSON.stringify(created));
    expect(timeWork.answer).toBeNull();
    expect(created.state.graph.workloads).toEqual([expect.objectContaining({ quantityRole: 'target', amount: 45, unitCode: 'minute' })]);
    expect(projectWeeklyPlanningVNext(created.state).owners[0].work[0].minutes).toBe(45);
  });

  it.each([null, ''])('repairs invalid workload unitLabel %j with its schema requirement and retains target/time', async unitLabel => {
    const first = { ...workload('work', 45), quantityRole: 'target', unitCode: 'minute', unitLabel };
    const repaired = { ...first, amount: 999, quantityRole: 'declared', unitLabel: '分' };
    const params = input([JSON.stringify(output([task(), first])), JSON.stringify(output([task(), repaired]))]);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    const calls = vi.mocked(params.client.createChatCompletion).mock.calls;
    const repairMessage = JSON.parse(calls[1][0].messages[calls[1][0].messages.length - 1].content);
    expect(repairMessage.errors).toContainEqual(expect.objectContaining({ localId: 'work', requirement: VNEXT_WORKLOAD_UNIT_LABEL_REQUIREMENT }));
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    expect(result.delta.add[1]).toMatchObject({ amount: 45, quantityRole: 'target', unitCode: 'minute', unitLabel: '分' });
    const applied = applyWeeklyPlanningVNextTurn(params.state, result.delta, {
      expectedRevision: 0, acceptedDate: params.clock.currentDate, turnKey: 'valid-time-work', conversationId: 'synthetic', turnId: 'turn', sourceText: params.userText,
    });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    const projection = projectWeeklyPlanningVNext(applied.state);
    expect(projection.questions).toEqual([]);
    expect(projection.owners.flatMap(owner => owner.work).map(work => work.minutes)).toEqual([45]);
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

  it('takes one complete new reading for non-field errors and validates the new delta', async () => {
    const result = await createWeeklyPlanningVNextProviderInterpreter()(input([
      JSON.stringify({ delta: null, answer: null }), JSON.stringify(output([task(), workload()])),
    ]));
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
  });

  it.each([true, false])('replays the correction + invalid relation: empty reread=%s', async emptyReread => {
    // Run 41021877992 rep 1: the relation used W aliases in localId; the reread lost the entire correction.
    const params = input([]);
    const seeded = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [
      { kind: 'task', localId: 'slides', category: 'study', title: 'Slides' },
      { ...workload('slide-work'), kind: 'workload', quantityRole: 'remaining', amount: 10, taskRef: { localId: 'slides' }, unitCode: 'page' },
      { kind: 'task', localId: 'files', category: 'study', title: 'Files' },
      { ...workload('file-work'), kind: 'workload', quantityRole: 'remaining', amount: 30, taskRef: { localId: 'files' }, unitCode: 'minute', unitLabel: '分' },
    ] }, { expectedRevision: 0, acceptedDate: params.clock.currentDate, turnKey: 'separate-seed',
      conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic' });
    if (seeded.status !== 'applied') throw new Error(JSON.stringify(seeded));
    params.state = seeded.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    params.presentedQuestion = params.projection.questions[0];
    params.userText = 'それは別の仕事です。スライドは残り8枚に訂正し、1枚6分です。';
    const before = structuredClone(params.state);
    params.client = { createChatCompletion: vi.fn(async request => {
      if (request.messages.length > 2 && emptyReread) return JSON.stringify(output());
      const context = JSON.parse(request.messages[1].content);
      const [slides, files] = context.activeFacts.workloads;
      const repaired = request.messages.length > 2;
      return JSON.stringify({ delta: { ...emptyDelta(), patch: [{ kind: 'workload', localId: 'p1',
        targetFactId: slides.id, amountDelta: null, changes: { amount: 8, unitCode: null, unitLabel: null,
          quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }],
        relate: [{ kind: 'distinct',
          a: repaired ? { factId: slides.id } : { localId: context.presentedQuestion.forWork.workLineageId },
          b: repaired ? { factId: files.id } : { localId: context.projectedOwners[1].work[0].workLineageId } }] },
      answer: { kind: 'estimate_minutes', optionId: null, minutes: 6, per: 'unit' } });
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result.metrics).toMatchObject({ calls: 2, repairs: 1 });
    expect(params.state).toEqual(before);
    const messages = vi.mocked(params.client.createChatCompletion).mock.calls[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.instruction).toContain('Keep every clause of the first reading and fix only the reported problems');
    expect(repair.errors).toEqual(expect.arrayContaining(['a', 'b'].map(side => expect.objectContaining({
      path: `relate[0].${side}`, requirement: VNEXT_RELATE_REFERENCE_REQUIREMENT,
    }))));
    expect(messages[0].content).toContain(VNEXT_RELATE_REFERENCE_REQUIREMENT);
    if (emptyReread) {
      expect(result).toMatchObject({ status: 'failed', reason: 'rejected_after_repair',
        errors: expect.arrayContaining([expect.objectContaining({ path: 'relate[0]' })]) });
    } else {
      if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
      const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
        presented: { questionKey: params.presentedQuestion.key, graphRevision: params.projection.graphRevision },
        projection: params.projection, graph: params.state.graph, interpreted: result });
      if (resolved.status !== 'delta') throw new Error(JSON.stringify(resolved));
      const applied = applyWeeklyPlanningVNextTurn(params.state, resolved.delta, { expectedRevision: params.state.graph.revision,
        acceptedDate: params.clock.currentDate, turnKey: 'corrected', conversationId: 'synthetic', turnId: 'turn', sourceText: params.userText });
      if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
      const projection = projectWeeklyPlanningVNext(applied.state);
      for (const [title, amount, minutes] of [['Slides', 8, 48], ['Files', 30, 30]] as const) {
        const taskId = applied.state.graph.tasks.find(task => task.title === title)!.id;
        expect(projection.owners.find(owner => owner.taskId === taskId)!.work).toEqual([
          expect.objectContaining({ amount, minutes }),
        ]);
      }
      expect(applied.state.workRelations).toEqual([expect.objectContaining({ kind: 'distinct' })]);
    }
  });

  it('rejects losing an answer-only first reading in a whole reread', async () => {
    const params = input([JSON.stringify(output([], { kind: 'estimate_minutes', optionId: null, minutes: 6, per: null })),
      JSON.stringify(output())]);
    expect(await createWeeklyPlanningVNextProviderInterpreter()(params)).toMatchObject({ status: 'failed',
      reason: 'rejected_after_repair', metrics: { calls: 2, repairs: 1 } });
  });

  it('allows an empty reread when the first malformed document had no contributions', async () => {
    expect(await createWeeklyPlanningVNextProviderInterpreter()(input([JSON.stringify({ delta: null, answer: null }),
      JSON.stringify(output())]))).toMatchObject({ status: 'interpreted', delta: emptyDelta(), answer: null,
      metrics: { calls: 2, repairs: 1 } });
  });

  it('rereads an element-level temporal error once rather than dropping its entire clause through a splice', async () => {
    const first = output([task(), { kind: 'temporal_constraint', localId: 'bad-interval', taskRef: { localId: 'task' },
      targetRef: { localId: 'task' }, constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: 'this_week',
      namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' }]);
    const params = input([JSON.stringify(first), JSON.stringify(output([task(), workload()]))]);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    if (result.status === 'interpreted') expect(result.delta.add[1]).toMatchObject({ kind: 'workload', amount: 7 });
    const calls = vi.mocked(params.client.createChatCompletion).mock.calls;
    expect(JSON.parse(calls[1][0].messages[calls[1][0].messages.length - 1].content).instruction).toContain('Keep every clause of the first reading and fix only the reported problems');
  });

  it('a second non-field failure cannot trigger a second reread or commit state', async () => {
    const bad = JSON.stringify({ delta: null, answer: null });
    const params = input([bad, bad, JSON.stringify(output())]);
    const original = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'failed', reason: 'rejected_after_repair', metrics: { calls: 2, repairs: 1 } });
    expect(params.state).toEqual(original);
  });

  it.each(['add', 'patch'] as const)('rereads an estimate answer duplicated by %s once, preserving independent facts', async collection => {
    const params = changedUnitInput();
    const before = structuredClone(params.state);
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      const answer = { kind: 'estimate_minutes', optionId: null, minutes: 20, per: 'unit' };
      const delta = { ...emptyDelta(), add: [task('other', 'English')] };
      if (request.messages.length > 2) return JSON.stringify({ delta, answer });
      const duplicate = collection === 'add'
        ? { kind: 'effort_estimate', localId: 'again', taskRef: { factId: context.activeFacts.tasks[0].id },
            targetRef: { factId: context.activeFacts.workloads[0].id }, effortKind: 'duration_per_unit',
            minutes: 20, unitCode: 'custom', unitLabel: 'セット', precision: 'exact' }
        : { kind: 'effort_estimate', localId: 'again', targetFactId: context.activeFacts.effortEstimates[0].id,
            changes: { minutes: 20, effortKind: null, unitCode: null, unitLabel: 'セット', precision: null } };
      return JSON.stringify({ delta: { ...delta, [collection]: [...delta[collection], duplicate] }, answer });
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    const calls = vi.mocked(params.client.createChatCompletion).mock.calls;
    const messages = calls[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.errors).toEqual([{ path: `${collection}[${collection === 'add' ? 1 : 0}]`, localId: 'again' }]);
    expect(repair.instruction).toContain('Keep every clause of the first reading and fix only the reported problems');
    expect(repair.instruction).toContain("State the asked work's estimate once: as the answer, or as a fact, not both.");
    expect(params.state).toEqual(before);
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    expect(result.delta.add).toEqual([task('other', 'English')]);
    expect(result.delta.patch).toEqual([]);
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
      presented: { questionKey: params.presentedQuestion!.key, graphRevision: params.projection.graphRevision },
      projection: params.projection, graph: params.state.graph, interpreted: result });
    if (resolved.status !== 'delta') throw new Error(JSON.stringify(resolved));
    const applied = applyWeeklyPlanningVNextTurn(params.state, resolved.delta, { expectedRevision: params.state.graph.revision,
      acceptedDate: params.clock.currentDate, turnKey: 'repaired', conversationId: 'synthetic', turnId: 'turn', sourceText: params.userText });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    expect(projectWeeklyPlanningVNext(applied.state).owners.flatMap(owner => owner.work)).toContainEqual(
      expect.objectContaining({ amount: 2, minutes: 40, estimateBasis: 'rate' }));
  });

  it.each(['patch', 'remove'] as const)('rereads an option answer restated by %s once, preserving independent facts', async collection => {
    const params = input([]);
    const facts: VNextAddFact[] = collection === 'patch'
      ? VNEXT_PROVIDER_SCENARIOS.find(scenario => scenario.id === 'option-answer')!.seed
      : [{ kind: 'task', localId: 'task', category: 'study', title: 'Synthetic slides' },
        { kind: 'workload', localId: 'pages', taskRef: { localId: 'task' }, componentRef: null,
          quantityRole: 'remaining', amount: 10, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null },
        { kind: 'workload', localId: 'time', taskRef: { localId: 'task' }, componentRef: null,
          quantityRole: 'remaining', amount: 45, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null }];
    const seed = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: facts }, { expectedRevision: 0,
      acceptedDate: params.clock.currentDate, turnKey: 'option-seed', conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic' });
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    params.state = seed.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    params.presentedQuestion = params.projection.questions[0];
    const question = params.presentedQuestion;
    const optionIndex = question.options.findIndex(option => collection === 'patch'
      ? option.optionId === 'completed_follows_remaining' : option.optionId.startsWith('keep:') && option.value === 10);
    expect(optionIndex).toBeGreaterThanOrEqual(0);
    const before = structuredClone(params.state);
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      const answer = { kind: 'option', optionId: context.presentedQuestion.options[optionIndex].optionId, minutes: null, per: null };
      const delta = { ...emptyDelta(), add: [task('other', 'English')] };
      if (request.messages.length > 2) return JSON.stringify({ delta, answer });
      const restated = collection === 'patch'
        ? { kind: 'workload', localId: 'again', targetFactId: context.activeFacts.workloads.find((fact: { quantityRole: string }) => fact.quantityRole === 'completed').id,
            amountDelta: null, changes: { amount: 13, unitCode: null, unitLabel: null, quantityRole: null,
              rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }
        : { targetFactId: context.activeFacts.workloads.find((fact: { unitCode: string }) => fact.unitCode === 'minute').id };
      return JSON.stringify({ delta: { ...delta, [collection]: [restated] }, answer });
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    expect(params.state).toEqual(before);
    const messages = vi.mocked(params.client.createChatCompletion).mock.calls[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.errors).toEqual([{ path: `${collection}[0]`, localId: collection === 'patch' ? 'again' : null }]);
    expect(repair.instruction).toContain('Keep every clause of the first reading and fix only the reported problems');
    expect(repair.instruction).toContain("An option answer already carries that option's change; do not restate it in delta.");
    expect(messages[0].content).toContain(VNEXT_ESTIMATE_ANSWER_REQUIREMENT);
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    expect(result.delta[collection]).toEqual([]);
    expect(result.delta.add).toEqual([task('other', 'English')]);
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
      presented: { questionKey: question.key, graphRevision: params.projection.graphRevision },
      projection: params.projection, graph: params.state.graph, interpreted: result });
    if (resolved.status !== 'delta') throw new Error(JSON.stringify(resolved));
    expect(resolved.delta[collection]).toHaveLength(1);
    const applied = applyWeeklyPlanningVNextTurn(params.state, resolved.delta, { expectedRevision: params.state.graph.revision,
      acceptedDate: params.clock.currentDate, turnKey: 'option-turn', conversationId: 'synthetic', turnId: 'turn', sourceText: 'synthetic option answer' });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    const active = new Set(applied.state.graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
    const activeWork = applied.state.graph.workloads.filter(work => active.has(work.id));
    if (collection === 'patch') {
      expect(activeWork.find(work => work.quantityRole === 'completed')?.amount).toBe(13);
      expect(activeWork).toHaveLength(3);
    } else expect(activeWork).toEqual([expect.objectContaining({ amount: 10, unitCode: 'page' })]);
    expect(applied.state.graph.tasks.filter(task => task.title === 'English')).toHaveLength(1);
  });

  it('fails after one reread when the answer still duplicates the same work estimate', async () => {
    const params = changedUnitInput();
    const before = structuredClone(params.state);
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      return JSON.stringify(output([{ kind: 'effort_estimate', localId: 'again',
        taskRef: { factId: context.activeFacts.tasks[0].id }, targetRef: { workLineageId: context.presentedQuestion.forWork.workLineageId },
        effortKind: 'total_duration', minutes: 40, unitCode: null, unitLabel: null, precision: 'exact' }],
      { kind: 'estimate_minutes', optionId: null, minutes: 20, per: 'unit' }));
    }) };
    expect(await createWeeklyPlanningVNextProviderInterpreter()(params)).toMatchObject({ status: 'failed',
      reason: 'rejected_after_repair', errors: [{ path: 'add[0]', localId: 'again' }], metrics: { calls: 2, repairs: 1 } });
    expect(params.state).toEqual(before);
  });

  it('accepts an estimate answer alongside time for a different task without a repair', async () => {
    const params = changedUnitInput();
    params.userText += '別の英語は全体で30分です。';
    params.client = { createChatCompletion: vi.fn(async () => JSON.stringify(output([task('other', 'English'),
      { kind: 'effort_estimate', localId: 'other-time', taskRef: { localId: 'other' }, targetRef: { localId: 'other' },
        effortKind: 'total_duration', minutes: 30, unitCode: null, unitLabel: null, precision: 'exact' }],
    { kind: 'estimate_minutes', optionId: null, minutes: 20, per: 'unit' }))) };
    expect(await createWeeklyPlanningVNextProviderInterpreter()(params)).toMatchObject({ status: 'interpreted',
      delta: { add: [expect.objectContaining({ kind: 'task' }), expect.objectContaining({ kind: 'effort_estimate', minutes: 30 })] },
      metrics: { calls: 1, repairs: 0 } });
  });

  it.each(['882-iter4-explicit-r8', 'custom-unit-change'])('judges %s through the session binder and question-work oracle', async id => {
    const scenario = VNEXT_PROVIDER_SCENARIOS.find(candidate => candidate.id === id)!;
    const params = input([]);
    const seeded = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: scenario.seed }, {
      expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: id, conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic',
    });
    if (seeded.status !== 'applied') throw new Error('setup');
    params.state = seeded.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    params.presentedQuestion = params.projection.questions[0] ?? null;
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      return id === '882-iter4-explicit-r8'
        ? JSON.stringify(output([], { kind: 'option', optionId: context.presentedQuestion.options[0].optionId, minutes: null, per: null }))
        : JSON.stringify({ delta: { ...emptyDelta(), patch: [{ kind: 'workload', localId: 'change-unit',
          targetFactId: context.activeFacts.workloads[0].id, amountDelta: null, changes: { amount: null, unitCode: null,
            unitLabel: 'セット', quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } }] }, answer: null });
    }) };
    const interpreted = await createWeeklyPlanningVNextProviderInterpreter()(params);
    if (interpreted.status !== 'interpreted') throw new Error(JSON.stringify(interpreted));
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
      presented: params.presentedQuestion ? { questionKey: params.presentedQuestion.key, graphRevision: params.projection.graphRevision } : null,
      projection: params.projection, graph: params.state.graph, interpreted });
    if (resolved.status !== 'delta') throw new Error('answer not bound');
    const applied = applyWeeklyPlanningVNextTurn(params.state, resolved.delta, {
      expectedRevision: params.state.graph.revision, acceptedDate: params.clock.currentDate, turnKey: `${id}:turn`, conversationId: 'synthetic', turnId: 'turn', sourceText: scenario.turns[0].text,
    });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    expect(checkVNextProviderScenario(scenario.turns[0].expected, params.state, applied.state, interpreted)).toEqual([]);
  });

  it.each([
    [{ kind: 'option', optionId: 'O1', minutes: null, per: null }, { kind: 'option', optionId: 'unverified-option' }],
    [{ kind: 'estimate_minutes', optionId: null, minutes: 45, per: 'whole_work' }, { kind: 'estimate_minutes', minutes: 45, per: 'whole_work' }],
    [{ kind: 'estimate_minutes', optionId: null, minutes: 8, per: 'unit' }, { kind: 'estimate_minutes', minutes: 8, per: 'unit' }],
  ])('decodes answers without selecting or binding them (%j)', async (wire, answer) => {
    const params = input([JSON.stringify(output([], wire))]);
    params.presentedQuestion = { code: 'remaining_inconsistent', key: 'raw-question["id"]', ownerKey: 'owner',
      taskId: 'stored-task', componentId: null, subjectLineageIds: [], forWork: null,
      options: [{ optionId: 'unverified-option', value: 8, delta: emptyDelta() }] };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', answer });
  });

  it.each([undefined, null, 'invented'])('does not guess whole-work or unit meaning for per=%s', per => {
    expect(decodeVNextProviderOutput(output([], { kind: 'estimate_minutes', optionId: null, minutes: 8, per })).status).toBe('rejected');
  });

  it.each(['whole_work', 'unit'] as const)('keeps per=%s through native decode, shared binding and projection without computing model output', async per => {
    const params = input([JSON.stringify(output([], { kind: 'estimate_minutes', optionId: null, minutes: 8, per }))]);
    const seedFacts = VNEXT_PROVIDER_SCENARIOS.find(scenario => scenario.id === 'estimate-answer')!.seed;
    const seed = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: seedFacts }, { expectedRevision: 0,
      turnKey: 'answer-seed', conversationId: 'synthetic', turnId: 'seed', sourceText: 'synthetic', acceptedDate: params.clock.currentDate });
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    params.state = seed.state;
    params.projection = projectWeeklyPlanningVNext(seed.state);
    params.presentedQuestion = params.projection.questions[0];
    const interpreted = await createWeeklyPlanningVNextProviderInterpreter()(params);
    if (interpreted.status !== 'interpreted') throw new Error(JSON.stringify(interpreted));
    const resolved = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true, projection: params.projection,
      presented: { questionKey: params.presentedQuestion.key, graphRevision: params.projection.graphRevision },
      graph: seed.state.graph, interpreted });
    if (resolved.status !== 'delta') throw new Error('answer did not bind');
    const applied = applyWeeklyPlanningVNextTurn(seed.state, resolved.delta, { expectedRevision: seed.state.graph.revision,
      turnKey: 'answer-turn', conversationId: 'synthetic', turnId: 'turn', sourceText: params.userText, acceptedDate: params.clock.currentDate });
    if (applied.status !== 'applied') throw new Error(JSON.stringify(applied));
    expect(interpreted.answer).toEqual({ kind: 'estimate_minutes', minutes: 8, per });
    expect(projectWeeklyPlanningVNext(applied.state).owners[0].work[0].minutes).toBe(per === 'unit' ? 64 : 8);
  });

  it('uses schema-owned temporal level and target requirements in the prompt and the one field repair', async () => {
    const params = input([]);
    const seed = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [
      { kind: 'task', localId: 't', category: 'study', title: 'Reading' },
      { kind: 'workload', localId: 'work', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 8,
        unitCode: 'custom', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null },
    ] }, { expectedRevision: 0, turnKey: 'temporal-seed', conversationId: 'synthetic', turnId: 'seed',
      sourceText: 'synthetic', acceptedDate: params.clock.currentDate });
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    params.state = seed.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    let calls = 0;
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      const bound = { kind: 'temporal_constraint', localId: 'deadline', taskRef: { factId: context.activeFacts.tasks[0].id },
        targetRef: { factId: ++calls === 1 ? context.activeFacts.workloads[0].id : context.activeFacts.tasks[0].id },
        constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
        startTime: null, endTime: '13:00', precision: 'exact' };
      return JSON.stringify(output([bound]));
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    const requests = vi.mocked(params.client.createChatCompletion).mock.calls;
    expect(requests[0][0].messages[0].content).toContain(VNEXT_CONSTRAINT_LEVEL_REQUIREMENT);
    expect(requests[0][0].messages[0].content).toContain(VNEXT_TEMPORAL_TARGET_REQUIREMENT);
    expect(requests[0][0].messages[0].content).toContain(VNEXT_ESTIMATE_ANSWER_REQUIREMENT);
    const repair = JSON.parse(requests[1][0].messages[requests[1][0].messages.length - 1].content);
    expect(repair.errors).toContainEqual(expect.objectContaining({ path: 'add[0].targetRef', localId: 'deadline', requirement: VNEXT_TEMPORAL_TARGET_REQUIREMENT }));
    const reading = output([{ kind: 'temporal_constraint', constraintKind: 'deadline', constraintLevel: 'hard' }]);
    expect(describeVNextProviderField('add[0].constraintLevel', reading)).toBe(VNEXT_CONSTRAINT_LEVEL_REQUIREMENT);
  });

  it('repairs an invalid named period once using the schema vocabulary without changing the date or independent workload', async () => {
    const bound = { kind: 'temporal_constraint', localId: 'tc1', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      constraintKind: 'deadline', constraintLevel: 'hard', dateExpression: 'this_week', namedTimePeriod: 'this_week',
      startTime: null, endTime: null, precision: 'exact' };
    const original = output([task(), workload(), bound]);
    const repaired = output([task(), workload('work', 999), { ...bound, namedTimePeriod: null, dateExpression: 'next_week' }]);
    const params = input([JSON.stringify(original), JSON.stringify(repaired)]);
    const before = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    expect(params.state).toEqual(before);
    expect(describeVNextProviderField('add[2].namedTimePeriod', original)).toBe(VNEXT_NAMED_TIME_PERIOD_REQUIREMENT);
    const requests = vi.mocked(params.client.createChatCompletion).mock.calls;
    expect(requests[0][0].messages[0].content).toContain(VNEXT_NAMED_TIME_PERIOD_REQUIREMENT);
    const messages = requests[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.instruction).toContain('Formal repair only');
    expect(repair.errors).toContainEqual({ path: 'add[2].namedTimePeriod', localId: 'tc1', requirement: VNEXT_NAMED_TIME_PERIOD_REQUIREMENT });
    expect(VNEXT_NAMED_TIME_PERIOD_REQUIREMENT).toContain('before_sleep, before_meal, after_meal');
    expect(VNEXT_NAMED_TIME_PERIOD_REQUIREMENT).toContain('custom:<label>');
    expect(VNEXT_NAMED_TIME_PERIOD_REQUIREMENT).toContain('Calendar days, weeks and dates belong in dateExpression');
    if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
    expect(result.delta.add[1]).toMatchObject({ amount: 7 });
    expect(result.delta.add[2]).toMatchObject({ dateExpression: 'this_week', namedTimePeriod: null });
  });

  it.each([null, 'this_week'])('requires an empty temporal constraint to acquire a bound in the one field repair (%s)', async dateExpression => {
    const bound = { kind: 'temporal_constraint', localId: 'tc1', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      constraintKind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: null,
      startTime: null, endTime: null, precision: 'exact' };
    const params = input([JSON.stringify(output([task(), workload(), bound])),
      JSON.stringify(output([task(), workload('work', 999), { ...bound, dateExpression }]))]);
    const before = structuredClone(params.state);
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result.metrics).toMatchObject({ calls: 2, repairs: 1 });
    expect(params.state).toEqual(before);
    const fields = ['dateExpression', 'namedTimePeriod', 'startTime', 'endTime'];
    const paths = fields.map(field => `add[2].${field}`);
    const messages = vi.mocked(params.client.createChatCompletion).mock.calls[1][0].messages;
    const repair = JSON.parse(messages[messages.length - 1].content);
    expect(repair.instruction).toContain('Formal repair only');
    expect(repair.errors.map((error: { path: string }) => error.path).sort()).toEqual([...paths].sort());
    expect(repair.errors.every((error: { localId: string }) => error.localId === 'tc1')).toBe(true);
    if (dateExpression === null) {
      expect(result).toMatchObject({ status: 'failed', reason: 'rejected_after_repair' });
      if (result.status !== 'failed') throw new Error(JSON.stringify(result));
      expect(result.errors.map(error => error.path).sort()).toEqual([...paths].sort());
    } else {
      if (result.status !== 'interpreted') throw new Error(JSON.stringify(result));
      expect(result.delta.add[1]).toMatchObject({ amount: 7 });
      expect(result.delta.add[2]).toMatchObject({ dateExpression: 'this_week', namedTimePeriod: null, startTime: null, endTime: null });
    }
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
    ] }, { expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: 'seed', conversationId: 'c', turnId: 'seed', sourceText: 'evidence' });
    if (seeded.status !== 'applied') throw new Error('setup');
    params.state = seeded.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    const patch = { kind: 'workload', localId: 'p', targetFactId: params.state.graph.workloads[0].id,
      amountDelta: null, changes: { amount: 8, unitCode: null, unitLabel: null, quantityRole: null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null } };
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      return JSON.stringify({ delta: { ...emptyDelta(), patch: [{ ...patch, targetFactId: context.activeFacts.workloads[0].id }] }, answer: null });
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', delta: { patch: [patch] } });
    expect(params.state.graph.workloads[0].amount).toBe(7);
  });

  it('repairs an unknown alias using the same vocabulary while retaining independent facts', async () => {
    const params = input([]);
    const seeded = applyWeeklyPlanningVNextTurn(params.state, { ...emptyDelta(), add: [
      { kind: 'task', localId: 'existing', title: 'Existing', category: 'study' },
    ] }, { expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: 'seed-alias', conversationId: 'c', turnId: 'seed', sourceText: 'seed' });
    if (seeded.status !== 'applied') throw new Error('setup');
    params.state = seeded.state;
    params.projection = projectWeeklyPlanningVNext(params.state);
    let calls = 0;
    params.client = { createChatCompletion: vi.fn(async request => {
      const context = JSON.parse(request.messages[1].content);
      const taskAlias = context.activeFacts.tasks[0].id;
      const taskRef = { factId: ++calls === 1 ? `${taskAlias}]},` : taskAlias };
      return JSON.stringify(output([{ ...workload(), taskRef }, task('independent', calls === 1 ? 'Preserve this' : 'Overwritten by repair')]));
    }) };
    const result = await createWeeklyPlanningVNextProviderInterpreter()(params);
    expect(result).toMatchObject({ status: 'interpreted', metrics: { calls: 2, repairs: 1 } });
    if (result.status === 'interpreted') {
      expect(result.delta.add[0]).toMatchObject({ taskRef: { factId: seeded.state.graph.tasks[0].id } });
      expect(result.delta.add[1]).toMatchObject({ title: 'Preserve this' });
    }
  });

  it('rejects unknown/inherited-key fields and mixed answer payloads', () => {
    expect(decodeVNextProviderOutput(JSON.parse('{"delta":{"add":[],"patch":[],"remove":[],"relate":[],"defer":[]},"answer":null,"constructor":{}}')).status).toBe('rejected');
    expect(decodeVNextProviderOutput(output([], { kind: 'option', optionId: 'x', minutes: 45, per: null })).status).toBe('rejected');
  });

  it('keeps experimental provider/session requests outside production trace and outbox', () => {
    // Explicit exclusion contract: synthetic experiment receipts are artifacts, never production trace.
    const files = ['./weeklyPlanningVNextProvider.ts', './weeklyPlanningVNextProviderPrompt.ts',
      './weeklyPlanningVNextProviderSchema.ts', './weeklyPlanningVNextProviderReferences.ts', '../application/weeklyPlanningVNextExperimentalSession.ts'];
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
      { expectedRevision: 0, acceptedDate: '2026-11-02', turnKey: 'setup', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    if (added.status !== 'applied') throw new Error('setup');
    const changed = applyWeeklyPlanningVNextTurn(added.state, { ...emptyDelta(), patch: [{ kind: 'task', localId: 'p',
      targetFactId: added.state.graph.tasks[0].id, changes: { title: 'Changed', category: null } }] },
    { expectedRevision: 1, acceptedDate: '2026-11-02', turnKey: 'change', conversationId: 'c', turnId: 't', sourceText: 'evidence' });
    if (changed.status !== 'applied') throw new Error('setup');
    params.state = changed.state;
    const message = JSON.parse(buildWeeklyPlanningVNextProviderMessages(params)[1].content);
    expect(message.clock).toEqual(params.clock);
    expect(message.activeFacts.tasks).toHaveLength(1);
    expect(message.activeFacts.tasks[0].title).toBe('Changed');
  });
});
