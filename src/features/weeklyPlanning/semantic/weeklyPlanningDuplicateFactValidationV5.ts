import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Interaction only, structural: facts of one kind in one response that differ only by their
 * localId carry no extra meaning. Live A on e9b62a50 sent five identical preferred windows with
 * a null date ("every day"), silently dropping 「平日」. Reporting them lets the one repair
 * either date each copy or keep one. No text is read.
 */
export function validateWeeklyPlanningDuplicateFactsV5(
  document: WeeklyPlanningSemanticDocumentV5,
): string[] {
  const errors: string[] = [];
  const check = (path: string, facts: ReadonlyArray<{ localId: string }>) => {
    const seen = new Map<string, number>();
    facts.forEach((fact, index) => {
      const { localId: _localId, ...rest } = fact as { localId: string } & Record<string, unknown>;
      const key = stableSerialize(rest);
      const first = seen.get(key);
      if (first === undefined) seen.set(key, index);
      else errors.push(`${path}[${index}]:duplicate-of:${first}`);
    });
  };
  document.tasks.forEach((task, index) => {
    check(`document.tasks[${index}].temporalConstraints`, task.temporalConstraints);
    check(`document.tasks[${index}].effortEstimates`, task.effortEstimates);
    check(`document.tasks[${index}].workloads`, task.workloads);
    check(`document.tasks[${index}].recurrence`, task.recurrence);
  });
  check('document.availabilityDeclarations', document.availabilityDeclarations);
  return errors;
}
