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

function grounded(sourceText: unknown, userText: string): boolean {
  const evidence = normalized(sourceText);
  return evidence.length > 0 && normalized(userText).includes(evidence);
}

function storedContexts(publicStateSummary?: Record<string, unknown>): Record<string, unknown>[] {
  const value = publicStateSummary?.userPlanningContext;
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function storedPlanningWindows(
  publicStateSummary?: Record<string, unknown>,
): Record<string, unknown>[] {
  const value = publicStateSummary?.planningWindows;
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function sameNullable(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  return normalized(left) === normalized(right);
}

function matchesStoredPlanningWindow(
  fact: Record<string, unknown>,
  stored: Record<string, unknown>[],
): boolean {
  return stored.some((record) =>
    normalized(record.kind) === normalized(fact.kind)
    && sameNullable(record.value, fact.value)
    && sameNullable(record.start, fact.start)
    && sameNullable(record.end, fact.end));
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
 * Removes accepted facts that a provider copied back into the current semantic
 * delta without current-turn evidence.
 *
 * This normalization never infers user meaning. It only removes an emitted fact
 * when the same fact already exists in publicStateSummary and the emitted
 * sourceText is not grounded in the current userText. Newly stated facts remain
 * AI-owned and are left untouched.
 *
 * Concern records are value-stable owner facts. Re-emitting the same
 * label/value does not create new information, even if the current utterance
 * mentions the same entity for another reason. Dropping that redundant signal
 * preserves the original source turn instead of allowing old concern content
 * to acquire a new, weaker sourceText.
 *
 * goal_event is different because a relative date expression such as
 * custom:2週間後 can resolve differently at a later observedDate. Therefore an
 * exactly matching stored goal event is removed only when its emitted
 * sourceText is not grounded in the current userText; grounded repetitions are
 * left for normal semantic handling.
 */
export function normalizeCopiedUserContextDeltaV5(params: {
  rawResponse: string;
  userText: string;
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
  const windows = storedPlanningWindows(params.publicStateSummary);
  const repairs: string[] = [];
  let changed = false;

  if (
    isRecord(parsed.planningWindow)
    && windows.length > 0
    && matchesStoredPlanningWindow(parsed.planningWindow, windows)
    && !grounded(parsed.planningWindow.sourceText, params.userText)
  ) {
    parsed.planningWindow = null;
    changed = true;
    repairs.push('copied-planning-window-removed');
  }

  if (stored.length > 0 && Array.isArray(parsed.userContextFacts)) {
    parsed.userContextFacts = parsed.userContextFacts.filter((value, index) => {
      if (!isRecord(value)) return true;
      const storedMatch = matchesStoredFact(value, stored);
      if (!storedMatch) return true;
      const redundantConcern = value.kind === 'concern';
      if (!redundantConcern && grounded(value.sourceText, params.userText)) return true;
      changed = true;
      repairs.push(`copied-user-context-fact-removed:${index}:${String(value.kind ?? 'unknown')}:${normalized(value.label)}`);
      return false;
    });
  }

  if (stored.length > 0 && Array.isArray(parsed.tasks)) {
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
