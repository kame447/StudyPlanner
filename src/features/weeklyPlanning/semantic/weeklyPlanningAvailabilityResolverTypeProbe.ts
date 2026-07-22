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
  const namedTimePeriod = declaration.namedTimePeriod;
  if (!namedTimePeriod) return undefined;
  return context.namedTimePeriods?.[namedTimePeriod];
}
