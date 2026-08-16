import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function nonEmpty(value: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Corrections are lifecycle operations, so their target must already be
 * machine-addressable. `mention` is explanatory evidence only; deterministic
 * application code must not resolve a correction target from free text.
 */
export function validateWeeklyPlanningCorrectionTargetReferencesV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];
  document.corrections.forEach((correction, index) => {
    if (
      !nonEmpty(correction.target.publicId)
      && !nonEmpty(correction.target.localId)
    ) {
      errors.push(`document.corrections[${index}].target:requires-id`);
    }
  });
  return errors;
}
