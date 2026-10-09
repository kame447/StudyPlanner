import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';
import { workloadUnitDisplayV5 } from './weeklyPlanningWorkloadQuantityLabelV5';
import type { WeeklyPlanningSemanticCanonicalizationResultV5 } from './weeklyPlanningSemanticCanonicalizerV5';

const record = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
const records = (value: unknown) => Array.isArray(value) ? value.map(record).filter((item): item is Record<string, unknown> => item !== null) : [];
const isDurationEstimate = (estimate: Record<string, unknown>) =>
  estimate.kind === 'session_duration' || estimate.kind === 'total_duration';
const bindingSignature = (task: Record<string, unknown>, estimate: Record<string, unknown>, workloadId: string) =>
  `${isDurationEstimate(estimate) ? 'active-workload-duration-reference-projected' : 'active-workload-rate-reference-projected'}:${JSON.stringify([task.localId, task.existingPublicId, estimate.localId,
    estimate.kind, estimate.minutes, estimate.unitCode, estimate.precision, estimate.sourceText, workloadId])}`;

/** Bridge an exact accepted-workload ID for effort without importing old quantity as new language. */
export function projectWeeklyPlanningExistingWorkloadRateReferenceV5(params: {
  rawResponse: string; graph?: WeeklyPlanningFactGraphV5;
}): { rawResponse: string; repairs: string[] } {
  let document: Record<string, unknown> | null;
  try { document = record(JSON.parse(params.rawResponse)); } catch { return { rawResponse: params.rawResponse, repairs: [] }; }
  if (!document) return { rawResponse: params.rawResponse, repairs: [] };
  const graph = params.graph ? createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph) : null;
  const repairs: string[] = projectClockUnitRates(document, graph);
  if (!graph) return { rawResponse: repairs.length ? JSON.stringify(document) : params.rawResponse, repairs };
  const allEstimates = records(document.tasks).flatMap(task => records(task.effortEstimates));
  for (const task of records(document.tasks)) {
    if (!graph.tasks.some((fact) => fact.id === task.existingPublicId) || typeof task.localId !== 'string') continue;
    const components = records(record(task.study)?.components);
    const containers = [task, ...components];
    const workloads = containers.flatMap((container) => records(container.workloads));
    for (const estimate of records(task.effortEstimates)) {
      const duration = isDurationEstimate(estimate);
      if (estimate.kind !== 'duration_per_unit' && !duration) continue;
      const target = graph.workloads.find((fact) => fact.id === estimate.targetLocalId
        && fact.taskId === task.existingPublicId && (duration || fact.unitCode === estimate.unitCode));
      if (!target) continue;
      if (duration) {
        // One exact citation owns the scope. Another estimate or new quantity must
        // go through normal semantic validation; never guess which one was meant.
        if (allEstimates.filter(fact => fact.targetLocalId === target.id).length !== 1
          || workloads.some(fact => fact.localId !== target.id)
          || workloads.filter(fact => fact.localId === target.id).length > 1) continue;
      } else {
        // Preserve the existing rate projection's single compatible-unit boundary.
        if (graph.workloads.filter(fact => fact.taskId === target.taskId && fact.unitCode === target.unitCode).length !== 1
          || workloads.some(fact => fact.localId !== target.id && fact.unitCode === target.unitCode)) continue;
      }
      const replay = workloads.find((fact) => fact.localId === target.id);
      const replayContainer = containers.find((container) => records(container.workloads).includes(replay!));
      if (replay && (replayContainer === task ? target.componentId !== null
        : replayContainer?.existingPublicId !== target.componentId)) continue;
      const identical = (fact: Record<string, unknown>) => ['quantityRole', 'amount', 'unitCode', 'unitLabel', 'rangeStart', 'rangeEnd', 'perOccurrence', 'periodExpression']
        .every((key) => fact[key] === target[key as keyof typeof target]);
      if (replay && !identical(replay)) continue;
      for (const container of containers) if (Array.isArray(container.workloads)) {
        container.workloads = container.workloads.filter((fact) => fact !== replay);
      }
      repairs.push(bindingSignature(task, estimate, target.id));
      estimate.targetLocalId = task.localId;
    }
  }
  repairs.push(...projectTaskSelfReferences(document, graph));
  return { rawResponse: repairs.length ? JSON.stringify(document) : params.rawResponse, repairs };
}

const SELF_REFERENCING_NESTED_KINDS = ['temporalConstraints', 'effortEstimates', 'recurrence'] as const;

function declaredLocalIds(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => declaredLocalIds(item, into));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'localId' && typeof item === 'string') into.add(item);
      else declaredLocalIds(item, into);
    }
  }
  return into;
}

const CLOCK_UNITS = ['minute', 'hour'];
/** Diagnostic prefix; the payload is [taskLocalId, effortLocalId, fromUnit, toUnit, quote, minutes, unitLabel]. */
export const CLOCK_UNIT_RATE_PROJECTED_PREFIX = 'clock-unit-rate-projected:';

/**
 * A `duration_per_unit` rate typed with a CLOCK unitCode (live round 5 X2: 「1問6分」 read as {6, unitCode 'minute'} for a
 * `problem` workload) is the unit OF the duration, not of the counted work: "minutes per minute" is not a per-unit rate, so
 * when the rate's target resolves to exactly ONE non-clock workload the rate takes that workload's unitCode (the estimate
 * ignores a rate whose unit differs from its workload's and the app re-asked for it). Targets: a workload or component
 * localId of the same task entry, the entry's task (exactly one workload in total: this entry's plus the accepted task's), or an
 * accepted workload's public id. Anything ambiguous - several workloads, a clock-unit workload, a non-clock mismatch, an unresolved
 * target - is left untouched. Diagnostic only; never a repair.
 *
 * KNOWN RESIDUAL (recorded, pinned by a test): the projection assumes `minutes` is per counted unit, as in the live X2. A
 * mis-encoding whose value is per CLOCK unit - e.g. 「1時間で10ページ」 as {minutes: 60, unitCode 'hour'} - is projected to 60 minutes
 * per page: a wrong plan instead of the old re-ask, and nothing typed tells the two apart.
 */
function projectClockUnitRates(
  document: Record<string, unknown>,
  graph: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5> | null,
): string[] {
  const repairs: string[] = [];
  type Unit = Record<string, unknown> | { unitCode: unknown; unitLabel: unknown };
  const unitOf = (value: Unit) => value as { unitCode?: unknown; unitLabel?: unknown };
  const nonClock = (unitCode: unknown): unitCode is string => typeof unitCode === 'string' && unitCode.length > 0 && !CLOCK_UNITS.includes(unitCode);
  for (const task of records(document.tasks)) {
    if (typeof task.localId !== 'string') continue;
    const components = records(record(task.study)?.components);
    const acceptedWorkloads = graph && typeof task.existingPublicId === 'string'
      ? graph.workloads.filter((fact) => fact.taskId === task.existingPublicId) : [];
    const ownWorkloads = [...records(task.workloads), ...components.flatMap((component) => records(component.workloads))];
    for (const estimate of records(task.effortEstimates)) {
      if (estimate.kind !== 'duration_per_unit' || typeof estimate.unitCode !== 'string' || !CLOCK_UNITS.includes(estimate.unitCode)) continue;
      const target = estimate.targetLocalId;
      if (typeof target !== 'string') continue;
      let units: Unit[] | null = null;
      const localTarget = ownWorkloads.filter((workload) => workload.localId === target);
      const accepted = graph ? graph.workloads.filter((fact) => fact.id === target && fact.taskId === task.existingPublicId) : [];
      const component = components.find((candidate) => candidate.localId === target);
      if (localTarget.length === 1 && accepted.length === 0) units = [localTarget[0]];
      else if (accepted.length === 1 && localTarget.length === 0) units = [accepted[0]];
      else if (component) units = records(component.workloads);
      else if (target === task.localId) units = [...ownWorkloads, ...acceptedWorkloads];
      if (!units || units.length !== 1 || !nonClock(unitOf(units[0]).unitCode)) continue;
      // The disclosure needs a trustworthy unit wording and the user's own quote: without them the rate stays a re-ask.
      const unit = unitOf(units[0]);
      const unitLabel = typeof unit.unitLabel === 'string' ? workloadUnitDisplayV5(unit.unitCode as SemanticWorkloadUnitCode, unit.unitLabel) : null;
      const quote = typeof estimate.sourceText === 'string' ? estimate.sourceText.trim() : '';
      if (!unitLabel || !quote || typeof estimate.minutes !== 'number') continue;
      repairs.push(`${CLOCK_UNIT_RATE_PROJECTED_PREFIX}${JSON.stringify([task.localId, estimate.localId, estimate.unitCode, unit.unitCode, quote, estimate.minutes, unitLabel])}`);
      estimate.unitCode = unit.unitCode;
    }
  }
  return repairs;
}

/**
 * A nested fact whose targetLocalId is the PUBLIC id of the very task entry that contains it has exactly one possible
 * referent: that entry. Rewrite it to the entry's own localId (live H r1 on 80af22a3). Anything else - another task's
 * public id, a task absent from the document, a component id, a value that is itself a declared localId - stays
 * untouched and keeps going through normal validation and the single repair. A projection is not a repair: the
 * ledger is not touched, only the diagnostic list.
 */
function projectTaskSelfReferences(
  document: Record<string, unknown>,
  graph: ReturnType<typeof createWeeklyPlanningActiveSchedulerGraphViewV5>,
): string[] {
  const repairs: string[] = [];
  const declared = declaredLocalIds(document);
  for (const task of records(document.tasks)) {
    const publicId = task.existingPublicId;
    if (typeof publicId !== 'string' || publicId.length === 0 || typeof task.localId !== 'string'
      || !graph.tasks.some((fact) => fact.id === publicId) || declared.has(publicId)) continue;
    for (const kind of SELF_REFERENCING_NESTED_KINDS) for (const fact of records(task[kind])) {
      if (fact.targetLocalId !== publicId) continue;
      fact.targetLocalId = task.localId;
      repairs.push(`task-self-reference-projected:${JSON.stringify([task.localId, publicId, kind, fact.localId])}`);
    }
  }
  return repairs;
}

/** The task-local bridge is representation only: retain the validated workload's scope. */
export function bindWeeklyPlanningExistingWorkloadRatesV5(params: {
  originalGraph: WeeklyPlanningFactGraphV5; document: WeeklyPlanningSemanticDocumentV5;
  canonicalization: WeeklyPlanningSemanticCanonicalizationResultV5; algorithmicRepairs?: readonly string[];
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const base = params.canonicalization;
  if (base.status !== 'applied' || !base.diff || !params.algorithmicRepairs?.length) return base;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.originalGraph);
  const targets = new Map<string, string>();
  for (const task of params.document.tasks) for (const estimate of task.effortEstimates) {
    const duration = isDurationEstimate({ ...estimate });
    if ((estimate.kind !== 'duration_per_unit' && !duration) || estimate.targetLocalId !== task.localId) continue;
    const matches = active.workloads.filter((workload) => workload.taskId === task.existingPublicId
      && (duration || workload.unitCode === estimate.unitCode)
      && params.algorithmicRepairs!.includes(bindingSignature({ ...task }, { ...estimate }, workload.id)));
    const estimateId = base.localToFactId[estimate.localId];
    if (matches.length !== 1 || !base.diff.added.some((entry) => entry.kind === 'effort_estimate' && entry.id === estimateId)) continue;
    targets.set(estimateId, matches[0].id);
  }
  if (!targets.size) return base;
  return { ...base, graph: { ...base.graph, effortEstimates: base.graph.effortEstimates.map((fact) =>
    targets.has(fact.id) ? { ...fact, targetFactId: targets.get(fact.id)! } : fact) } };
}
