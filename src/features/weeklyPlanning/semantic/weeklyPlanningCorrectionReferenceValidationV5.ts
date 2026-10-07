import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

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
export function validateWeeklyPlanningCorrectionReplacementKindsV5(
  document: WeeklyPlanningSemanticDocumentV5,
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
  return document.corrections.flatMap((correction, index) => {
    if (!correction.replacementLocalId || correction.target.kind === 'proposal') return [];
    const replacementKind = kindByLocalId.get(correction.replacementLocalId);
    return replacementKind && replacementKind !== correction.target.kind
      ? [`document.corrections[${index}].replacementLocalId:kind-mismatch:${correction.target.kind}:${replacementKind}`]
      : [];
  });
}
