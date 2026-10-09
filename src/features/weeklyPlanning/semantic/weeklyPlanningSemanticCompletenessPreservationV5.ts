import type { SemanticStudyComponentV5, SemanticTaskV5, WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { normalizeWeeklyPlanningEvidenceTextV5 } from './weeklyPlanningCurrentTurnProvenanceV5';

/**
 * The turn kept its first valid reading although completion signalled a possible omission it
 * could not take in or verify (interaction). The application discloses it; it never says what.
 */
export interface WeeklyPlanningSemanticCompletenessAbstentionV5 {
  reason: 'initial_facts_not_preserved' | 'repair_budget_consumed'
    | 'provider_failure' | 'malformed_audit_response' | 'dispatch_budget_exhausted'
    | 'omission_not_taken_in'
    /** x9b: a focused-recovery document left a typed uncovered span in the user's text after the audit. */
    | 'recovered_text_not_covered';
  /** Unset for a refused or unrepairable re-read; set when the audit or re-read could not run. */
  step?: 'audit' | 'retry';
}

type FactCounts = Map<string, number>;
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
function workloadValue(workload: Record<string, unknown>): Record<string, unknown> {
  return {
    quantityRole: workload.quantityRole, amount: workload.amount, unitCode: workload.unitCode,
    ...(workload.unitCode === 'custom' ? { unitLabel: workload.unitLabel } : {}),
    rangeStart: workload.rangeStart, rangeEnd: workload.rangeEnd, perOccurrence: workload.perOccurrence,
    // A non-recurring workload's wording does not set a calendar scope.
    ...(workload.perOccurrence ? { periodExpression: workload.periodExpression } : {}),
  };
}
function componentValue(task: SemanticTaskV5, component: SemanticStudyComponentV5, seen = new Set<string>()): Record<string, unknown> {
  const value = { role: component.role, label: normalizeWeeklyPlanningEvidenceTextV5(component.label) };
  if (!component.parentLocalId) return value;
  if (seen.has(component.localId)) return { ...value, parent: { kind: 'unresolved' } };
  seen.add(component.localId);
  const parent = task.study?.components.find(candidate => candidate.localId === component.parentLocalId);
  return { ...value, parent: parent ? componentValue(task, parent, seen) : { kind: 'unresolved' } };
}
function typedTargetValue(task: SemanticTaskV5, targetLocalId: string): Record<string, unknown> {
  // Owner identity is checked by per-task containment and the public-id/source-span
  // match below. Resolve wire references here, then compare only typed meaning.
  if (targetLocalId === task.localId) return { kind: 'task', category: task.category };
  const components = task.study?.components ?? [];
  const component = components.find(candidate => candidate.localId === targetLocalId);
  if (component) return { kind: 'component', ...componentValue(task, component) };
  const workload = [...task.workloads, ...components.flatMap(candidate => candidate.workloads)]
    .find(candidate => candidate.localId === targetLocalId);
  if (workload) {
    const container = components.find(candidate => candidate.workloads.some(value => value.localId === targetLocalId));
    // With one component the retained identity stays unambiguous when a quantity
    // moves to the task array. An aggregate quantity with multiple components
    // cannot silently choose a material owner.
    const materials = components.filter(candidate => candidate.role === 'material');
    const owner = container ?? (materials.length === 1 ? materials[0] : null);
    return { kind: 'workload', component: owner ? componentValue(task, owner) : null,
      value: workloadValue({ ...workload }) };
  }
  // Normal validation owns reference validity; unknown wire ids never become
  // comparison keys or a guessed semantic target in this retention boundary.
  return { kind: 'unresolved' };
}
function facts(tasks: readonly SemanticTaskV5[]): FactCounts {
  const counts: FactCounts = new Map();
  const add = (kind: string, value: unknown) => { const key = `${kind}:${stable(value)}`; counts.set(key, (counts.get(key) ?? 0) + 1); };
  for (const task of tasks) {
    add('task', { category: task.category });
    for (const component of task.study?.components ?? []) add('component', {
      role: component.role, label: normalizeWeeklyPlanningEvidenceTextV5(component.label),
    });
    for (const component of task.study?.components ?? []) if (component.parentLocalId) add('component_parent', {
      child: { role: component.role, label: normalizeWeeklyPlanningEvidenceTextV5(component.label) },
      parent: typedTargetValue(task, component.parentLocalId),
    });
    for (const workload of [...task.workloads, ...(task.study?.components ?? []).flatMap(component => component.workloads)]) {
      add('workload', typedTargetValue(task, workload.localId));
    }
    for (const estimate of task.effortEstimates) {
      const { localId: _id, targetLocalId, sourceText: _source, unitCode, ...value } = estimate;
      // Unit labels on total/session durations do not change their minute value.
      add('effort', { ...value, unitCode: estimate.kind === 'duration_per_unit' ? unitCode : null,
        target: typedTargetValue(task, targetLocalId) });
    }
    for (const constraint of task.temporalConstraints) {
      const { localId: _id, targetLocalId, sourceText: _source, ...value } = constraint;
      add('temporal', { ...value, target: typedTargetValue(task, targetLocalId) });
    }
    for (const recurrence of task.recurrence) {
      const { localId: _id, targetLocalId, sourceText: _source, ...value } = recurrence;
      add('recurrence', { ...value, days: [...value.days].sort(), target: typedTargetValue(task, targetLocalId) });
    }
  }
  return counts;
}
function contains(after: FactCounts, before: FactCounts): boolean {
  return [...before].every(([key, count]) => (after.get(key) ?? 0) >= count);
}
function globalFacts(document: WeeklyPlanningSemanticDocumentV5): FactCounts {
  const result: FactCounts = new Map();
  const add = (kind: string, fact: Record<string, unknown>) => {
    const { localId: _id, sourceText: _source, ...value } = fact;
    const key = `${kind}:${stable(value)}`;
    result.set(key, (result.get(key) ?? 0) + 1);
  };
  if (document.planningWindow) add('planning_window', { ...document.planningWindow });
  for (const [kind, values] of [
    ['availability', document.availabilityDeclarations],
    ['constraint_source', document.constraintSourceRequests],
    ['user_context', document.userContextFacts ?? []],
  ] as const) for (const value of values) add(kind, { ...value });
  return result;
}
function referenceKeys(document: WeeklyPlanningSemanticDocumentV5, owners: ReadonlyMap<SemanticTaskV5, string>): Map<string, unknown> {
  const refs = new Map<string, unknown>();
  for (const task of document.tasks) {
    const owner = owners.get(task) ?? `added:${task.localId}`;
    refs.set(task.localId, { kind: 'task', owner });
    for (const component of task.study?.components ?? []) refs.set(component.localId, {
      kind: 'component', owner, publicId: component.existingPublicId ?? null, ...componentValue(task, component),
    });
    for (const workload of [...task.workloads, ...(task.study?.components ?? []).flatMap(component => component.workloads)]) {
      refs.set(workload.localId, { ...typedTargetValue(task, workload.localId), owner });
    }
    for (const [kind, values] of [['effort_estimate', task.effortEstimates], ['temporal_constraint', task.temporalConstraints], ['recurrence', task.recurrence]] as const) {
      for (const fact of values) {
        const { localId: _id, sourceText: _source, targetLocalId, ...value } = fact;
        const meaning = kind === 'effort_estimate'
          ? { ...value, unitCode: (fact as SemanticTaskV5['effortEstimates'][number]).kind === 'duration_per_unit'
            ? (fact as SemanticTaskV5['effortEstimates'][number]).unitCode : null }
          : kind === 'recurrence' ? { ...value, days: [...(fact as SemanticTaskV5['recurrence'][number]).days].sort() } : value;
        refs.set(fact.localId, { kind, owner, target: refs.get(targetLocalId) ?? { unresolvedTarget: targetLocalId }, value: meaning });
      }
    }
  }
  if (document.planningWindow) {
    const { localId: _id, sourceText: _source, ...value } = document.planningWindow;
    refs.set(document.planningWindow.localId, { kind: 'planning_window', value });
  }
  return refs;
}
function controlFacts(document: WeeklyPlanningSemanticDocumentV5, refs: ReadonlyMap<string, unknown>): FactCounts {
  const result: FactCounts = new Map();
  const add = (kind: string, value: unknown) => { const key = `${kind}:${stable(value)}`; result.set(key, (result.get(key) ?? 0) + 1); };
  const target = (value: { kind: string; publicId: string | null; localId: string | null; mention: string | null }) => ({
    kind: value.kind, publicId: value.publicId,
    local: value.localId ? refs.get(value.localId) ?? { unresolvedLocal: value.localId } : null,
    ...(value.publicId || value.localId ? {} : { mention: value.mention }),
  });
  for (const uncertainty of document.uncertainties) add('uncertainty', { field: uncertainty.field,
    target: uncertainty.targetLocalId === 'document' ? { kind: 'document' } : refs.get(uncertainty.targetLocalId) ?? { unresolvedTarget: uncertainty.targetLocalId } });
  for (const correction of document.corrections) add('correction', { operation: correction.operation, target: target(correction.target),
    replacement: correction.replacementLocalId ? refs.get(correction.replacementLocalId) ?? { unresolvedReplacement: correction.replacementLocalId } : null });
  for (const decision of document.decisions) add('decision', { target: target(decision.target), value: decision.decision });
  for (const relation of document.relations) add('relation', { kind: relation.kind,
    from: refs.get(relation.fromLocalId) ?? { unresolvedLocal: relation.fromLocalId },
    to: refs.get(relation.toLocalId) ?? { unresolvedLocal: relation.toLocalId } });
  return result;
}
function spans(text: string, source: string): Array<{ start: number; end: number }> {
  if (!source) return [];
  const result = [];
  for (let start = text.indexOf(source); start >= 0; start = text.indexOf(source, start + 1)) result.push({ start, end: start + source.length });
  return result;
}
function overlaps(text: string, before: string, after: string): boolean {
  return spans(text, before).some(left => spans(text, after).some(right => left.start < right.end && right.start < left.end));
}

/**
 * A valid completeness retry adds meaning; it cannot erase the valid initial floor.
 * Typed multiset counts ignore wire ids, quotes and workload containers. Literal
 * source spans disambiguate new task owners only after typed containment succeeds.
 * This comparison never interprets words, mutates a document or merges authors.
 * Purpose, activityKind and decompositionStatus remain outside the retention floor:
 * a complete reading may refine them without changing these retained typed facts.
 */
export function validateWeeklyPlanningSemanticCompletenessPreservationV5(params: {
  userText: string;
  initialDocument: WeeklyPlanningSemanticDocumentV5;
  retryDocument: WeeklyPlanningSemanticDocumentV5;
}): string[] {
  if (!contains(globalFacts(params.retryDocument), globalFacts(params.initialDocument))) return ['completeness-preservation:global_facts_lost'];
  const before = params.initialDocument.tasks;
  const after = params.retryDocument.tasks;
  if (after.length < before.length) return ['completeness-preservation:task_count_decreased'];
  if (!contains(facts(after), facts(before))) return ['completeness-preservation:typed_facts_lost'];

  // Public ids identify accepted owners. Equal values on another owner are not retention.
  const bound = new Set(before.map(task => task.existingPublicId).filter((id): id is string => Boolean(id)));
  for (const id of bound) {
    const original = before.filter(task => task.existingPublicId === id);
    const retries = after.filter(task => task.existingPublicId === id);
    if (retries.length < original.length || !contains(facts(retries), facts(original))) return ['completeness-preservation:bound_task_facts_lost'];
  }

  const beforeOwners = new Map<SemanticTaskV5, string>();
  const afterOwners = new Map<SemanticTaskV5, string>();
  for (const task of before) if (task.existingPublicId) beforeOwners.set(task, `public:${task.existingPublicId}`);
  for (const task of after) if (task.existingPublicId) afterOwners.set(task, `public:${task.existingPublicId}`);
  const unbound = before.filter(task => !task.existingPublicId);
  const candidates = after.filter(task => !task.existingPublicId);
  const used = new Set<number>();
  for (const task of unbound) {
    const matches = candidates.map((retry, index) => ({ retry, index })).filter(({ retry, index }) =>
      !used.has(index) && contains(facts([retry]), facts([task])) && overlaps(params.userText, task.sourceText, retry.sourceText));
    if (matches.length !== 1) return ['completeness-preservation:unbound_task_match_unresolved'];
    used.add(matches[0].index);
    const owner = `matched:${before.indexOf(task)}`;
    beforeOwners.set(task, owner);
    afterOwners.set(matches[0].retry, owner);
  }
  if (!contains(controlFacts(params.retryDocument, referenceKeys(params.retryDocument, afterOwners)),
    controlFacts(params.initialDocument, referenceKeys(params.initialDocument, beforeOwners)))) return ['completeness-preservation:control_facts_lost'];
  return [];
}
