import type {
  CanonicalSemanticReferenceV5,
  WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';

export interface WeeklyPlanningSelfRepairNoticeV5 {
  targetFactId: string;
  replacementFactId: string;
  /** Typed correction data (interaction renderer context): what the user corrected. */
  taskLabel: string | null;
  before: string;
  after: string;
  /** Deterministic acknowledgement (legacy renderer context and emergency fallback text). */
  message: string;
}

function taskLabelForFact(graph: WeeklyPlanningFactGraphV5, factId: string): string | null {
  const workload = graph.workloads.find((fact) => fact.id === factId);
  if (workload) {
    return graph.tasks.find((task) => task.id === workload.taskId)?.title?.trim() || null;
  }
  const effort = graph.effortEstimates.find((fact) => fact.id === factId);
  if (effort) {
    return graph.tasks.find((task) => task.id === effort.taskId)?.title?.trim() || null;
  }
  const temporal = graph.temporalConstraints.find((fact) => fact.id === factId);
  if (temporal) {
    return graph.tasks.find((task) => task.id === temporal.taskId)?.title?.trim() || null;
  }
  const task = graph.tasks.find((fact) => fact.id === factId);
  return task?.title?.trim() || null;
}

function factLabel(
  graph: WeeklyPlanningFactGraphV5,
  reference: CanonicalSemanticReferenceV5,
  factId: string,
): string | null {
  if (reference.kind === 'workload') {
    const fact = graph.workloads.find((item) => item.id === factId);
    return fact ? `${fact.amount}${fact.unitLabel}` : reference.mention;
  }
  if (reference.kind === 'effort_estimate') {
    const fact = graph.effortEstimates.find((item) => item.id === factId);
    return fact ? `${fact.minutes}分` : reference.mention;
  }
  if (reference.kind === 'temporal_constraint') {
    const fact = graph.temporalConstraints.find((item) => item.id === factId);
    if (!fact) return reference.mention;
    if (fact.namedTimePeriod) return fact.namedTimePeriod;
    if (fact.startTime && fact.endTime) return `${fact.startTime}〜${fact.endTime}`;
    return fact.dateExpression ?? reference.mention;
  }
  if (reference.kind === 'task') {
    return graph.tasks.find((item) => item.id === factId)?.title ?? reference.mention;
  }
  if (reference.kind === 'component') {
    return graph.components.find((item) => item.id === factId)?.label ?? reference.mention;
  }
  if (reference.kind === 'planning_window') {
    const fact = graph.planningWindows.find((item) => item.id === factId);
    return fact?.start && fact.end ? `${fact.start}〜${fact.end}` : fact?.value ?? reference.mention;
  }
  return reference.mention;
}

/**
 * Something the user removed in this turn (Issue #488), as typed data for the interaction
 * renderer to acknowledge in its own words. A replacement is covered by the self-repair notice;
 * a pure removal leaves no fact accepted in the turn, so without this the reply could neither
 * acknowledge it nor avoid contradicting it. Values are plan data, never prose.
 */
export interface WeeklyPlanningTurnRemovalV5 {
  kind: CanonicalSemanticReferenceV5['kind'];
  /** The task the removed fact belonged to, when known. */
  taskLabel: string | null;
  /** The removed item: its title/label/value, or the user's own words for it. */
  label: string;
}

/** The user's own words for a fact, from whichever collection holds it. */
function factSourceText(graph: WeeklyPlanningFactGraphV5, factId: string): string | null {
  const collections: ReadonlyArray<ReadonlyArray<{ id: string; source: { sourceText: string } }>> = [
    graph.planningWindows, graph.tasks, graph.studyContexts, graph.components, graph.workloads,
    graph.effortEstimates, graph.temporalConstraints, graph.taskDateRules, graph.recurrences,
    graph.relations, graph.availabilityDeclarations, graph.constraintSourceRequests,
  ];
  for (const collection of collections) {
    const fact = collection.find((item) => item.id === factId);
    if (fact) return fact.source.sourceText.trim() || null;
  }
  return null;
}

export function weeklyPlanningTurnRemovalsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  currentTurnId: string;
}): WeeklyPlanningTurnRemovalV5[] {
  return params.graph.correctionIntents
    .filter((item) => item.source.turnId === params.currentTurnId
      && item.operation === 'remove'
      && Boolean(item.target.factId))
    .flatMap((item) => {
      const factId = item.target.factId as string;
      // A typed label when the kind has one, else the user's mention, else the removed fact's
      // own source words: a removal is never dropped for want of a label.
      const label = (factLabel(params.graph, item.target, factId)?.trim()
        || factSourceText(params.graph, factId)
        || '').trim();
      return label
        ? [{ kind: item.target.kind, taskLabel: taskLabelForFact(params.graph, factId), label }]
        : [];
    });
}

export function createWeeklyPlanningSelfRepairNoticeV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  currentTurnId: string;
}): WeeklyPlanningSelfRepairNoticeV5 | null {
  const correction = [...params.graph.correctionIntents]
    .reverse()
    .find((item) =>
      item.source.turnId === params.currentTurnId
      && (item.operation === 'replace' || item.operation === 'modify')
      && Boolean(item.target.factId)
      && Boolean(item.replacementFactId));
  if (!correction?.target.factId || !correction.replacementFactId) return null;

  const before = factLabel(params.graph, correction.target, correction.target.factId);
  const after = factLabel(params.graph, correction.target, correction.replacementFactId);
  if (!before || !after || before === after) return null;
  const taskLabel = taskLabelForFact(params.graph, correction.replacementFactId)
    ?? taskLabelForFact(params.graph, correction.target.factId);
  const subject = taskLabel ? `${taskLabel}は` : '';
  return {
    targetFactId: correction.target.factId,
    replacementFactId: correction.replacementFactId,
    taskLabel,
    before,
    after,
    message: `${subject}${before}ではなく${after}ですね。修正しました。`,
  };
}
