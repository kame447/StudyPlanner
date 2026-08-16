export const WEEKLY_PLANNING_COPIED_USER_CONTEXT_NORMALIZATION_VERSION_V5 =
  'weekly-planning-copied-user-context-normalization-v5' as const;

export interface WeeklyPlanningCopiedUserContextNormalizationResultV5 {
  rawResponse: string;
  repairs: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
}

function storedContexts(publicStateSummary?: Record<string, unknown>): Record<string, unknown>[] {
  const value = publicStateSummary?.userPlanningContext;
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function sameNullable(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  return normalized(left) === normalized(right);
}

function matchesStoredFact(
  fact: Record<string, unknown>,
  stored: Record<string, unknown>[],
): boolean {
  return stored.some((record) =>
    record.kind === fact.kind
    && normalized(record.label) === normalized(fact.label)
    && sameNullable(record.value, fact.value)
    && sameNullable(record.dateExpression, fact.dateExpression));
}

function matchesStoredConcern(
  label: unknown,
  signal: Record<string, unknown>,
  stored: Record<string, unknown>[],
): boolean {
  return stored.some((record) =>
    record.kind === 'concern'
    && normalized(record.label) === normalized(label)
    && sameNullable(record.value, signal.value));
}

/**
 * Collapses concern facts that already exist in typed public state so repeated
 * concern output stays idempotent and keeps its original provenance.
 *
 * This normalization deliberately does not classify planning windows, goal
 * events, or other semantic facts as "copied" by comparing sourceText with the
 * current utterance. Current-turn meaning is owned by the AI semantic layer;
 * deterministic post-processing receives only structured output and typed state.
 */
export function normalizeCopiedUserContextDeltaV5(params: {
  rawResponse: string;
  publicStateSummary?: Record<string, unknown>;
}): WeeklyPlanningCopiedUserContextNormalizationResultV5 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(params.rawResponse);
  } catch {
    return { rawResponse: params.rawResponse, repairs: [] };
  }
  if (!isRecord(parsed)) return { rawResponse: params.rawResponse, repairs: [] };

  const stored = storedContexts(params.publicStateSummary);
  if (stored.length === 0) return { rawResponse: params.rawResponse, repairs: [] };

  const repairs: string[] = [];
  let changed = false;

  if (Array.isArray(parsed.userContextFacts)) {
    parsed.userContextFacts = parsed.userContextFacts.filter((value, index) => {
      if (!isRecord(value) || value.kind !== 'concern' || !matchesStoredFact(value, stored)) {
        return true;
      }
      changed = true;
      repairs.push(`copied-user-context-fact-removed:${index}:concern:${normalized(value.label)}`);
      return false;
    });
  }

  if (Array.isArray(parsed.tasks)) {
    parsed.tasks = parsed.tasks.map((taskValue, taskIndex) => {
      if (!isRecord(taskValue)) return taskValue;
      let task = taskValue;
      if (Array.isArray(task.durableContextSignals)) {
        const signals = task.durableContextSignals.filter((value, signalIndex) => {
          if (!isRecord(value)) return true;
          if (!matchesStoredConcern(task.label ?? task.title, value, stored)) return true;
          changed = true;
          repairs.push(`copied-task-concern-removed:${taskIndex}:${signalIndex}:${normalized(task.title)}`);
          return false;
        });
        task = { ...task, durableContextSignals: signals };
      }
      if (!isRecord(task.study) || !Array.isArray(task.study.components)) return task;
      const components = task.study.components.map((componentValue, componentIndex) => {
        if (!isRecord(componentValue) || !Array.isArray(componentValue.durableContextSignals)) {
          return componentValue;
        }
        const signals = componentValue.durableContextSignals.filter((value, signalIndex) => {
          if (!isRecord(value)) return true;
          if (!matchesStoredConcern(componentValue.label, value, stored)) return true;
          changed = true;
          repairs.push(`copied-component-concern-removed:${taskIndex}:${componentIndex}:${signalIndex}:${normalized(componentValue.label)}`);
          return false;
        });
        return { ...componentValue, durableContextSignals: signals };
      });
      return { ...task, study: { ...task.study, components } };
    });
  }

  return changed
    ? { rawResponse: JSON.stringify(parsed), repairs }
    : { rawResponse: params.rawResponse, repairs: [] };
}
