import fc from 'fast-check';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGraphCheckpointAssertions } from '../testUtils/__tests__/weeklyPlanningGraphCheckpointAssertions';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { validateWeeklyPlanningStableV5SessionSnapshot, WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../application/weeklyPlanningStableV5SessionCodec';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { findCyclicComponentAncestryV5 } from './weeklyPlanningComponentHierarchyV5';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';

const scope = { ownerId: 'hierarchy-owner', weekStartDate: '2026-08-24', conversationId: 'hierarchy-conversation' };
function document(parents: Array<number | null> = [null, 0, null]): WeeklyPlanningSemanticDocumentV5 {
  const task = (localId: string, label: string, links: Array<number | null>) => ({
    localId, category: 'study' as const, title: label,
    study: { purpose: 'self_study' as const, contextLabel: null, components: links.map((parent, index) => ({
      localId: `${localId}-${index}`, parentLocalId: parent === null ? null : `${localId}-${parent}`,
      role: 'subject' as const, label: `${label}${index}`, workloads: [], sourceText: label,
    })) },
    workloads: [], effortEstimates: [], recurrence: [], temporalConstraints: [], sourceText: label,
  });
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [task('math', '数学', parents), task('english', '英語', [null])], availabilityDeclarations: [],
    relations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}
function canonical(input: WeeklyPlanningSemanticDocumentV5) {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(), document: input,
    context: { conversationId: scope.conversationId, turnId: 'hierarchy-turn', expectedRevision: 0 },
  });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}
let checkpoint: ReturnType<typeof createGraphCheckpointAssertions>;
beforeEach(() => { checkpoint = createGraphCheckpointAssertions(scope); });
afterEach(() => checkpoint.restore());

it('rejects malformed component ancestry at every graph and checkpoint entry point', () => {
  for (const [child, parent] of [[0, 'math-0'], [0, 'math-1'], [1, 'english-0'], [1, 'missing']] as const) {
    for (const historical of ['active', 'removed', 'superseded'] as const) {
      const input = document();
      const graph = canonical(input);
      if (historical !== 'active') {
        graph.revision = 2;
        for (const entry of graph.factLifecycles) if (graph.components.slice(0, 2).some(component => component.id === entry.factId)) {
          entry.status = historical; entry.terminalRevision = 2;
          entry.supersededByFactId = historical === 'superseded' ? graph.components[2].id : null;
        }
      }
      checkpoint.roundTrip(graph);
      input.tasks[0].study!.components[child].parentLocalId = parent;
      expect(validateWeeklyPlanningSemanticValueV5(input).document).toBeNull();
      const ids = new Map(graph.components.map(component => [component.source.semanticLocalId, component.id]));
      graph.components[child].parentComponentId = ids.get(parent) ?? parent;
      checkpoint.reject(graph);
      expect(validateWeeklyPlanningStableV5SessionSnapshot({
        version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION, ...scope, graph,
        planningState: createInitialPlanningState(scope.weekStartDate), savedAt: '2026-10-04T00:00:00Z',
      }, scope.ownerId)).toBeNull();
    }
  }
});

it('matches per-start ancestry traversal for arbitrary finite parent maps without mutating them', () => {
  expect(validateWeeklyPlanningSemanticValueV5(document([1, 2, 1, 24])).errors).toEqual([
    'document.tasks[0].study.components.parent-ref:math-3:math-24',
    'document.tasks[0].study.components.parent-cycle:math-0',
    'document.tasks[0].study.components.parent-cycle:math-1',
    'document.tasks[0].study.components.parent-cycle:math-2',
  ]);
  fc.assert(fc.property(fc.array(fc.integer({ min: -1, max: 24 }), { maxLength: 24 }), fc.boolean(), (parents, reverse) => {
    const entries = parents.map((parent, index) => [`c${index}`, parent < 0 ? null : `c${parent}`] as const);
    if (reverse) entries.reverse();
    const graph = new Map<string, string | null>(entries);
    const expected = new Set<string>();
    for (const start of graph.keys()) {
      const visited = new Set<string>();
      let current: string | null | undefined = start;
      while (current) {
        if (visited.has(current)) { expected.add(start); break; }
        visited.add(current);
        current = graph.get(current);
      }
    }
    expect([...findCyclicComponentAncestryV5(graph)]).toEqual([...expected]);
    expect([...graph]).toEqual(entries);
  }), { numRuns: 100, examples: [[[0], false], [[1, 0, 0], true], [[-1, 24], false], [[], false]] });

  // Deep valid ancestry must not recurse or re-traverse every suffix.
  let reads = 0;
  class CountingParents extends Map<string, string | null> {
    override get(id: string) { reads += 1; return super.get(id); }
  }
  const chain = new CountingParents(Array.from({ length: 10_000 }, (_, index) => [
    String(index), index === 9_999 ? null : String(index + 1),
  ]));
  expect([...findCyclicComponentAncestryV5(chain)]).toEqual([]);
  expect(reads).toBeLessThanOrEqual(chain.size);
});

it('preserves same-task forests, forward references and real supersession/removal history', () => {
  fc.assert(fc.property(fc.array(fc.nat(), { minLength: 3, maxLength: 24 }), fc.boolean(), (choices, reverse) => {
    const parents = choices.map((choice, index) => index === 0 || choice % 3 === 0 ? null : choice % index);
    const input = document(parents);
    if (reverse) input.tasks[0].study!.components.reverse();
    const graph = canonical(input);
    checkpoint.roundTrip(graph);
  }), { numRuns: 24, examples: [[[0, 1, 1], false], [[0, 1, 1], true]] });

  let graph = canonical(document([null, 0, 0]));
  const [parent, oldChild, newChild] = graph.components;
  const operations = [
    { operationKey: 'replace-child', kind: 'supersede' as const, targetFactId: oldChild.id, replacementFactId: newChild.id },
    { operationKey: 'remove-child', kind: 'remove' as const, targetFactId: newChild.id },
    { operationKey: 'remove-parent', kind: 'remove' as const, targetFactId: parent.id },
  ];
  for (const operation of operations) {
    const result = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision, operation });
    expect(result.status).toBe('applied');
    graph = result.graph;
    checkpoint.roundTrip(graph);
    expect(checkpoint.load()!.graph.components).toEqual(graph.components);
  }
});
