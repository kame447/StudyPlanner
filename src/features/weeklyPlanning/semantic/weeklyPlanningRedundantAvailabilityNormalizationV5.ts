/*
 * Deterministic semantic-representation normalization.
 *
 * A hard `available` declaration with no clock, named period, or recurrence does
 * not narrow the Stable V5 scheduler at all: placement already starts from the
 * normal daily window, while existing plans/timetable/occupied constraints are
 * still applied separately. Keeping such a declaration can only add validation
 * surface (for example an unnecessary date-expression encoding requirement).
 *
 * This module therefore removes only that structurally provable no-op. It does
 * not inspect sourceText, task titles, Japanese wording, or infer whether two
 * different expressions mean the same thing.
 */
export interface RedundantAvailabilityNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRedundantHardAvailability(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.kind === 'available'
    && value.constraintLevel === 'hard'
    && value.namedTimePeriod === null
    && value.startTime === null
    && value.endTime === null
    && value.recurrenceKind === null;
}

export function normalizeRedundantHardAvailabilityV5(
  rawResponse: string,
): RedundantAvailabilityNormalizationResultV5 {
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
  const availabilityDeclarations = parsed.availabilityDeclarations.filter((value, index) => {
    if (!isRedundantHardAvailability(value)) return true;
    const localId = typeof value.localId === 'string' ? value.localId : String(index);
    repairs.push(`redundant-hard-availability-removed:${localId}`);
    return false;
  });

  if (repairs.length === 0) return { rawResponse, repairs: [] };
  return {
    rawResponse: JSON.stringify({ ...parsed, availabilityDeclarations }),
    repairs,
  };
}
