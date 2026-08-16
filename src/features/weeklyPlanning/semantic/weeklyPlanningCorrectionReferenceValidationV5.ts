import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function nonEmpty(value: string | null): boolean {
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
  const errors: string[] = [];
  document.corrections.forEach((correction, index) => {
    if (
      !nonEmpty(correction.target.publicId)
      && !nonEmpty(correction.target.localId)
    ) {
      errors.push(`document.corrections[${index}].target:requires-id`);
    }

    if (
      correction.operation !== 'replace'
      || correction.target.kind !== 'effort_estimate'
      || !correction.replacementLocalId
    ) return;

    const targetKind = correction.target.publicId
      ? publicEffortKind(publicStateSummary, correction.target.publicId)
      : semanticEffortKind(document, correction.target.localId);
    const replacementKind = semanticEffortKind(
      document,
      correction.replacementLocalId,
    );
    if (targetKind && replacementKind && targetKind !== replacementKind) {
      errors.push(
        `document.corrections[${index}]:effort-measurement-mismatch:${targetKind}->${replacementKind}`,
      );
    }
  });
  return errors;
}
