import type { AvailabilityDeclarationFact } from './weeklyPlanningFactGraphV2';
import type { SemanticNamedTimePeriod } from './weeklyPlanningSemanticDocumentV2';

interface ProbeContext {
  namedTimePeriods?: Partial<
    Record<SemanticNamedTimePeriod, { startTime: string; endTime: string }>
  >;
}

export function probeNamedPeriod(
  declaration: AvailabilityDeclarationFact,
  context: ProbeContext,
): { startTime: string; endTime: string } | undefined {
  if (!declaration.namedTimePeriod) return undefined;
  return context.namedTimePeriods?.[declaration.namedTimePeriod];
}
