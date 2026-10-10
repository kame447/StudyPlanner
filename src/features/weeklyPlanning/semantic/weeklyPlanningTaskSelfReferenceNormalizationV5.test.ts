import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import { createWeeklyPlanningSemanticPublicStateSummaryV5 } from './weeklyPlanningSemanticPublicStateV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './weeklyPlanningSemanticResponseValidationV5';

type Json = Record<string, unknown>;
const KINDS = ['temporalConstraints', 'effortEstimates', 'recurrence'] as const;
type Kind = typeof KINDS[number];
const TEXT = '資料は明日の13時まで、1回60分、週2回です。';
const PREFIX = 'task-self-reference-projected:';
const schedulerContext = {
  ownerId: 'self-reference-owner', currentDate: '2026-10-10',
  planningStartDate: '2026-10-11', planningEndDate: '2026-10-17', timeZone: 'Asia/Tokyo',
};

function document(tasks: Json[]): Json {
  return {
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'update_plan',
    planningWindow: null, tasks, relations: [], availabilityDeclarations: [],
    constraintSourceRequests: [], userContextFacts: [], uncertainties: [],
    corrections: [], decisions: [],
  };
}
function study(components: Json[] = []): Json {
  return { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components };
}
function component(localId: string, workloads: Json[] = []): Json {
  return { localId, existingPublicId: null, parentLocalId: null, role: 'topic', label: '資料',
    workloads, durableContextSignals: [], sourceText: TEXT };
}
function task(localId: string, title: string, extra: Json = {}): Json {
  return {
    localId, existingPublicId: null, category: 'study', decompositionStatus: 'atomic', title,
    study: study(),
    workloads: [], effortEstimates: [], temporalConstraints: [], recurrence: [],
    durableContextSignals: [], sourceText: TEXT, ...extra,
  };
}
function nested(kind: Kind, targetLocalId: string): Json {
  const base = { localId: 'new-fact', targetLocalId, sourceText: TEXT };
  if (kind === 'temporalConstraints') return {
    ...base, kind: 'deadline', constraintLevel: 'hard', dateExpression: 'tomorrow',
    namedTimePeriod: null, startTime: '13:00', endTime: null, precision: 'exact',
  };
  if (kind === 'effortEstimates') return {
    ...base, kind: 'session_duration', minutes: 60, unitCode: 'session', precision: 'exact',
  };
  return { ...base, kind: 'times_per_week', count: 2, days: [] };
}
function fixture(conversationId = 'task-self-reference', withComponent = false) {
  const accepted = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(),
    document: document([
      task('setup-a', '資料', withComponent ? { study: study([component('setup-component')]) } : {}),
      task('setup-b', '調整'),
    ]) as unknown as WeeklyPlanningSemanticDocumentV5,
    context: { conversationId, turnId: 'setup', expectedRevision: 0 },
  });
  if (accepted.status !== 'applied') throw new Error(`fixture rejected: ${accepted.errors.join(',')}`);
  const graph = accepted.graph;
  const own = graph.tasks.find(item => item.title === '資料')!;
  const other = graph.tasks.find(item => item.title === '調整')!;
  const shell = (kind: Kind, target: string, extra: Json = {}) => task('shell', own.title, {
    existingPublicId: own.id, [kind]: [nested(kind, target)], ...extra,
  });
  const validate = (value: Json, committedGraph = graph) => validateWeeklyPlanningSemanticResponseV5(
    JSON.stringify(value), {
      currentUserText: TEXT, committedGraph,
      publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, committedGraph),
    },
  );
  return { graph, own, other, shell, validate };
}

function collisionBeforeDuplicateCleanup() {
  const f = fixture();
  const workload = (localId: string): Json => ({
    localId, quantityRole: 'target', amount: 60, unitCode: 'minute', unitLabel: '分',
    rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: TEXT,
  });
  const value = document([f.shell('temporalConstraints', f.own.id, {
    workloads: [workload(f.own.id)],
    study: study([component('new-component', [workload('nested-workload')])]),
  })]);
  return { ...f, value, rawResponse: JSON.stringify(value) };
}

// These are intended-contract tests. Run unchanged on exact main first; record
// actual failures rather than treating the static red prediction as evidence.
describe('own-task public reference representation boundary', () => {
  it.each(KINDS)('keeps the valid %s local-ID control unchanged', kind => {
    const f = fixture();
    const result = f.validate(document([f.shell(kind, 'shell')]));
    expect(result.errors).toEqual([]);
    expect(result.document?.tasks[0][kind][0].targetLocalId).toBe('shell');
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it.each(KINDS)('accepts an own-task %s public ID as the same local-ID document', kind => {
    const f = fixture();
    const before = structuredClone(f.graph);
    const local = f.validate(document([f.shell(kind, 'shell')]));
    const projected = f.validate(document([f.shell(kind, f.own.id)]));
    expect(local.errors).toEqual([]);
    expect(projected.errors).toEqual([]);
    expect(projected.document).toEqual(local.document);
    expect(projected.algorithmicRepairs).toContain(
      `${PREFIX}${JSON.stringify(['shell', f.own.id, kind, 'new-fact'])}`,
    );
    expect(f.graph).toEqual(before);
    const repeated = f.validate(projected.document as unknown as Json);
    expect(repeated.document).toEqual(local.document);
    expect(repeated.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it.each(KINDS)('does not reinterpret another accepted task target in %s', kind => {
    const f = fixture();
    const result = f.validate(document([
      f.shell(kind, f.other.id),
      task('other-shell', f.other.title, { existingPublicId: f.other.id }),
    ]));
    expect(result.document).toBeNull();
    expect(result.errors).toContain(`document.tasks[0].${kind}[0].targetLocalId`);
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it.each(['removed', 'superseded'] as const)('does not normalize a %s containing task', status => {
    const f = fixture();
    f.graph.factLifecycles.find(item => item.factId === f.own.id)!.status = status;
    const result = f.validate(document([f.shell('temporalConstraints', f.own.id)]));
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].temporalConstraints[0].targetLocalId');
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('does not trust an unknown public ID or a task from a different graph', () => {
    const f = fixture();
    const foreign = fixture('foreign-conversation');
    for (const publicId of ['unknown-public-task', foreign.own.id]) {
      expect(publicId).not.toBe(f.own.id);
      const result = f.validate(document([f.shell('effortEstimates', publicId, { existingPublicId: publicId })]));
      expect(result.document).toBeNull();
      expect(result.errors).toContain('document.tasks[0].effortEstimates[0].targetLocalId');
      expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
    }
  });

  it('preserves a declared local-ID collision even on another entry', () => {
    const f = fixture();
    const value = document([
      f.shell('temporalConstraints', f.own.id),
      task(f.own.id, f.other.title, { existingPublicId: f.other.id }),
    ]);
    const result = f.validate(value);
    expect(result.document).toBeNull();
    expect(result.errors).toContain('document.tasks[0].temporalConstraints[0].targetLocalId');
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('leaves a valid component-local collision bound to that component', () => {
    const f = fixture();
    const value = document([f.shell('temporalConstraints', f.own.id, {
      study: { purpose: 'self_study', activityKind: 'reading', contextLabel: null, components: [{
        localId: f.own.id, existingPublicId: null, parentLocalId: null, role: 'topic', label: '資料',
        workloads: [], durableContextSignals: [], sourceText: TEXT,
      }] },
    })]);
    const result = f.validate(value);
    expect(result.errors).toEqual([]);
    expect(result.document?.tasks[0].temporalConstraints[0].targetLocalId).toBe(f.own.id);
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('does not use a public summary alone as active graph authority', () => {
    const f = fixture();
    const result = validateWeeklyPlanningSemanticResponseV5(
      JSON.stringify(document([f.shell('temporalConstraints', f.own.id)])), {
        currentUserText: TEXT,
        publicStateSummary: createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, f.graph),
      },
    );
    expect(result.document).toBeNull();
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('continues to reject unrelated invalid values and malformed provider JSON', () => {
    const f = fixture();
    const value = document([f.shell('effortEstimates', f.own.id, {
      effortEstimates: [{ ...nested('effortEstimates', f.own.id), minutes: -1 }],
    })]);
    const result = f.validate(value);
    expect(result.document).toBeNull();
    expect(result.errors.some(error => error.includes('minutes'))).toBe(true);
    const malformed = validateWeeklyPlanningSemanticResponseV5('{broken', { committedGraph: f.graph });
    expect(malformed.document).toBeNull();
    expect(malformed.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('rejects the original local collision even when later duplicate cleanup removes its declaration', () => {
    const f = collisionBeforeDuplicateCleanup();
    const before = structuredClone(f.graph);
    const result = f.validate(f.value);
    expect(result.document).toBeNull();
    expect(result.parsedDocument).toBeNull();
    expect(result.errors).toContain('document.tasks[0].temporalConstraints[0].targetLocalId');
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
    expect(result.algorithmicRepairs).toContain(`duplicate-workload-removed-from-task:shell:${f.own.id}`);
    expect(f.graph).toEqual(before);
  });

  it('rejects the same raw collision on both real normalizer attempts without internally replaying normalized raw', async () => {
    const f = collisionBeforeDuplicateCleanup();
    const before = structuredClone(f.graph);
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() { calls += 1; return f.rawResponse; },
    };
    const result = await createWeeklyPlanningSemanticPipelineV5(
      createWeeklyPlanningSemanticNormalizerV5(client),
    ).run({ graph: f.graph, conversationId: 'task-self-reference', turnId: 'collision-repair',
      expectedRevision: f.graph.revision, userText: TEXT, schedulerContext });
    expect(calls).toBe(2);
    expect(result.status).toBe('normalization_rejected');
    expect(result.normalization.document).toBeNull();
    expect(result.normalization.diagnostics.repairAttempted).toBe(true);
    expect(result.normalization.diagnostics.algorithmicRepairs?.filter(item => item.startsWith(PREFIX))).toEqual([]);
    expect(result.normalization.diagnostics.validationErrors).toContain(
      'repair:document.tasks[0].temporalConstraints[0].targetLocalId',
    );
    expect(result.graph).toEqual(before);
    expect(f.graph).toEqual(before);
  });

  it('does not rerun self projection after a later pending-component stage restores an unknown task ID', () => {
    const f = fixture('task-self-reference', true);
    const acceptedComponent = f.graph.components[0];
    const value = document([f.shell('temporalConstraints', f.own.id, {
      existingPublicId: 'unknown-task-public',
      study: study([{ ...component('bound-component'), existingPublicId: acceptedComponent.id }]),
    })]);
    const result = validateWeeklyPlanningSemanticResponseV5(JSON.stringify(value), {
      currentUserText: TEXT, committedGraph: f.graph,
      publicStateSummary: {
        ...createWeeklyPlanningSemanticPublicStateSummaryV5(undefined, f.graph),
        pendingQuestion: { questionCode: 'missing_schedulable_work', targetFactId: acceptedComponent.id },
      },
    });
    expect(result.document).toBeNull();
    expect(result.parsedDocument).toBeNull();
    expect(result.errors).toContain('document.tasks[0].temporalConstraints[0].targetLocalId');
    expect(result.algorithmicRepairs).toContain('pending-component-parent-task-id-restored:shell');
    expect(result.algorithmicRepairs.filter(item => item.startsWith(PREFIX))).toEqual([]);
  });

  it('keeps rejected-attempt diagnostics from rebinding a repaired document', async () => {
    const f = fixture();
    const before = structuredClone(f.graph);
    const responses = [
      document([f.shell('effortEstimates', f.own.id, {
        effortEstimates: [{ ...nested('effortEstimates', f.own.id), minutes: -1 }],
      })]),
      document([task('repaired-shell', f.other.title, {
        existingPublicId: f.other.id,
        effortEstimates: [nested('effortEstimates', 'repaired-shell')],
      })]),
    ];
    let calls = 0;
    const client: OpenAiCompatibleClient = {
      async createChatCompletion() {
        calls += 1;
        const next = responses.shift();
        if (!next) throw new Error('unexpected additional AI call');
        return JSON.stringify(next);
      },
    };
    const result = await createWeeklyPlanningSemanticPipelineV5(
      createWeeklyPlanningSemanticNormalizerV5(client),
    ).run({ graph: f.graph, conversationId: 'task-self-reference', turnId: 'repaired-owner',
      expectedRevision: f.graph.revision, userText: TEXT, schedulerContext });
    expect(calls).toBe(2);
    expect(result.normalization.diagnostics.repairAttempted).toBe(true);
    expect(result.canonicalization?.status).toBe('applied');
    expect(result.graph.effortEstimates).toHaveLength(1);
    expect(result.graph.effortEstimates[0].targetFactId).toBe(f.other.id);
    expect(result.graph.effortEstimates[0].taskId).toBe(f.other.id);
    expect(f.graph).toEqual(before);
  });

  it.each(KINDS)('uses one provider call and binds %s to the same canonical task as the local control', async kind => {
    const f = fixture();
    const before = structuredClone(f.graph);
    const run = async (target: string) => {
      let calls = 0;
      const rawResponse = JSON.stringify(document([f.shell(kind, target)]));
      const client: OpenAiCompatibleClient = {
        async createChatCompletion() { calls += 1; return rawResponse; },
      };
      const result = await createWeeklyPlanningSemanticPipelineV5(
        createWeeklyPlanningSemanticNormalizerV5(client),
      ).run({ graph: f.graph, conversationId: 'task-self-reference', turnId: `followup-${kind}`,
        expectedRevision: f.graph.revision, userText: TEXT, schedulerContext });
      return { result, calls };
    };
    const local = await run('shell');
    const projected = await run(f.own.id);
    expect(local.result.canonicalization?.status).toBe('applied');
    expect(projected.result.canonicalization?.status).toBe('applied');
    expect(projected.calls).toBe(1);
    expect(projected.result.normalization.diagnostics.repairAttempted).toBe(false);
    expect(projected.result.graph).toEqual(local.result.graph);
    const facts = kind === 'recurrence' ? projected.result.graph.recurrences : projected.result.graph[kind];
    expect(facts).toHaveLength(1);
    expect(facts[0].targetFactId).toBe(f.own.id);
    expect(projected.result.graph.tasks).toEqual(f.graph.tasks);
    expect(f.graph).toEqual(before);
  });
});
