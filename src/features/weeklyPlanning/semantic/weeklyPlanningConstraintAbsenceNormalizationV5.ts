export interface WeeklyPlanningConstraintAbsenceNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeWeeklyPlanningConstraintAbsenceMetadataV5(
  rawResponse: string,
): WeeklyPlanningConstraintAbsenceNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { rawResponse, repairs: [] };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.availabilityDeclarations)) {
    return { rawResponse, repairs: [] };
  }

  const repairs: string[] = [];
  const availabilityDeclarations = parsed.availabilityDeclarations.map((value, index) => {
    if (!isRecord(value) || value.kind !== 'no_additional_constraint') return value;
    if (value.constraintLevel === 'hard') return value;

    repairs.push(
      `document.availabilityDeclarations[${index}].constraintLevel:absence-metadata-canonicalized`,
    );
    return { ...value, constraintLevel: 'hard' };
  });

  if (repairs.length === 0) return { rawResponse, repairs };
  return {
    rawResponse: JSON.stringify({ ...parsed, availabilityDeclarations }),
    repairs,
  };
}
