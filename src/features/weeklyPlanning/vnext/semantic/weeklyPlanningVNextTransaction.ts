import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactDiffV5,
  type WeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactKindV5,
} from '../weeklyPlanningVNextV5Boundary';
import { validateWeeklyPlanningFactGraphValueV5 } from '../../semantic/weeklyPlanningFactGraphValidatorV5';
import {
  WEEKLY_PLANNING_VNEXT_STATE_VERSION,
  type VNextAddFact,
  type VNextEffortWorkBinding,
  type VNextFactRef,
  type VNextTurnContext,
  type VNextTurnDelta,
  type VNextTurnError,
  type VNextTurnResult,
  type WeeklyPlanningVNextGraph,
  type WeeklyPlanningVNextState,
  type VNextWorkRef,
} from '../weeklyPlanningVNextTypes';
import {
  computeVNextWorkUnits,
  createVNextLineageResolver,
  isValidVNextQuantityBasis,
  resolveVNextEffortBinding,
  vnextUnitIdentity,
  vnextLineageIdByFactId,
} from '../weeklyPlanningVNextWorkIdentity';
import { fixVNextDateExpression, vnextTemporalBoundRepairFields } from '../weeklyPlanningVNextTemporalBound';
import { isValidCalendarDate, resolveCanonicalDateExpression } from '../../semantic/weeklyPlanningCalendarResolver';
import { SEMANTIC_STUDY_ACTIVITY_KINDS_V5 } from '../../semantic/weeklyPlanningSemanticTypesV5';
import { vnextQuestionKeyAllowsProvisionalTimebox } from '../projection/weeklyPlanningVNextProjection';

const collections = {
  planning_window: 'planningWindows', task: 'tasks', study_context: 'studyContexts',
  component: 'components', workload: 'workloads', effort_estimate: 'effortEstimates',
  temporal_constraint: 'temporalConstraints', task_date_rule: 'taskDateRules',
  recurrence: 'recurrences', relation: 'relations', uncertainty: 'uncertainties',
  availability_declaration: 'availabilityDeclarations', constraint_source_request: 'constraintSourceRequests',
  correction_intent: 'correctionIntents', decision_intent: 'decisionIntents',
} as const satisfies Record<WeeklyPlanningFactKindV5, keyof WeeklyPlanningVNextGraph>;

/** Closed field sets: identities and ownership are never writable through a patch. */
export const VNEXT_PATCH_FIELDS = {
  task: ['category', 'title'], component: ['role', 'label'],
  study_context: ['purpose', 'contextLabel', 'activityKind'],
  workload: ['quantityRole', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression'],
  effort_estimate: ['effortKind', 'minutes', 'unitCode', 'unitLabel', 'precision'],
  temporal_constraint: ['constraintKind', 'constraintLevel', 'dateExpression', 'namedTimePeriod', 'startTime', 'endTime', 'precision'],
  planning_window: ['windowKind', 'value', 'start', 'end'],
  recurrence: ['recurrenceKind', 'count', 'days'],
  task_date_rule: ['ruleKind', 'dateExpression', 'constraintLevel'],
  availability_declaration: ['availabilityKind', 'dateExpression', 'namedTimePeriod', 'startTime', 'endTime', 'recurrenceKind', 'days', 'capacityMinutes', 'constraintLevel'],
  relation: ['relationKind'],
} as const;

const payloadKindFields: Partial<Record<VNextAddFact['kind'], string>> = {
  effort_estimate: 'effortKind', temporal_constraint: 'constraintKind', planning_window: 'windowKind',
  recurrence: 'recurrenceKind', task_date_rule: 'ruleKind', availability_declaration: 'availabilityKind', relation: 'relationKind',
};
const referenceFields = { taskId: 'taskRef', componentId: 'componentRef', parentComponentId: 'parentComponentRef',
  targetFactId: 'targetRef', fromTaskId: 'fromTaskRef', toTaskId: 'toTaskRef' } as const;

type FactRecord = { id: string; [key: string]: unknown };
function allFacts(graph: WeeklyPlanningVNextGraph): { kind: WeeklyPlanningFactKindV5; fact: FactRecord }[] {
  return (Object.keys(collections) as WeeklyPlanningFactKindV5[]).flatMap(kind =>
    graph[collections[kind]].map(fact => ({ kind, fact: fact as unknown as FactRecord })));
}
function activeIds(graph: WeeklyPlanningVNextGraph): Set<string> {
  return new Set(graph.factLifecycles.filter(entry => entry.status === 'active').map(entry => entry.factId));
}
function activeLeaf(graph: WeeklyPlanningVNextGraph, factId: string): string | null {
  const lineage = vnextLineageIdByFactId(graph);
  const root = lineage.get(factId);
  if (!root) return null;
  return graph.factLifecycles.find(entry => entry.status === 'active' && lineage.get(entry.factId) === root)?.factId ?? null;
}
function appendFact(graph: WeeklyPlanningVNextGraph, kind: WeeklyPlanningFactKindV5, fact: FactRecord): void {
  // The kind and payload are checked by the typed construction and final graph validator.
  (graph[collections[kind]] as unknown as FactRecord[]).push(fact);
  graph.factLifecycles.push({ factId: fact.id, status: 'active', createdRevision: graph.revision,
    terminalRevision: null, supersededByFactId: null });
}
function terminalize(graph: WeeklyPlanningVNextGraph, factId: string, replacementId: string | null): void {
  const lifecycle = graph.factLifecycles.find(entry => entry.factId === factId)!;
  lifecycle.status = replacementId ? 'superseded' : 'removed';
  lifecycle.terminalRevision = graph.revision;
  lifecycle.supersededByFactId = replacementId;
}

export function createEmptyWeeklyPlanningVNextState(): WeeklyPlanningVNextState {
  return { version: WEEKLY_PLANNING_VNEXT_STATE_VERSION,
    graph: { ...createEmptyWeeklyPlanningFactGraphV5(), effortEstimates: [], studyContexts: [] },
    workRelations: [], deferrals: [] };
}

/**
 * The sole fact writer: settle window add/patch/remove, choose one final horizon,
 * anchor stated dates, bind estimates to final work, then validate and commit once.
 * Moving anchoring earlier makes equivalent replacements disagree (S02); anchoring
 * accepted dates again later relaxes deadlines (VP02). Extend the typed payload and
 * validation mappings here, never add a second update path or interpret source text.
 * Transaction.test.ts guards replacement equivalence, selected defaults and stable deadlines.
 */
export function applyWeeklyPlanningVNextTurn(
  state: WeeklyPlanningVNextState,
  statedDelta: VNextTurnDelta,
  context: VNextTurnContext,
): VNextTurnResult {
  const errors: VNextTurnError[] = [];
  const error = (code: VNextTurnError['code'], path: string, factId: string | null = null,
    localId: string | null = null) => errors.push({ code, path, factId, localId });
  const reject = (): VNextTurnResult => ({ status: 'rejected', state, errors });
  if (!context.turnKey.trim() || !context.conversationId.trim() || !context.turnId.trim() || !context.sourceText.trim()
    || !isValidCalendarDate(context.acceptedDate)
    || !['monday', 'sunday'].includes(context.weekStartsOn)
    || !context.planningHorizon || !isValidCalendarDate(context.planningHorizon.startDate)
    || !isValidCalendarDate(context.planningHorizon.endDate)
    || context.planningHorizon.startDate > context.planningHorizon.endDate
    || !context.defaultPlanningHorizon || !isValidCalendarDate(context.defaultPlanningHorizon.startDate)
    || !isValidCalendarDate(context.defaultPlanningHorizon.endDate)
    || context.defaultPlanningHorizon.startDate > context.defaultPlanningHorizon.endDate) {
    error('invalid_value', 'context');
    return reject();
  }
  const delta = structuredClone(statedDelta);
  if (state.graph.appliedTurnKeys.includes(context.turnKey)) return { status: 'duplicate', state };
  if (context.expectedRevision !== state.graph.revision) {
    error('stale_revision', 'context.expectedRevision');
    return reject();
  }
  if (![delta.add, delta.patch, delta.remove, delta.relate, delta.defer].some(items => items.length)) {
    error('empty_delta', 'delta');
    return reject();
  }

  // Copy only our working transaction; every rejected path returns the original state by identity.
  const next = structuredClone(state);
  const graph = next.graph;
  graph.revision++;
  const originalFacts = new Map(allFacts(state.graph).map(entry => [entry.fact.id, entry]));
  const initialActive = activeIds(state.graph);
  const localIds = new Map<string, string>();
  const locations = new Map<string, { path: string; localId: string | null }>();
  const diff: WeeklyPlanningFactDiffV5 = {
    fromRevision: state.graph.revision, toRevision: graph.revision, added: [], superseded: [], removed: [],
  };
  const newId = (localId: string) => `vnext:${JSON.stringify([context.conversationId, context.turnKey, localId])}`;
  const registerId = (localId: string, path: string): string => {
    const id = newId(localId);
    if (!localId.trim() || localIds.has(localId) || originalFacts.has(id)) error('duplicate_local_id', path, null, localId);
    localIds.set(localId, id);
    return id;
  };
  delta.add.forEach((fact, index) => registerId(fact.localId, `add[${index}].localId`));
  const addedLocalIds = new Map(localIds);
  delta.patch.forEach((patch, index) => registerId(patch.localId, `patch[${index}].localId`));
  if (errors.length) return reject();
  const source = (localId: string) => ({ conversationId: context.conversationId, turnId: context.turnId,
    semanticLocalId: localId, sourceText: context.sourceText, origin: 'user' as const });
  // One reference rule: any version of a lineage whose current version is active is accepted;
  // stored references name the lineage root, operations act on the current version.
  const stateResolver = createVNextLineageResolver(state.graph);
  const currentOf = (factId: string): string | null =>
    (originalFacts.has(factId) ? stateResolver.leafOf(factId) : null);
  const ref = (value: VNextFactRef, path: string): string => {
    if ('localId' in value) {
      const id = addedLocalIds.get(value.localId);
      if (!id) error('unknown_ref', path, null, value.localId);
      return id ?? '';
    }
    if (!currentOf(value.factId)) {
      error('unknown_ref', path, value.factId);
      return '';
    }
    return stateResolver.lineageOf(value.factId);
  };
  // An estimate about a projected work by identity is stored on the work's defining fact.
  const workRefs = new Map<string, string>();
  const stateWorkUnits = computeVNextWorkUnits(state.graph).flatMap((owner) => owner.units);
  const workRef = (value: VNextWorkRef, path: string): string => {
    const unit = stateWorkUnits.find((candidate) => candidate.workLineageId === value.workLineageId);
    if (!unit) error('unknown_ref', path, value.workLineageId);
    return unit ? stateResolver.lineageOf(unit.definingFactId) : '';
  };
  let planningHorizon = context.planningHorizon;
  const dateMeaning = (kind: VNextAddFact['kind'], recurrenceKind: unknown = null) =>
    kind === 'task_date_rule' || (kind === 'availability_declaration' && recurrenceKind !== null)
      ? 'repeated_filter' as const : 'one_occurrence' as const;
  const fixDate = (expression: string | null, meaning: 'repeated_filter' | 'one_occurrence', path: string, localId: string) => {
    if (expression === null) return null;
    const fixed = fixVNextDateExpression(expression, { ...context, planningHorizon }, meaning);
    if (fixed === null) error('invalid_value', path, null, localId);
    return fixed ?? expression;
  };
  // A planning window defines the horizon itself. Freeze its effective payload,
  // including a relative correction of an already absolute stored window.
  const freezeWindow = (payload: Record<string, unknown>, path: string, localId: string, valueStated = false): Record<string, unknown> => {
    if (!['absolute', 'relative_day', 'relative_week', 'named_period'].includes(String(payload.kind))) return payload;
    const range = (expression: unknown, field: string) => {
      const fixed = typeof expression === 'string' ? fixVNextDateExpression(expression, context, 'planning_window') : null;
      const resolved = fixed === null ? null : resolveCanonicalDateExpression({ expression: fixed,
        currentDate: context.acceptedDate, weekStartsOn: context.weekStartsOn });
      if (resolved?.status === 'resolved') return resolved.range;
      error('invalid_value', `${path}.${field}`, null, localId);
      return null;
    };
    const fromValue = payload.kind !== 'absolute' || valueStated;
    const value = fromValue ? range(payload.value, 'value') : null;
    const start = fromValue ? value?.start : range(payload.start, 'start')?.start;
    const end = fromValue ? value?.end : range(payload.end, 'end')?.end;
    if (!start || !end) return payload;
    if (start > end) {
      error('invalid_value', `${path}.start`, null, localId);
      error('invalid_value', `${path}.end`, null, localId);
      return payload;
    }
    return { ...payload, kind: 'absolute', value: start === end ? start : `${start}/${end}`, start, end };
  };
  const addPayload = (fact: VNextAddFact, path: string): Record<string, unknown> => {
    switch (fact.kind) {
      case 'task': return { category: fact.category, title: fact.title };
      case 'study_context': return { taskId: ref(fact.taskRef, `${path}.taskRef`), purpose: fact.purpose,
        contextLabel: fact.contextLabel, activityKind: fact.activityKind };
      case 'component': return { taskId: ref(fact.taskRef, `${path}.taskRef`),
        parentComponentId: fact.parentComponentRef ? ref(fact.parentComponentRef, `${path}.parentComponentRef`) : null,
        role: fact.role, label: fact.label };
      case 'workload': return { taskId: ref(fact.taskRef, `${path}.taskRef`),
        componentId: fact.componentRef ? ref(fact.componentRef, `${path}.componentRef`) : null,
        quantityRole: fact.quantityRole, amount: fact.amount, unitCode: fact.unitCode, unitLabel: fact.unitLabel,
        rangeStart: fact.rangeStart, rangeEnd: fact.rangeEnd, perOccurrence: fact.perOccurrence, periodExpression: fact.periodExpression };
      case 'effort_estimate': return { taskId: ref(fact.taskRef, `${path}.taskRef`),
        targetFactId: 'workLineageId' in fact.targetRef
          ? workRef(fact.targetRef, `${path}.targetRef`)
          : ref(fact.targetRef, `${path}.targetRef`),
        kind: fact.effortKind,
        minutes: fact.minutes, unitCode: fact.unitCode, unitLabel: fact.unitLabel, precision: fact.precision, workBinding: null };
      case 'temporal_constraint': return { taskId: ref(fact.taskRef, `${path}.taskRef`),
        targetFactId: ref(fact.targetRef, `${path}.targetRef`), kind: fact.constraintKind,
        constraintLevel: fact.constraintLevel, dateExpression: fixDate(fact.dateExpression, dateMeaning(fact.kind), `${path}.dateExpression`, fact.localId), namedTimePeriod: fact.namedTimePeriod,
        startTime: fact.startTime, endTime: fact.endTime, precision: fact.precision };
      case 'planning_window': return freezeWindow({ kind: fact.windowKind, value: fact.value, start: fact.start, end: fact.end }, path, fact.localId);
      case 'recurrence': return { taskId: ref(fact.taskRef, `${path}.taskRef`), targetFactId: ref(fact.targetRef, `${path}.targetRef`),
        kind: fact.recurrenceKind, count: fact.count, days: fact.days };
      case 'task_date_rule': return { taskId: ref(fact.taskRef, `${path}.taskRef`), targetFactId: ref(fact.targetRef, `${path}.targetRef`),
        kind: fact.ruleKind, dateExpression: fixDate(fact.dateExpression, dateMeaning(fact.kind), `${path}.dateExpression`, fact.localId), constraintLevel: fact.constraintLevel };
      case 'availability_declaration': return { kind: fact.availabilityKind,
        dateExpression: fixDate(fact.dateExpression, dateMeaning(fact.kind, fact.recurrenceKind), `${path}.dateExpression`, fact.localId),
        namedTimePeriod: fact.namedTimePeriod, startTime: fact.startTime, endTime: fact.endTime, recurrenceKind: fact.recurrenceKind,
        days: fact.days, capacityMinutes: fact.capacityMinutes, constraintLevel: fact.constraintLevel, resolutionStatus: 'unresolved' };
      case 'relation': return { kind: fact.relationKind, fromTaskId: ref(fact.fromTaskRef, `${path}.fromTaskRef`),
        toTaskId: ref(fact.toTaskRef, `${path}.toTaskRef`) };
    }
  };
  const touchedEfforts = new Set<string>();
  const addFact = (fact: VNextAddFact, index: number) => {
    const id = localIds.get(fact.localId)!;
    const path = `add[${index}]`;
    appendFact(graph, fact.kind, { ...addPayload(fact, path), id, source: source(fact.localId), createdRevision: graph.revision });
    locations.set(id, { path, localId: fact.localId });
    diff.added.push({ kind: fact.kind, id });
    if (fact.kind === 'effort_estimate') {
      touchedEfforts.add(id);
      if ('workLineageId' in fact.targetRef) workRefs.set(id, fact.targetRef.workLineageId);
    }
  };

  const targetOperations = new Set<string>();
  const retirementPaths = new Map<string, string>();
  const target = (id: string, path: string, localId: string | null = null) => {
    const found = originalFacts.get(id);
    if (!found) error('unknown_ref', path, id, localId);
    else if (!initialActive.has(id) || targetOperations.has(id)) error('target_not_active', path, id, localId);
    targetOperations.add(id);
    return found && initialActive.has(id) ? found : null;
  };
  const patchFact = (patch: VNextTurnDelta['patch'][number], index: number) => {
    const path = `patch[${index}]`;
    const found = target(patch.targetFactId, `${path}.targetFactId`, patch.localId);
    if (!found) return;
    if (found.kind !== patch.kind) { error('kind_mismatch', `${path}.kind`, patch.targetFactId, patch.localId); return; }
    const allowed = VNEXT_PATCH_FIELDS[patch.kind] as readonly string[];
    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch.changes)) {
      if (!allowed.includes(key)) {
        // Even null identity fields are invalid: they are not part of this wire schema.
        error('invalid_value', `${path}.changes.${key}`, patch.targetFactId, patch.localId);
      } else if (value !== null) changes[key === payloadKindFields[patch.kind] ? 'kind' : key] = value;
    }
    if ('amountDelta' in patch && patch.amountDelta !== null) {
      if (patch.kind !== 'workload' || typeof patch.amountDelta !== 'number' || !Number.isFinite(patch.amountDelta)
        || changes.amount !== undefined) error('invalid_value', `${path}.amountDelta`, patch.targetFactId, patch.localId);
      else changes.amount = Number(found.fact.amount) + patch.amountDelta;
    }
    if (Object.keys(changes).length === 0) { error('empty_patch', `${path}.changes`, patch.targetFactId, patch.localId); return; }
    const payload = patch.kind === 'planning_window'
      ? freezeWindow({ ...found.fact, ...changes }, `${path}.changes`, patch.localId,
        'value' in changes && !('start' in changes) && !('end' in changes))
      : { ...found.fact, ...changes };
    if ('dateExpression' in changes) payload.dateExpression = fixDate(changes.dateExpression as string,
      dateMeaning(patch.kind, payload.recurrenceKind), `${path}.changes.dateExpression`, patch.localId);
    const sameValues = Object.entries(payload).every(([key, value]) => JSON.stringify(found.fact[key]) === JSON.stringify(value));
    if (sameValues && patch.kind !== 'effort_estimate') return;
    const id = localIds.get(patch.localId)!;
    appendFact(graph, patch.kind, { ...payload, id, source: source(patch.localId), createdRevision: graph.revision });
    terminalize(graph, patch.targetFactId, id);
    retirementPaths.set(patch.targetFactId, `${path}.targetFactId`);
    locations.set(id, { path: `${path}.changes`, localId: patch.localId });
    diff.added.push({ kind: patch.kind, id });
    diff.superseded.push({ kind: patch.kind, id: patch.targetFactId });
    if (patch.kind === 'effort_estimate') touchedEfforts.add(id);
  };
  const removeFact = (removal: VNextTurnDelta['remove'][number], index: number) => {
    const found = target(removal.targetFactId, `remove[${index}].targetFactId`);
    if (!found) return;
    terminalize(graph, removal.targetFactId, null);
    retirementPaths.set(removal.targetFactId, `remove[${index}].targetFactId`);
    diff.removed.push({ kind: found.kind, id: removal.targetFactId });
    if (found.kind === 'workload') {
      // The one dependency rule for work: estimates that measure only this work (stated about
      // this workload, or bound to its work) end with it. Any other dependent still rejects.
      const lineageIds = vnextLineageIdByFactId(graph);
      const lineage = lineageIds.get(removal.targetFactId);
      for (const effort of graph.effortEstimates) {
        const measuresOnlyThis = lineageIds.get(effort.targetFactId) === lineage
          || effort.workBinding?.workLineageId === lineage;
        if (measuresOnlyThis && activeIds(graph).has(effort.id) && !touchedEfforts.has(effort.id)
          && !delta.remove.some(item => item.targetFactId === effort.id)) {
          terminalize(graph, effort.id, null);
          retirementPaths.set(effort.id, `remove[${index}].targetFactId`);
          diff.removed.push({ kind: 'effort_estimate', id: effort.id });
        }
      }
    }
  };
  // All operations on the horizon authority share this stage. Dependent dates
  // read its final active state, independent of the delta's update expression.
  const removesWindow = (removal: VNextTurnDelta['remove'][number]) =>
    originalFacts.get(removal.targetFactId)?.kind === 'planning_window';
  delta.add.forEach((fact, index) => { if (fact.kind === 'planning_window') addFact(fact, index); });
  delta.patch.forEach((patch, index) => { if (patch.kind === 'planning_window') patchFact(patch, index); });
  delta.remove.forEach((removal, index) => { if (removesWindow(removal)) removeFact(removal, index); });
  if (errors.length) return reject();
  const changesWindow = delta.add.some(fact => fact.kind === 'planning_window')
    || delta.patch.some(patch => patch.kind === 'planning_window') || delta.remove.some(removesWindow);
  if (changesWindow) {
    const activeWindowIds = activeIds(graph);
    const windows = graph.planningWindows.filter(window => activeWindowIds.has(window.id));
    planningHorizon = windows.length === 1 && windows[0].kind === 'absolute' && windows[0].start && windows[0].end
      ? { startDate: windows[0].start, endDate: windows[0].end }
      : context.defaultPlanningHorizon;
  }
  // Original delta indices still identify every repair path.
  delta.add.forEach((fact, index) => { if (fact.kind !== 'planning_window') addFact(fact, index); });
  delta.patch.forEach((patch, index) => { if (patch.kind !== 'planning_window') patchFact(patch, index); });
  delta.remove.forEach((removal, index) => { if (!removesWindow(removal)) removeFact(removal, index); });
  if (errors.length) return reject();

  // All explicit operations have completed. Bind newly stated/changed totals to that final work.
  // What a total measures is fixed when it is stated; a patch rebinds the same measure.
  const previousBindings = new Map<string, VNextEffortWorkBinding | null>();
  for (const entry of diff.superseded) {
    const replacementId = graph.factLifecycles.find(item => item.factId === entry.id)?.supersededByFactId;
    const old = originalFacts.get(entry.id)?.fact as { workBinding?: VNextEffortWorkBinding | null } | undefined;
    if (replacementId) previousBindings.set(replacementId, old?.workBinding ?? null);
  }
  for (const effort of graph.effortEstimates) {
    if (!touchedEfforts.has(effort.id)) continue;
    const location = locations.get(effort.id)!;
    const targetLeaf = activeLeaf(graph, effort.targetFactId);
    if (!targetLeaf) { error('work_unavailable', location.path, effort.id, location.localId); continue; }
    const previous = previousBindings.get(effort.id) ?? null;
    const workLineageId = workRefs.get(effort.id);
    const about = effort.kind !== 'total_duration' ? null
      : workLineageId !== undefined ? { workLineageId }
        : previous?.kind === 'future_work' ? { workLineageId: previous.workLineageId }
          : previous?.kind === 'observed_pace' ? { workloadFactId: previous.workLineageId }
            : graph.workloads.some(fact => fact.id === targetLeaf) ? { workloadFactId: targetLeaf } : null;
    if (about === null) { effort.workBinding = null; continue; }
    const binding = resolveVNextEffortBinding(graph, about);
    if (!binding) { error('work_unavailable', location.path, effort.id, location.localId); continue; }
    effort.workBinding = binding;
  }

  // A repeated estimate may have refreshed its binding, even with identical minutes.
  // Collapse only truly unchanged patches after binding has finished.
  for (const superseded of [...diff.superseded]) {
    const old = originalFacts.get(superseded.id)!;
    const lifecycle = graph.factLifecycles.find(entry => entry.factId === superseded.id)!;
    const replacementId = lifecycle.supersededByFactId!;
    const replacement = allFacts(graph).find(entry => entry.fact.id === replacementId)!.fact;
    const payload = (fact: FactRecord) => Object.fromEntries(Object.entries(fact)
      .filter(([key]) => !['id', 'source', 'createdRevision'].includes(key)));
    if (JSON.stringify(payload(old.fact)) !== JSON.stringify(payload(replacement))) continue;
    const facts = graph[collections[old.kind]] as unknown as FactRecord[];
    facts.splice(facts.findIndex(fact => fact.id === replacementId), 1);
    graph.factLifecycles = graph.factLifecycles.filter(entry => entry.factId !== replacementId);
    Object.assign(lifecycle, state.graph.factLifecycles.find(entry => entry.factId === superseded.id)!);
    diff.added = diff.added.filter(entry => entry.id !== replacementId);
    diff.superseded = diff.superseded.filter(entry => entry.id !== superseded.id);
  }

  // Payload patches preserve reference lineages. Removal retains the V5 dependency
  // guard; the work dependency rule above is the only cascade.
  const retired = new Set([...diff.removed, ...diff.superseded].map(entry => entry.id));
  const lineage = vnextLineageIdByFactId(graph);
  const all = allFacts(graph);
  const active = activeIds(graph);
  for (const { fact } of all) {
    if (!active.has(fact.id)) continue;
    for (const key of ['taskId', 'componentId', 'parentComponentId', 'targetFactId', 'fromTaskId', 'toTaskId']) {
      const id = fact[key];
      if (typeof id !== 'string') continue;
      const root = lineage.get(id);
      const live = activeLeaf(graph, id);
      const retiredInTurn = [...retired].some(retiredId => lineage.get(retiredId) === root);
      // A patch changes only payload, so references keep their stable lineage.
      // Removal has no live leaf and must retain the dependency rejection.
      if (retiredInTurn && !live) {
        const removedId = [...retired].find(retiredId => lineage.get(retiredId) === root)!;
        error('active_dependents', retirementPaths.get(removedId)!, removedId);
      }
    }
  }
  delta.relate.forEach((relation, index) => {
    const path = `relate[${index}]`;
    const a = ref(relation.a, `${path}.a`), b = ref(relation.b, `${path}.b`);
    const pair = [lineage.get(a), lineage.get(b)];
    if (pair.some(id => !id) || !activeLeaf(graph, a) || !activeLeaf(graph, b)) error('work_unavailable', path);
    else if (pair[0] === pair[1] || !['same', 'distinct'].includes(relation.kind)
      || ![a, b].every(id => graph.workloads.some(workload => workload.id === activeLeaf(graph, id)))) error('invalid_value', path);
    else {
      const sorted = pair.sort() as [string, string];
      if (next.workRelations.some(item => item.kind === relation.kind
        && item.lineageIds[0] === sorted[0] && item.lineageIds[1] === sorted[1])) return;
      next.workRelations = next.workRelations.filter(item => item.lineageIds[0] !== sorted[0] || item.lineageIds[1] !== sorted[1]);
      next.workRelations.push({ kind: relation.kind, lineageIds: sorted, createdRevision: graph.revision });
    }
  });
  delta.defer.forEach((deferral, index) => {
    if (!deferral.questionKey.trim()) error('invalid_value', `defer[${index}].questionKey`);
    else if (deferral.allocation !== 'none' && (deferral.allocation !== 'provisional_timebox'
      || !vnextQuestionKeyAllowsProvisionalTimebox(deferral.questionKey))) error('invalid_value', `defer[${index}].allocation`);
    else if (!next.deferrals.some(item => item.questionKey === deferral.questionKey && item.allocation === deferral.allocation)) {
      // A later statement about the same question replaces its allocation (e.g. deferred, then "place it provisionally").
      next.deferrals = next.deferrals.filter(item => item.questionKey !== deferral.questionKey);
      next.deferrals.push({ ...deferral, createdRevision: graph.revision });
    }
  });

  const validated = validateWeeklyPlanningFactGraphValueV5(graph);
  for (const validationError of validated.errors) {
    const match = /^graph\.([a-zA-Z]+)\[(\d+)\](.*)$/.exec(validationError);
    if (match && match[1] in graph) {
      const fact = (graph[match[1] as keyof WeeklyPlanningFactGraphV5] as unknown as FactRecord[])[Number(match[2])];
      const location = fact && locations.get(fact.id);
      let suffix = match[3];
      if (location && suffix.startsWith('.kind')) {
        const kind = all.find(entry => entry.fact.id === fact.id)?.kind as VNextAddFact['kind'] | undefined;
        if (kind && payloadKindFields[kind]) suffix = suffix.replace('.kind', `.${payloadKindFields[kind]}`);
      }
      if (location?.path.startsWith('add[')) {
        for (const [field, wire] of Object.entries(referenceFields)) {
          if (suffix.startsWith(`.${field}`)) suffix = suffix.replace(`.${field}`, `.${wire}`);
        }
      }
      error('invalid_value', location ? `${location.path}${suffix}` : validationError,
        fact?.id ?? null, location?.localId ?? null);
    } else error('invalid_value', validationError);
  }
  // V5 validates purpose and ownership; the VNext-only activity extension is
  // checked here when stated, never inferred from a title, unit or context label.
  for (const studyContext of graph.studyContexts) {
    const location = locations.get(studyContext.id);
    if (location && !SEMANTIC_STUDY_ACTIVITY_KINDS_V5.includes(studyContext.activityKind)) {
      error('invalid_value', `${location.path}.activityKind`, studyContext.id, location.localId);
    }
  }
  for (const workload of graph.workloads) {
    const location = locations.get(workload.id);
    if (location && !isValidVNextQuantityBasis(workload)) {
      error('invalid_value', `${location.path}.${workload.rangeStart === null ? 'rangeStart' : 'rangeEnd'}`, workload.id, location.localId);
    }
  }
  for (const bound of graph.temporalConstraints) {
    const location = locations.get(bound.id);
    if (!location) continue;
    for (const field of vnextTemporalBoundRepairFields(bound)) {
      error('invalid_value', `${location.path}.${field}`, bound.id, location.localId);
    }
  }
  for (const effort of graph.effortEstimates) {
    if (!touchedEfforts.has(effort.id)) continue;
    const location = locations.get(effort.id)!;
    if (effort.unitCode === 'custom' && (typeof effort.unitLabel !== 'string' || !effort.unitLabel.trim())) {
      error('invalid_value', `${location.path}.unitLabel`, effort.id, location.localId);
      continue;
    }
    // A rate stated about one workload is in that work's unit; in another unit it could never
    // apply to its own target. Which code denotes the stated word stays the model's choice.
    const measured = effort.kind === 'duration_per_unit'
      ? graph.workloads.find(workload => workload.id === activeLeaf(graph, effort.targetFactId)) : undefined;
    if (measured && vnextUnitIdentity(effort) !== vnextUnitIdentity(measured)) {
      error('invalid_value', `${location.path}.unitCode`, effort.id, location.localId);
      error('invalid_value', `${location.path}.unitLabel`, effort.id, location.localId);
    }
  }
  if (errors.length) return reject();
  if (!diff.added.length && !diff.removed.length && !diff.superseded.length
    && JSON.stringify(next.workRelations) === JSON.stringify(state.workRelations)
    && JSON.stringify(next.deferrals) === JSON.stringify(state.deferrals)) {
    // Nothing changes and the revision is kept, but the turn is processed: a replay (even on a
    // later day, when its relative dates would resolve differently) is a duplicate.
    return { status: 'noop', state: { ...state, graph: { ...state.graph, appliedTurnKeys: [...state.graph.appliedTurnKeys, context.turnKey] } } };
  }
  graph.appliedTurnKeys.push(context.turnKey);
  return { status: 'applied', state: next, diff };
}
