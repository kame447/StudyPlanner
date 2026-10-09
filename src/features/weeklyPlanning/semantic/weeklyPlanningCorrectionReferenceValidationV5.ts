import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { WEEKLY_PLANNING_CORRECTABLE_REPLACEMENT_KINDS_V5 } from './weeklyPlanningCanonicalCorrectionApplicationExtendedV5';
import { activeWeeklyPlanningFactIdsV5 } from './weeklyPlanningFactLifecycleV5';
import { weeklyPlanningMaterialIdentityAnswersV5 } from './weeklyPlanningMaterialIdentityAnswerV5';

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function semanticEffortKind(
  document: WeeklyPlanningSemanticDocumentV5,
  localId: string | null,
): string | null {
  if (!localId) return null;
  for (const task of document.tasks) {
    const effort = task.effortEstimates.find((candidate) => candidate.localId === localId);
    if (effort) return effort.kind;
  }
  return null;
}

function rawSemanticEffortKind(
  value: Record<string, unknown>,
  localId: string | null,
): string | null {
  if (!localId) return null;
  for (const task of recordArray(value.tasks)) {
    const effort = recordArray(task.effortEstimates).find(
      (candidate) => candidate.localId === localId,
    );
    if (typeof effort?.kind === 'string') return effort.kind;
  }
  return null;
}

function publicEffortKind(
  publicStateSummary: Record<string, unknown> | undefined,
  publicId: string | null,
): string | null {
  if (!publicStateSummary || !publicId) return null;
  const effort = recordArray(publicStateSummary.effortEstimates).find(
    (candidate) => candidate.publicId === publicId,
  );
  return typeof effort?.kind === 'string' ? effort.kind : null;
}

function correctionReferenceErrors(params: {
  corrections: Record<string, unknown>[];
  replacementEffortKind: (localId: string | null) => string | null;
  publicStateSummary?: Record<string, unknown>;
}): string[] {
  const errors: string[] = [];
  params.corrections.forEach((correction, index) => {
    const target = isRecord(correction.target) ? correction.target : null;
    if (!target) return;

    const targetPublicId = nonEmpty(target.publicId) ? target.publicId : null;
    const targetLocalId = nonEmpty(target.localId) ? target.localId : null;
    if (!targetPublicId && !targetLocalId) {
      errors.push(`document.corrections[${index}].target:requires-id`);
    }

    const replacementLocalId = nonEmpty(correction.replacementLocalId)
      ? correction.replacementLocalId
      : null;
    if (
      correction.operation !== 'replace'
      || target.kind !== 'effort_estimate'
      || !replacementLocalId
    ) return;

    const targetKind = targetPublicId
      ? publicEffortKind(params.publicStateSummary, targetPublicId)
      : params.replacementEffortKind(targetLocalId);
    const replacementKind = params.replacementEffortKind(replacementLocalId);
    if (targetKind && replacementKind && targetKind !== replacementKind) {
      errors.push(
        `document.corrections[${index}]:effort-measurement-mismatch:${targetKind}->${replacementKind}`,
      );
    }
  });
  return errors;
}

/**
 * Corrections are lifecycle operations, so their target must already be
 * machine-addressable. `mention` is explanatory evidence only; deterministic
 * application code must not resolve a correction target from free text.
 *
 * Effort measurements are independent typed facts. Replacing an effort with a
 * different measurement kind (for example per-unit duration -> session
 * duration) would incorrectly erase information that can validly coexist.
 */
export function validateWeeklyPlanningCorrectionTargetReferencesV5(
  document: WeeklyPlanningSemanticDocumentV5,
  publicStateSummary?: Record<string, unknown>,
): string[] {
  return correctionReferenceErrors({
    corrections: document.corrections as unknown as Record<string, unknown>[],
    replacementEffortKind: (localId) => semanticEffortKind(document, localId),
    publicStateSummary,
  });
}

/**
 * Inspect only provider JSON reference fields that are meaningful even when an
 * unrelated schema field is invalid. This never reads or interprets user text.
 * It lets one repair request receive all detectable lifecycle-reference errors
 * instead of discovering a second invariant only after the single repair pass.
 */
export function validateWeeklyPlanningRawCorrectionTargetReferencesV5(
  rawResponse: string,
  publicStateSummary?: Record<string, unknown>,
): string[] {
  try {
    const value = JSON.parse(rawResponse) as unknown;
    if (!isRecord(value)) return [];
    return correctionReferenceErrors({
      corrections: recordArray(value.corrections),
      replacementEffortKind: (localId) => rawSemanticEffortKind(value, localId),
      publicStateSummary,
    });
  } catch {
    return [];
  }
}

/**
 * Interaction only: a correction replaces a fact with a new fact of the same kind. The
 * canonical correction owner rejects a mismatch after validation, when no repair is left
 * (live B on dc38e978: a new material component was also sent as the replacement of its
 * task). Reporting it here lets the single repair drop or fix the correction. Structural
 * only: declared reference kind versus the kind of the declared replacement fact.
 */
/**
 * Interaction: a replace correction of an effort whose replacement hangs from a NEW workload of the same
 * document that no correction installs and that does not restate an accepted workload. The canonical owner would
 * have to either delete that workload or apply it without a correction; it fails the turn instead (disclosed
 * recover), so the single repair is told here, while it can still add the missing correction.
 */
export function validateWeeklyPlanningCorrectionSupportInstalledV5(
  document: WeeklyPlanningSemanticDocumentV5,
  graph?: WeeklyPlanningFactGraphV5,
): string[] {
  if (!graph) return [];
  const activeIds = activeWeeklyPlanningFactIdsV5(graph);
  const installed = new Set(document.corrections.map((correction) => correction.replacementLocalId));
  const localWorkloads = new Map<string, { quantityRole: string; amount: number; unitCode: string; perOccurrence: boolean }>();
  for (const task of document.tasks) {
    for (const workload of task.workloads) localWorkloads.set(workload.localId, workload);
    for (const component of task.study?.components ?? []) {
      for (const workload of component.workloads) localWorkloads.set(workload.localId, workload);
    }
  }
  const restatesAccepted = (workload: { quantityRole: string; amount: number; unitCode: string; perOccurrence: boolean }) =>
    graph.workloads.some((fact) => (!activeIds || activeIds.has(fact.id))
      && fact.quantityRole === workload.quantityRole && fact.amount === workload.amount
      && fact.unitCode === workload.unitCode && fact.perOccurrence === workload.perOccurrence);
  const errors: string[] = [];
  document.corrections.forEach((correction, index) => {
    if (correction.operation !== 'replace' || correction.target.kind !== 'effort_estimate'
      || !correction.replacementLocalId || !correction.target.publicId) return;
    const replaced = graph.effortEstimates.find((fact) => fact.id === correction.target.publicId);
    if (!replaced) return;
    const replacement = document.tasks.flatMap((task) => task.effortEstimates)
      .find((effort) => effort.localId === correction.replacementLocalId);
    const anchor = replacement ? localWorkloads.get(replacement.targetLocalId) : undefined;
    if (!replacement || !anchor || installed.has(replacement.targetLocalId) || restatesAccepted(anchor)) return;
    errors.push(`document.corrections[${index}].replacementLocalId:support-not-installed:${replacement.targetLocalId}`);
  });
  return errors;
}

export function validateWeeklyPlanningCorrectionReplacementKindsV5(
  document: WeeklyPlanningSemanticDocumentV5,
  graph?: WeeklyPlanningFactGraphV5,
): string[] {
  const kindByLocalId = new Map<string, string>();
  const register = (kind: string, facts: ReadonlyArray<{ localId: string }>) => {
    for (const fact of facts) kindByLocalId.set(fact.localId, kind);
  };
  if (document.planningWindow) register('planning_window', [document.planningWindow]);
  register('relation', document.relations);
  register('availability_declaration', document.availabilityDeclarations);
  for (const task of document.tasks) {
    register('task', [task]);
    register('workload', task.workloads);
    register('effort_estimate', task.effortEstimates);
    register('temporal_constraint', task.temporalConstraints);
    register('recurrence', task.recurrence);
    for (const component of task.study?.components ?? []) {
      register('component', [component]);
      register('workload', component.workloads);
    }
  }
  // A material identity answer consumes its own same-component replace correction.
  const identityAnswers = graph ? weeklyPlanningMaterialIdentityAnswersV5(graph, document) : [];
  return [...validateWeeklyPlanningCorrectionSupportInstalledV5(document, graph), ...document.corrections.flatMap((correction, index) => {
    if (!correction.replacementLocalId || correction.target.kind === 'proposal') return [];
    const replacementKind = kindByLocalId.get(correction.replacementLocalId);
    if (!replacementKind) return [];
    if (replacementKind !== correction.target.kind) {
      return [`document.corrections[${index}].replacementLocalId:kind-mismatch:${correction.target.kind}:${replacementKind}`];
    }
    // The canonical owner cannot substitute a task, component or relation; without this the
    // turn is rejected after validation with no repair left (live B on 64436073).
    if (WEEKLY_PLANNING_CORRECTABLE_REPLACEMENT_KINDS_V5.has(replacementKind)
      || identityAnswers.some((answer) => correction.target.kind === 'component'
        && answer.targetId === correction.target.publicId && answer.localId === correction.replacementLocalId)) return [];
    return [`document.corrections[${index}].replacementLocalId:unsupported-kind:${replacementKind}`];
  })];
}
