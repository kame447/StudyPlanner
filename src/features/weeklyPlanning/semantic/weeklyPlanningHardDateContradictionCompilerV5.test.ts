import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type PlanningFactLifecycleEntryV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';
import { resolveWeeklyPlanningTemporalConstraintsV5 } from './weeklyPlanningResolvedTemporalConstraintsV5';
import { validateWeeklyPlanningTemporalValuesV5 } from './weeklyPlanningTemporalValueValidatorV5';
import {
  createWeeklyPlanningTurnRequestContext,
  createWeeklyPlanningSchedulerContext,
  resolveWeeklyPlanningPlanningHorizon,
  resolveWeeklyPlanningAcceptedPlanningWindow,
} from '../application/weeklyPlanningTemporalContext';

function source(id: string) {
  return {
    conversationId: 'hard-date-contradiction',
    turnId: 'turn-1',
    semanticLocalId: id,
    sourceText: id,
    origin: 'user' as const,
  };
}

function active(factId: string): PlanningFactLifecycleEntryV5 {
  return {
    factId,
    status: 'active',
    createdRevision: 1,
    terminalRevision: null,
    supersededByFactId: null,
  };
}

function graph(perOccurrence: boolean): WeeklyPlanningFactGraphV5 {
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: 'レポート',
      source: source('task-1'),
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: 1,
      unitCode: 'hour',
      unitLabel: '時間',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence,
      periodExpression: perOccurrence ? '毎日' : null,
      source: source('workload-1'),
      createdRevision: 1,
    }],
    temporalConstraints: [
      {
        id: 'earliest-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'earliest_start',
        constraintLevel: 'hard',
        dateExpression: '2026-08-30',
        namedTimePeriod: null,
        startTime: '09:00',
        endTime: null,
        precision: 'exact',
        source: source('earliest-1'),
        createdRevision: 1,
      },
      {
        id: 'deadline-1',
        taskId: 'task-1',
        targetFactId: 'task-1',
        kind: 'deadline',
        constraintLevel: 'hard',
        dateExpression: '2026-08-27',
        namedTimePeriod: null,
        startTime: null,
        endTime: null,
        precision: 'exact',
        source: source('deadline-1'),
        createdRevision: 1,
      },
    ],
    recurrences: perOccurrence
      ? [{
          id: 'recurrence-1',
          taskId: 'task-1',
          targetFactId: 'task-1',
          kind: 'daily',
          count: null,
          days: [],
          source: source('recurrence-1'),
          createdRevision: 1,
        }]
      : [],
    factLifecycles: [
      active('task-1'),
      active('workload-1'),
      active('earliest-1'),
      active('deadline-1'),
      ...(perOccurrence ? [active('recurrence-1')] : []),
    ],
  };
}

function compile(perOccurrence: boolean) {
  return compileGenericSchedulerInput({
    graph: createWeeklyPlanningActiveSchedulerGraphViewV5(graph(perOccurrence)),
    context: {
      ownerId: 'owner-1',
      currentDate: '2026-08-26',
      planningStartDate: '2026-08-26',
      planningEndDate: '2026-09-01',
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('weekly planning hard date contradiction compiler boundary', () => {
  it.each([false, true])(
    'returns needs_resolution before distribution or placement (perOccurrence=%s)',
    (perOccurrence) => {
      const result = compile(perOccurrence);

      expect(result.status).toBe('needs_resolution');
      expect(result.input).toBeNull();
      expect(result.issues).toContainEqual(expect.objectContaining({
        domain: 'temporal_constraint',
        code: 'contradictory_hard_date_bound',
        blocking: true,
        details: expect.objectContaining({
          taskId: 'task-1',
          targetFactId: 'task-1',
          startDate: '2026-08-30',
          endDate: '2026-08-27',
        }),
      }));
    },
  );
});

// Reuse the existing one-hour task; the source strings deliberately carry no date truth.
function acceptedTemporalScopeGraph(
  form: 'task' | 'plan',
  dateExpression: string,
): WeeklyPlanningFactGraphV5 {
  const value = graph(false);
  value.planningWindows = [{
    id: 'window-1', kind: 'absolute', value: '2026-10-12/2026-10-13',
    start: '2026-10-12', end: '2026-10-13',
    source: source('window-1'), createdRevision: 1,
  }];
  value.temporalConstraints = form === 'task' ? [{
    ...value.temporalConstraints[0], id: 'preference-1', kind: 'preferred_window',
    constraintLevel: 'soft', dateExpression, startTime: '20:00', endTime: '22:00',
    source: source('preference-1'),
  }] : [];
  value.availabilityDeclarations = form === 'plan' ? [{
    id: 'preference-1', kind: 'preferred', dateExpression,
    namedTimePeriod: null, startTime: '20:00', endTime: '22:00',
    recurrenceKind: null, days: [], constraintLevel: 'soft', resolutionStatus: 'unresolved',
    source: source('preference-1'), createdRevision: 1,
  }] : [];
  value.factLifecycles = ['task-1', 'workload-1', 'window-1', 'preference-1'].map(active);
  return value;
}

const scopeRequest = createWeeklyPlanningTurnRequestContext({
  startedAtIso: '2026-10-08T03:00:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
});

type TemporalSnapshots = Pick<Parameters<typeof compileGenericSchedulerInput>[0],
  'resolvedDateExpressions' | 'resolvedTemporalConstraints'>;

function compileTemporalScope(value: WeeklyPlanningFactGraphV5, snapshots: TemporalSnapshots = {}) {
  const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
  const acceptedPlanningWindow = resolveWeeklyPlanningAcceptedPlanningWindow({
    graph: activeGraph, requestContext: scopeRequest,
  });
  const horizon = resolveWeeklyPlanningPlanningHorizon({
    graph: activeGraph, selectedDate: '2026-10-12', requestContext: scopeRequest,
    resolvedTemporalConstraints: resolveWeeklyPlanningTemporalConstraintsV5({
      graph: activeGraph, currentDate: scopeRequest.currentDate,
      weekStartsOn: scopeRequest.weekStartsOn,
    }),
  });
  return compileGenericSchedulerInput({
    graph: activeGraph,
    context: createWeeklyPlanningSchedulerContext({
      ownerId: 'owner-1', horizon, acceptedPlanningWindow, requestContext: scopeRequest,
    }),
    ...snapshots,
  });
}

describe('accepted temporal scope at the scheduler boundary', () => {
  it.each(['task', 'plan'] as const)(
    'asks for an out-of-period %s weekday',
    (form) => {
      const value = acceptedTemporalScopeGraph(form, 'weekday:friday');
      const before = structuredClone(value);
      const result = compileTemporalScope(value);
      expect(result.status).toBe('needs_resolution');
      expect(result.input).toBeNull();
      expect(result.issues).toContainEqual(expect.objectContaining({
        factId: 'preference-1', blocking: true,
        domain: form === 'task' ? 'temporal_constraint' : 'availability',
      }));
      expect(value).toEqual(before);
    },
  );

  it.each(['task', 'plan'] as const)(
    'preserves an absolute out-of-period %s soft preference as nonblocking fallback',
    (form) => {
      // An explicit absolute soft preference is resolved but unavailable; it does
      // not become a new hard requirement merely because it is outside the period.
      const fallback = compileTemporalScope(acceptedTemporalScopeGraph(form, '2026-10-09'));
      expect(fallback.status).toBe('ready');
      expect(fallback.input?.preferredPlacements).toEqual([]);
      expect(fallback.issues.some(issue => issue.blocking)).toBe(false);
      if (form === 'plan') {
        expect(fallback.issues).toContainEqual(expect.objectContaining({
          domain: 'availability', code: 'availability_outside_planning_window',
          factId: 'preference-1', blocking: false,
        }));
      }
    },
  );

  it.each(['task', 'plan'] as const)(
    'carries an in-period %s preference through compilation into an actual candidate',
    (form) => {
      const value = acceptedTemporalScopeGraph(form, '2026-10-12');
      const result = compileTemporalScope(value);
      expect(result.status).toBe('ready');
      expect(result.input?.preferredPlacements).toContainEqual(expect.objectContaining({
        sourceFactId: 'preference-1', taskId: 'task-1', targetFactId: 'task-1',
        dates: ['2026-10-12'], window: { startMinute: 1200, endMinute: 1320 },
      }));
      const scheduled = scheduleWeeklyPlanningStableV5Preview({
        input: result.input!,
        graph: createWeeklyPlanningPlacementGraphViewV5(
          createWeeklyPlanningActiveSchedulerGraphViewV5(value),
        ),
      });
      expect(scheduled.status).toBe('ready');
      expect(scheduled.candidates).toHaveLength(1);
      expect(scheduled.unscheduledWorkItemIds).toEqual([]);
      expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-12' });
      expect(scheduled.candidates[0].startTime >= '20:00').toBe(true);
      expect(scheduled.candidates[0].endTime <= '22:00').toBe(true);
    },
  );

  it.each([
    ['task', '2026-10-18', ['2026-10-16']],
    ['plan', '2026-10-18', ['2026-10-16']],
    ['task', '2026-10-23', ['2026-10-16', '2026-10-23']],
    ['plan', '2026-10-23', ['2026-10-16', '2026-10-23']],
  ] as const)('places an accepted %s weekday through %s without filling between occurrences', (form, end, dates) => {
    const value = acceptedTemporalScopeGraph(form, 'weekday:friday');
    value.planningWindows[0].end = end;
    value.planningWindows[0].value = `2026-10-12/${end}`;
    const result = compileTemporalScope(value);
    expect(result.status).toBe('ready');
    const projectedDates = [...new Set(result.input!.preferredPlacements.flatMap((fact) => fact.dates))].sort();
    expect(projectedDates).toEqual(dates);
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: result.input!,
      graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)),
    });
    expect(scheduled.candidates).toHaveLength(1);
    expect(dates).toContain(scheduled.candidates[0].date);
    expect(scheduled.candidates[0].startTime >= '20:00').toBe(true);
    expect(scheduled.candidates[0].endTime <= '22:00').toBe(true);
  });

  it.each([false, true])(
    'only classifies a hard bound as outside an accepted period (accepted=%s)',
    (accepted) => {
      const value = acceptedTemporalScopeGraph('task', '2026-10-09');
      value.temporalConstraints[0] = {
        ...value.temporalConstraints[0], kind: 'deadline', constraintLevel: 'hard',
        startTime: null, endTime: null,
      };
      if (!accepted) {
        value.planningWindows = [];
        value.factLifecycles = value.factLifecycles.filter(entry => entry.factId !== 'window-1');
      }
      const result = compileTemporalScope(value);
      const scopeIssue = expect.objectContaining({
        code: 'hard_date_bound_outside_planning_window', factId: 'preference-1', blocking: true,
      });
      if (accepted) {
        expect(result.status).toBe('needs_resolution');
        expect(result.input).toBeNull();
        expect(result.issues).toContainEqual(scopeIssue);
      } else {
        expect(result.issues).not.toContainEqual(scopeIssue);
        // The UI fallback is real and nonempty, but it never becomes an accepted fact.
        expect(result.input?.horizon).toMatchObject({
          startDate: '2026-10-12', endDate: '2026-10-18', planningWindowFactIds: [],
        });
        expect(result.input?.hardDateBounds[0].endDate).toBe('2026-10-09');
      }
    },
  );

  it('grounds a hard weekday inside the accepted week rather than the request week', () => {
    const value = acceptedTemporalScopeGraph('task', 'weekday:friday');
    value.planningWindows[0] = {
      ...value.planningWindows[0], kind: 'relative_week', value: 'next_week', start: null, end: null,
    };
    value.temporalConstraints[0] = {
      ...value.temporalConstraints[0], kind: 'deadline', constraintLevel: 'hard',
      startTime: null, endTime: null,
    };
    const result = compileTemporalScope(value);
    expect(result.status).toBe('ready');
    expect(result.input?.hardDateBounds).toContainEqual(expect.objectContaining({
      taskId: 'task-1', endDate: '2026-10-16', sourceFactIds: ['preference-1'],
    }));
  });

  it.each([
    ['start only', '20:00', null, { startMinute: 1200, endMinute: 1440 }],
    ['end only', null, '22:00', { startMinute: 0, endMinute: 1320 }],
    ['date only', null, null, null],
  ] as const)('preserves a typed %s preference without inventing clock semantics', (_label, startTime, endTime, window) => {
    const value = acceptedTemporalScopeGraph('task', '2026-10-12');
    Object.assign(value.temporalConstraints[0], { startTime, endTime });
    const result = compileTemporalScope(value);
    expect(result.status).toBe('ready');
    expect(result.input?.preferredPlacements).toEqual([expect.objectContaining({
      sourceFactId: 'preference-1', dates: ['2026-10-12'], window,
    })]);
  });

  it.each([
    ['night', false],
    ['custom:unresolved-period', true],
  ] as const)('validates named period %s before a workload exists', (namedTimePeriod, unresolved) => {
    const value = acceptedTemporalScopeGraph('task', '2026-10-12');
    value.workloads = [];
    value.factLifecycles = value.factLifecycles.filter(entry => entry.factId !== 'workload-1');
    Object.assign(value.temporalConstraints[0], {
      startTime: null, endTime: null, namedTimePeriod,
    });
    const result = compileTemporalScope(value);
    expect(result.status).toBe('needs_resolution');
    expect(result.input).toBeNull();
    const temporalIssues = result.issues.filter(issue => issue.domain === 'temporal_constraint');
    if (unresolved) {
      expect(temporalIssues).toContainEqual(expect.objectContaining({
        code: 'named_time_period_unresolved', factId: 'preference-1', blocking: true,
      }));
    } else {
      expect(temporalIssues).toEqual([]);
    }
  });

});


describe('captured hard-clock placement boundary', () => {
  it('keeps the accepted daily task after its date-free hard earliest clock', async () => {
    // Exact first-live semantic bytes; request clock/empty calendar are an adapted offline context.
    // C2 alone characterized one 70-minute item. With E, preserve the same accepted bytes
    // and verify both whole-unit 30-minute sessions against the hard clock.
    const capturedSemantic = "{\"schemaVersion\":\"weekly-planning-semantic-v5\",\"planningIntent\":\"create_plan\",\"planningWindow\":{\"localId\":\"window-1\",\"kind\":\"absolute\",\"value\":\"2026-08-24/2026-08-30\",\"start\":\"2026-08-24\",\"end\":\"2026-08-30\",\"sourceText\":\"2026年8月24日から30日\"},\"tasks\":[{\"localId\":\"task-1\",\"existingPublicId\":null,\"decompositionStatus\":\"atomic\",\"category\":\"study\",\"title\":\"数学の問題集を進める\",\"study\":{\"purpose\":\"practice\",\"activityKind\":\"problem_solving\",\"contextLabel\":\"数学の問題集\",\"components\":[]}, \"workloads\":[{\"localId\":\"workload-1\",\"quantityRole\":\"target\",\"amount\":20,\"unitCode\":\"problem\",\"unitLabel\":\"問\",\"rangeStart\":null,\"rangeEnd\":null,\"perOccurrence\":false,\"periodExpression\":null,\"sourceText\":\"数学の問題集を20問進める\"}],\"effortEstimates\":[{\"localId\":\"effort-1\",\"targetLocalId\":\"workload-1\",\"kind\":\"duration_per_unit\",\"minutes\":3,\"unitCode\":\"problem\",\"precision\":\"exact\",\"sourceText\":\"1問3分\"},{\"localId\":\"effort-2\",\"targetLocalId\":\"task-1\",\"kind\":\"session_duration\",\"minutes\":30,\"unitCode\":\"session\",\"precision\":\"exact\",\"sourceText\":\"1回30分\"}],\"temporalConstraints\":[{\"localId\":\"time-1\",\"targetLocalId\":\"task-1\",\"kind\":\"earliest_start\",\"constraintLevel\":\"hard\",\"dateExpression\":null,\"namedTimePeriod\":null,\"startTime\":\"20:00\",\"endTime\":null,\"precision\":\"exact\",\"sourceText\":\"毎日20時以降\"}],\"recurrence\":[{\"localId\":\"recurrence-1\",\"targetLocalId\":\"task-1\",\"kind\":\"daily\",\"count\":null,\"days\":[],\"sourceText\":\"毎日\"}],\"durableContextSignals\":[],\"sourceText\":\"数学の問題集を20問進める計画\"}],\"relations\":[],\"availabilityDeclarations\":[],\"constraintSourceRequests\":[],\"userContextFacts\":[],\"uncertainties\":[],\"corrections\":[],\"decisions\":[]}";
    expect(createHash('sha256').update(capturedSemantic).digest('hex'))
      .toBe('b1449151aa476ae7b14f4babe06b46d7bcff9f53c7d4a7f2365f16bcc8fbc132');
    const normalized = await createWeeklyPlanningSemanticNormalizerV5({
      createChatCompletion: async () => capturedSemantic,
    }).normalize({
      userText: '2026年8月24日から30日で、数学の問題集を20問進める計画のプレビューを作って。1問3分、1回30分、毎日20時以降で。',
      traceRequestId: 'captured-hard-clock-normalization',
    });
    expect(normalized.status).toBe('accepted');
    expect(normalized.diagnostics.attemptCount).toBe(1);
    if (!normalized.document) throw new Error('Expected the captured document to be accepted');
    const applied = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(), document: normalized.document,
      context: { conversationId: 'captured-hard-clock', turnId: 'first-turn', expectedRevision: 0 },
    });
    expect(applied.status).toBe('applied');
    const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(applied.graph);
    expect(activeGraph.temporalConstraints).toContainEqual(expect.objectContaining({
      kind: 'earliest_start', constraintLevel: 'hard', dateExpression: null,
      startTime: '20:00', endTime: null, namedTimePeriod: null,
    }));
    expect(activeGraph.recurrences).toContainEqual(expect.objectContaining({ kind: 'daily' }));
    expect(activeGraph.workloads).toContainEqual(expect.objectContaining({ amount: 20, unitCode: 'problem', perOccurrence: false }));
    const task = activeGraph.tasks[0];
    const workload = activeGraph.workloads[0];
    const pace = activeGraph.effortEstimates.find((fact) => fact.kind === 'duration_per_unit');
    const cap = activeGraph.effortEstimates.find((fact) => fact.kind === 'session_duration');
    const hardClock = activeGraph.temporalConstraints[0];
    if (!task || !workload || !pace || !cap || !hardClock) throw new Error('Expected all captured canonical facts');
    expect(pace).toMatchObject({ targetFactId: workload.id, minutes: 3, unitCode: 'problem' });
    expect(cap).toMatchObject({ targetFactId: task.id, minutes: 30, unitCode: 'session' });
    const workRefs = [task.id, workload.id, pace.id, cap.id];
    workRefs.forEach((factId) => expect(applied.graph.factLifecycles).toContainEqual(
      expect.objectContaining({ factId, status: 'active' }),
    ));
    const before = structuredClone(applied.graph);
    const requestContext = createWeeklyPlanningTurnRequestContext({
      startedAtIso: '2026-08-19T01:00:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday',
    });
    const acceptedPlanningWindow = resolveWeeklyPlanningAcceptedPlanningWindow({ graph: activeGraph, requestContext });
    expect(acceptedPlanningWindow).toMatchObject({ startDate: '2026-08-24', endDate: '2026-08-30' });
    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({
      graph: activeGraph, currentDate: requestContext.currentDate,
      weekStartsOn: requestContext.weekStartsOn, planningWindow: acceptedPlanningWindow,
    });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
      graph: activeGraph, currentDate: requestContext.currentDate,
      resolvedDateExpressions, weekStartsOn: requestContext.weekStartsOn,
    });
    const horizon = resolveWeeklyPlanningPlanningHorizon({
      graph: activeGraph, selectedDate: '2026-08-19', requestContext,
      acceptedPlanningWindow, resolvedTemporalConstraints,
    });
    const compilation = compileGenericSchedulerInput({
      graph: activeGraph, resolvedDateExpressions, resolvedTemporalConstraints, context: createWeeklyPlanningSchedulerContext({
        ownerId: 'captured-hard-clock-owner', horizon, acceptedPlanningWindow, requestContext,
      }),
    });
    expect(compilation.status).toBe('ready');
    if (!compilation.input) throw new Error('Expected a complete compiler input');
    const items = compilation.input.movableWorkItems;
    // floor(30 / 3) = 10 whole problems per session; 20 problems need exactly 2.
    // Each cost floor is 30, so no optional margin fits these minimum 2 sessions.
    expect(items.map((item) => ({ quantity: item.quantity, base: item.baseEstimatedMinutes, occupied: item.estimatedMinutes })))
      .toEqual([
        { quantity: { amount: 10, unitCode: 'problem', unitLabel: '問', ordinalRange: { start: 1, end: 10 }, actualRange: null }, base: 30, occupied: 30 },
        { quantity: { amount: 10, unitCode: 'problem', unitLabel: '問', ordinalRange: { start: 11, end: 20 }, actualRange: null }, base: 30, occupied: 30 },
      ]);
    items.forEach((item) => {
      expect(item).toMatchObject({ taskId: task.id, workloadFactId: workload.id, splitPolicy: 'atomic', calibrationMultiplier: 1 });
      expect([...item.sourceFactRefs].sort()).toEqual([...workRefs].sort());
      expect(item.estimateSourceFactIds).toEqual([pace.id]);
    });
    expect(compilation.input.hardClockBounds).toEqual([{ taskId: task.id, targetFactId: task.id,
      sourceFactId: hardClock.id, kind: 'earliest_start', minute: 1200, anchorDate: null }]);
    expect(compilation.input.sourceFactRefs).toEqual(expect.arrayContaining([...workRefs, hardClock.id]));
    const scheduled = scheduleWeeklyPlanningStableV5Preview({
      input: compilation.input, graph: createWeeklyPlanningPlacementGraphViewV5(activeGraph),
    });
    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
    expect(scheduled.candidates).toHaveLength(2);
    expect(scheduled.candidates.map((candidate) => candidate.workItemKey).sort()).toEqual(items.map((item) => item.id).sort());
    expect(new Set(scheduled.candidates.map((candidate) => candidate.stableKey)).size).toBe(2);
    expect(scheduled.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(60);
    for (const candidate of scheduled.candidates) {
      const item = items.find((item) => item.id === candidate.workItemKey);
      if (!item) throw new Error('Expected one candidate for each compiled session');
      expect(candidate).toMatchObject({ durationMinutes: 30, estimatedMinutes: 30, approvalStatus: 'unapproved',
        title: item.label, stableV5Metadata: { runtime: 'stable_v5', graphRevision: applied.graph.revision,
          taskId: task.id, sourceFactRefs: item.sourceFactRefs } });
      const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
      expect(minute(candidate.endTime) - minute(candidate.startTime)).toBe(30);
      expect(candidate.date >= '2026-08-24' && candidate.date <= '2026-08-30').toBe(true);
      expect(candidate.startTime >= '20:00').toBe(true);
    }
    expect(applied.graph).toEqual(before);
  });
});

// Reuse the existing one-hour task and accepted two-day scope; clocks stay typed.
function hardClockScopeGraph(params: {
  kind: 'earliest_start' | 'latest_end' | 'deadline';
  dateExpression: string | null;
  time: string;
  daily?: boolean;
}): WeeklyPlanningFactGraphV5 {
  const value = acceptedTemporalScopeGraph('task', '2026-10-12');
  value.temporalConstraints = [{
    ...value.temporalConstraints[0], id: 'hard-clock-1', kind: params.kind,
    constraintLevel: 'hard', dateExpression: params.dateExpression,
    startTime: params.kind === 'earliest_start' ? params.time : null,
    endTime: params.kind === 'earliest_start' ? null : params.time,
    source: source('hard-clock-1'),
  }];
  value.factLifecycles = value.factLifecycles.filter(entry => entry.factId !== 'preference-1');
  value.factLifecycles.push(active('hard-clock-1'));
  if (params.daily) {
    value.recurrences = [{ id: 'daily-1', taskId: 'task-1', targetFactId: 'task-1',
      kind: 'daily', count: null, days: [], source: source('daily-1'), createdRevision: 1 }];
    value.factLifecycles.push(active('daily-1'));
  }
  return value;
}

function placeHardClockScope(value: WeeklyPlanningFactGraphV5, notBeforeDate = '2026-10-12', snapshots: TemporalSnapshots = {}) {
  const before = structuredClone(value);
  const compilation = compileTemporalScope(value, snapshots);
  expect(compilation.status).toBe('ready');
  if (!compilation.input) throw new Error('Expected a schedulable hard-clock fixture');
  const inputBefore = structuredClone(compilation.input);
  const scheduled = scheduleWeeklyPlanningStableV5Preview({
    input: compilation.input,
    graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)),
    notBefore: { date: notBeforeDate, time: '09:00' },
  });
  expect(value).toEqual(before);
  expect(compilation.input).toEqual(inputBefore);
  return { input: compilation.input, scheduled };
}

describe('typed task hard-clock placement controls', () => {
  it.each([
    { name: 'dateless lower bound without recurrence', kind: 'earliest_start', date: null, time: '20:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'dateless daily lower bound on a later day', kind: 'earliest_start', date: null, time: '20:00',
      daily: true, placeDate: '2026-10-13', lower: '20:00', upper: null },
    { name: 'dateless upper bound defeats a late soft preference', kind: 'latest_end', date: null, time: '13:00',
      daily: false, placeDate: '2026-10-12', lower: '09:00', upper: '13:00' },
    { name: 'absolute lower bound on its boundary day', kind: 'earliest_start', date: '2026-10-12', time: '20:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'absolute lower bound does not repeat on later days', kind: 'earliest_start', date: '2026-10-12', time: '20:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: null },
    { name: 'absolute upper bound on its boundary day', kind: 'latest_end', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: '13:00' },
    { name: 'absolute upper bound does not repeat on earlier days', kind: 'latest_end', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-12', lower: '20:00', upper: null },
    { name: 'absolute deadline clock caps completion on its boundary day', kind: 'deadline', date: '2026-10-13', time: '13:00',
      daily: false, placeDate: '2026-10-13', lower: '09:00', upper: '13:00' },
  ] as const)('$name', ({ kind, date, time, daily, placeDate, lower, upper }) => {
    const value = hardClockScopeGraph({ kind, dateExpression: date, time, daily });
    if (kind !== 'earliest_start') {
      value.temporalConstraints.push({
        ...value.temporalConstraints[0], id: 'late-preference', kind: 'preferred_window', constraintLevel: 'soft',
        dateExpression: null, startTime: '20:00', endTime: '22:00', source: source('late-preference'),
      });
      value.factLifecycles.push(active('late-preference'));
    }
    const { input, scheduled } = placeHardClockScope(value, placeDate);
    expect(input.movableWorkItems).toHaveLength(1); // recurrence must not manufacture another total workload
    expect(input.movableWorkItems[0]).toMatchObject({ baseEstimatedMinutes: 60, estimatedMinutes: 60, estimateBasis: 'intrinsic_duration' });
    expect(scheduled.status).toBe('ready');
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: placeDate, startTime: lower, durationMinutes: 60 });
    if (upper) expect(scheduled.candidates[0].endTime <= upper).toBe(true);
    expect(input.sourceFactRefs).toContain('hard-clock-1');
  });

  it.each(['task-1', 'component-1'] as const)('keeps hard-clock inheritance scoped to %s', (targetFactId) => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints[0].targetFactId = targetFactId;
    if (targetFactId === 'component-1') {
      value.planningWindows[0].end = '2026-10-12';
      value.planningWindows[0].value = '2026-10-12/2026-10-12';
    }
    value.components = ['component-1', 'component-2'].map(id => ({
      id, taskId: 'task-1', parentComponentId: null, role: 'section' as const, label: id,
      source: source(id), createdRevision: 1,
    }));
    value.workloads = value.components.map((component, index) => ({
      ...value.workloads[0], id: `workload-${index + 1}`, componentId: component.id,
    }));
    value.factLifecycles.push(...['component-1', 'component-2', 'workload-2'].map(active));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe('ready');
    expect(scheduled.candidates).toHaveLength(2);
    expect(scheduled.unscheduledWorkItemIds).toEqual([]);
    for (const component of value.components) {
      const item = input.movableWorkItems.find(item => item.componentId === component.id);
      const candidate = scheduled.candidates.find(candidate => candidate.workItemKey === item?.id);
      if (!candidate) throw new Error(`Expected work for ${component.id}`);
      expect(candidate.durationMinutes).toBe(60);
      expect(candidate.startTime >= '20:00').toBe(targetFactId === 'task-1' || component.id === 'component-1');
      if (targetFactId === 'component-1') {
        expect(candidate.date).toBe('2026-10-12');
        expect(candidate.startTime).toBe(component.id === 'component-1' ? '20:00' : '09:00');
      }
    }
    expect(input.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId, sourceFactId: 'hard-clock-1',
      kind: 'earliest_start', minute: 1200, anchorDate: null }]);
    // Reusing the same compiled input cannot inherit another item's clock mask.
    expect(scheduleWeeklyPlanningStableV5Preview({ input, graph: createWeeklyPlanningPlacementGraphViewV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(value)), notBefore: { date: '2026-10-12', time: '09:00' },
    })).toEqual(scheduled);
  });

  it('fails closed when the remaining hard-clock interval cannot fit the current single chunk', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '21:30' });
    value.temporalConstraints.push({
      ...value.temporalConstraints[0], id: 'hard-clock-end', kind: 'latest_end',
      startTime: null, endTime: '22:00', source: source('hard-clock-end'),
    });
    value.factLifecycles.push(active('hard-clock-end'));
    const { input, scheduled } = placeHardClockScope(value);
    // This intrinsic one-hour item is one current chunk; the typed 21:30–22:00 window has only30 minutes.
    expect(input.movableWorkItems[0]).toMatchObject({
      baseEstimatedMinutes: 60, estimatedMinutes: 60, estimateBasis: 'intrinsic_duration', splitPolicy: 'splittable',
    });
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('preserves date clipping before an absolute earliest clock', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: '2026-10-13', time: '20:00' });
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardDateBounds[0].startDate).toBe('2026-10-13');
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-13', startTime: '20:00' });
  });

  it.each(['latest_end', 'deadline'] as const)('preserves date clipping after an absolute %s clock', kind => {
    const value = hardClockScopeGraph({ kind, dateExpression: '2026-10-12', time: '13:00' });
    const { input, scheduled } = placeHardClockScope(value, '2026-10-13');
    expect(input.hardDateBounds[0].endDate).toBe('2026-10-12');
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('keeps a dateless clock alongside a separate absolute lower bound', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'absolute-start',
      dateExpression: '2026-10-13', startTime: '09:00', source: source('absolute-start') });
    value.factLifecycles.push(active('absolute-start'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardClockBounds).toEqual([
      { taskId: 'task-1', targetFactId: 'task-1', sourceFactId: 'hard-clock-1', kind: 'earliest_start', minute: 1200, anchorDate: null },
      { taskId: 'task-1', targetFactId: 'task-1', sourceFactId: 'absolute-start', kind: 'earliest_start', minute: 540, anchorDate: '2026-10-13' },
    ]);
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-13', startTime: '20:00' });
  });

  it('retains a dateless accepted clock snapshot before a workload is supplied', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    const [workload] = value.workloads;
    value.workloads = [];
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), currentDate: scopeRequest.currentDate,
      weekStartsOn: scopeRequest.weekStartsOn,
    });
    expect(resolvedTemporalConstraints.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      sourceFactId: 'hard-clock-1', kind: 'earliest_start', minute: 1200, anchorDate: null }]);
    value.workloads = [workload];
    const compilation = compileGenericSchedulerInput({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), resolvedTemporalConstraints,
      context: { ownerId: 'owner-1', currentDate: scopeRequest.currentDate, planningStartDate: '2026-10-12',
        planningEndDate: '2026-10-13', timeZone: scopeRequest.timeZone },
    });
    expect(compilation.status).toBe('ready');
    if (!compilation.input) throw new Error('Expected the supplied workload to compile');
    const scheduled = scheduleWeeklyPlanningStableV5Preview({ input: compilation.input,
      graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)) });
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0].startTime).toBe('20:00');
  });

  it.each(['current', 'retired', 'other-task'] as const)('materializes current targets from the supplied date snapshot (source=%s)', mode => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: 'tomorrow', time: '20:00' });
    const workloads = value.workloads;
    value.workloads = [];
    const beforeWork = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({ graph: beforeWork,
      currentDate: '2026-10-11', weekStartsOn: 'monday' });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({ graph: beforeWork,
      currentDate: '2026-10-11', resolvedDateExpressions });
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]);
    expect(resolvedTemporalConstraints.hardClockBounds[0].anchorDate).toBe('2026-10-12');
    value.workloads = workloads;
    if (mode === 'retired') {
      Object.assign(value.factLifecycles.find(entry => entry.factId === 'hard-clock-1')!, {
        status: 'removed', terminalRevision: 2,
      });
      value.revision = 2;
    }
    if (mode === 'other-task') {
      value.tasks.push({ ...value.tasks[0], id: 'task-2', title: '物理', source: source('task-2') });
      value.workloads.push({ ...workloads[0], id: 'workload-2', taskId: 'task-2', source: source('workload-2') });
      value.factLifecycles.push(active('task-2'), active('workload-2'));
    }
    const { input, scheduled } = placeHardClockScope(value, '2026-10-12', { resolvedDateExpressions, resolvedTemporalConstraints });
    // The compiler request reference is Oct8; reparsing tomorrow would incorrectly produce Oct9.
    expect(input.hardDateBounds).toEqual(mode === 'retired' ? [] : [{ taskId: 'task-1', targetFactId: 'task-1',
      startDate: '2026-10-12', endDate: null, sourceFactIds: ['hard-clock-1'] }]);
    const firstWork = input.movableWorkItems.find(item => item.taskId === 'task-1');
    const first = scheduled.candidates.find(candidate => candidate.workItemKey === firstWork?.id);
    expect(first?.startTime).toBe(mode === 'retired' ? '09:00' : '20:00');
    if (mode === 'retired') {
      expect(input.hardClockBounds).toEqual([]);
      expect(input.sourceFactRefs).not.toContain('hard-clock-1');
    }
    if (mode === 'other-task') {
      const otherWork = input.movableWorkItems.find(item => item.taskId === 'task-2');
      expect(scheduled.candidates.find(candidate => candidate.workItemKey === otherWork?.id)?.startTime).toBe('09:00');
    }
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]); // Caller-owned snapshot stays unchanged.
  });

  it('preserves a standalone temporal snapshot without reinterpreting its date at the current clock', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: 'tomorrow', time: '20:00' });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({
      graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), currentDate: '2026-10-11',
    });
    const before = structuredClone(resolvedTemporalConstraints);
    const { input, scheduled } = placeHardClockScope(value, '2026-10-12', { resolvedTemporalConstraints });
    expect(input.horizon.referenceDate).toBe('2026-10-08');
    expect(input.hardDateBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      startDate: '2026-10-12', endDate: null, sourceFactIds: ['hard-clock-1'] }]);
    expect(input.hardClockBounds![0].anchorDate).toBe('2026-10-12');
    expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-12', startTime: '20:00' });
    expect(resolvedTemporalConstraints).toEqual(before);
  });

  it('detects contradictory dates for newly supplied work before placement', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: '2026-10-13', time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'upper-clock', kind: 'latest_end',
      dateExpression: '2026-10-12', startTime: null, endTime: '13:00', source: source('upper-clock') });
    value.factLifecycles.push(active('upper-clock'));
    const workloads = value.workloads;
    value.workloads = [];
    const activeGraph = createWeeklyPlanningActiveSchedulerGraphViewV5(value);
    const resolvedDateExpressions = resolveWeeklyPlanningDateExpressionsV5({ graph: activeGraph, currentDate: scopeRequest.currentDate });
    const resolvedTemporalConstraints = resolveWeeklyPlanningTemporalConstraintsV5({ graph: activeGraph,
      currentDate: scopeRequest.currentDate, resolvedDateExpressions });
    expect(resolvedTemporalConstraints.hardDateBounds).toEqual([]);
    value.workloads = workloads;
    const compilation = compileTemporalScope(value, { resolvedDateExpressions, resolvedTemporalConstraints });
    expect(compilation.status).toBe('needs_resolution');
    expect(compilation.input).toBeNull();
    expect(compilation.issues).toContainEqual(expect.objectContaining({ code: 'contradictory_hard_date_bound', blocking: true,
      details: expect.objectContaining({ taskId: 'task-1', startDate: '2026-10-13', endDate: '2026-10-12' }) }));
  });

  it('uses only the active replacement clock and its source identity', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    Object.assign(value.factLifecycles.find(entry => entry.factId === 'hard-clock-1')!, {
      status: 'superseded', terminalRevision: 2, supersededByFactId: 'replacement-clock',
    });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'replacement-clock',
      startTime: '17:00', source: source('replacement-clock'), createdRevision: 2 });
    value.factLifecycles.push({ ...active('replacement-clock'), createdRevision: 2 });
    value.revision = 2;
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardClockBounds).toEqual([{ taskId: 'task-1', targetFactId: 'task-1',
      sourceFactId: 'replacement-clock', kind: 'earliest_start', minute: 1020, anchorDate: null }]);
    expect(input.sourceFactRefs).toContain('replacement-clock');
    expect(input.sourceFactRefs).not.toContain('hard-clock-1');
    expect(scheduled.candidates[0].startTime).toBe('17:00');
  });

  it.each(['none', 'overlap', 'empty'] as const)('intersects early preference and existing hard availability without dropping an empty mask (available=%s)', available => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'early-preference', kind: 'preferred_window',
      constraintLevel: 'soft', startTime: '09:00', endTime: '11:00', source: source('early-preference') });
    value.factLifecycles.push(active('early-preference'));
    if (available !== 'none') {
      value.availabilityDeclarations = [{ id: 'hard-available', kind: 'available', dateExpression: null,
        startTime: available === 'overlap' ? '19:30' : '09:00',
        endTime: available === 'overlap' ? '21:30' : '11:00', namedTimePeriod: null, recurrenceKind: 'daily', days: [],
        constraintLevel: 'hard', resolutionStatus: 'unresolved', source: source('hard-available'), createdRevision: 1 }];
      value.factLifecycles.push(active('hard-available'));
    }
    const { input, scheduled } = placeHardClockScope(value);
    if (available !== 'none') expect(input.availabilityWindows).toHaveLength(2);
    if (available === 'empty') {
      expect(scheduled.status).toBe('insufficient_capacity');
      expect(scheduled.candidates).toEqual([]);
      expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
    } else {
      expect(scheduled.status).toBe('ready');
      expect(scheduled.candidates[0].startTime).toBe('20:00');
    }
  });

  it.each([false, true])('does not manufacture evening availability from a date-only preference (explicitClock=%s)', explicitClock => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '22:30' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'late-date-preference',
      kind: 'preferred_window', constraintLevel: 'soft', dateExpression: '2026-10-12',
      startTime: explicitClock ? '22:45' : null, endTime: explicitClock ? '23:45' : null,
      source: source('late-date-preference') });
    value.factLifecycles.push(active('late-date-preference'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe(explicitClock ? 'ready' : 'insufficient_capacity');
    if (explicitClock) expect(scheduled.candidates[0]).toMatchObject({ date: '2026-10-12', startTime: '22:45', endTime: '23:45' });
    else {
      expect(scheduled.candidates).toEqual([]);
      expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
    }
  });

  it('does not reinterpret contradictory independent clocks as overnight availability', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '22:00' });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'hard-upper', kind: 'latest_end',
      startTime: null, endTime: '01:00', source: source('hard-upper') });
    value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'late-preference', kind: 'preferred_window',
      constraintLevel: 'soft', startTime: '22:00', endTime: '23:00', source: source('late-preference') });
    value.factLifecycles.push(active('hard-upper'), active('late-preference'));
    const { input, scheduled } = placeHardClockScope(value);
    expect(scheduled.status).toBe('insufficient_capacity');
    expect(scheduled.candidates).toEqual([]);
    expect(scheduled.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it('applies clocks to each existing daily occurrence without changing its quantity', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00', daily: true });
    value.workloads[0].perOccurrence = true;
    value.workloads[0].periodExpression = 'daily';
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.movableWorkItems).toHaveLength(2);
    expect(input.movableWorkItems.map(item => item.quantity.amount)).toEqual([1, 1]);
    expect(scheduled.candidates.map(candidate => ({ date: candidate.date, start: candidate.startTime, minutes: candidate.durationMinutes })))
      .toEqual(['2026-10-12', '2026-10-13'].map(date => ({ date, start: '20:00', minutes: 60 })));
  });

  // Residual product gaps, deliberately outside C2. These record unchanged behavior, not safe support.
  // A future semantic/capability decision must replace these observations before claiming all hard clocks are honored.
  it.each([
    { name: 'date-free deadline', kind: 'deadline', date: null, start: null, end: '13:00', named: null,
      expectedDate: '2026-10-12', expectedTime: '20:00' },
    { name: 'dated named period', kind: 'earliest_start', date: '2026-10-13', start: null, end: null, named: 'night',
      expectedDate: '2026-10-13', expectedTime: '09:00' },
    { name: 'dated opposite extra endpoint', kind: 'earliest_start', date: '2026-10-13', start: '20:00', end: '22:00', named: null,
      expectedDate: '2026-10-13', expectedTime: '09:00' },
  ] as const)('records the pre-existing unsupported $name without adding a new interpretation', ({ kind, date, start, end, named, expectedDate, expectedTime }) => {
    const value = hardClockScopeGraph({ kind, dateExpression: date, time: '20:00' });
    Object.assign(value.temporalConstraints[0], { startTime: start, endTime: end, namedTimePeriod: named });
    const errors: string[] = [];
    validateWeeklyPlanningTemporalValuesV5({ ...value.temporalConstraints[0] }, 'constraint', errors);
    expect(errors).toEqual([]); // Accepted representation is not equivalent to scheduler support.
    if (kind === 'deadline') {
      value.temporalConstraints.push({ ...value.temporalConstraints[0], id: 'late-preference', kind: 'preferred_window',
        constraintLevel: 'soft', startTime: '20:00', endTime: '22:00', source: source('late-preference') });
      value.factLifecycles.push(active('late-preference'));
    }
    const { input, scheduled } = placeHardClockScope(value);
    expect(input.hardClockBounds).toEqual([]);
    expect(input.hardDateBounds).toEqual(date ? [expect.objectContaining({ startDate: date })] : []);
    expect(scheduled.candidates).toHaveLength(1);
    expect(scheduled.candidates[0]).toMatchObject({ date: expectedDate, startTime: expectedTime });
  });

  it('does not silently omit a clock whose hard/soft meaning is still unknown', () => {
    const value = hardClockScopeGraph({ kind: 'earliest_start', dateExpression: null, time: '20:00' });
    value.temporalConstraints[0].constraintLevel = 'unknown';
    const compilation = compileTemporalScope(value);
    expect(compilation.status).toBe('needs_resolution');
    expect(compilation.input).toBeNull();
    expect(compilation.issues).toContainEqual(expect.objectContaining({
      domain: 'temporal_constraint', factId: 'hard-clock-1', code: 'unknown_constraint_level', blocking: true,
    }));
  });
});
