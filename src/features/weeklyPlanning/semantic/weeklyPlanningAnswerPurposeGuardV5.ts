import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { SemanticWorkloadV5, WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';

/**
 * Purpose-keyed answer binding (Issue #488 P3 slice 1). The held purpose is derived from the typed intent the renderer
 * received (`dialogue/weeklyPlanningHeldQuestionPurposeV5.ts`) and handed to the pipeline. The question the user was shown asks for something specific; a
 * reading binds to it only through a contribution whose OWN typed role matches. The held purpose only DEMOTES: it never
 * upgrades a reading and never fills in a missing role or scope (the reading must come from the question as shown, so the
 * purpose is not sent to the semantic model).
 *
 * S1 purpose: `current_progress` (the shown question asks how much is already done). Positive matches: `completed`, `remaining`, `scope_total`. An amount that is a plan target
 * (`target` workload) or a bare `total_duration` on a work-less task does not answer a progress question: it becomes a
 * `declared` (role-unresolved) clock workload, so the existing typed role confirmation asks whether it is the amount to do
 * or the amount already done. Nothing is promoted or lost.
 */
export type HeldQuestionPurposeV5 = 'current_progress';

const PURPOSE_INTENT_PREFIX = 'purpose:';
const HELD_PURPOSES: ReadonlySet<string> = new Set<HeldQuestionPurposeV5>(['current_progress']);

/** Forward-compatible reader for a persisted `intent` of the form `purpose:<enum>` (unknown values yield null). */
export function parseHeldQuestionPurposeIntentV5(intent: string | null | undefined): HeldQuestionPurposeV5 | null {
  if (!intent?.startsWith(PURPOSE_INTENT_PREFIX)) return null;
  const value = intent.slice(PURPOSE_INTENT_PREFIX.length);
  return HELD_PURPOSES.has(value) ? value as HeldQuestionPurposeV5 : null;
}

const normalizedTitle = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');

/**
 * Judges EACH contribution on the held question's owner task on its own (a positive match binds, a mismatch is demoted); the
 * guard covers amounts on the task, on its components and on a new task whose normalized title equals the owner's (an entity
 * bypass: a label comparison, not language parsing). Returns how many contributions were demoted (0 = untouched).
 */
export function guardAnswerAgainstHeldPurposeV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  held: { purpose: HeldQuestionPurposeV5; ownerTaskId: string };
}): { document: WeeklyPlanningSemanticDocumentV5; demoted: number } {
  const { document, held } = params;
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const ownerTitle = active.tasks.find((task) => task.id === held.ownerTaskId)?.title;
  const hasAcceptedWorkload = active.workloads.some((workload) => workload.taskId === held.ownerTaskId
    && workload.quantityRole !== 'completed' && workload.quantityRole !== 'scope_total');
  let demoted = 0;
  const isOwner = (task: WeeklyPlanningSemanticDocumentV5['tasks'][number]) => task.existingPublicId === held.ownerTaskId
    || (!task.existingPublicId && ownerTitle !== undefined && normalizedTitle(task.title) === normalizedTitle(ownerTitle));
  const tasks = document.tasks.map((task) => {
    if (!isOwner(task)) return task;
    const components = task.study?.components ?? [];
    const demote = (workload: SemanticWorkloadV5): SemanticWorkloadV5 => {
      // A positive match (completed / remaining / scope_total) binds; only a plan target is a mismatch here.
      if (workload.quantityRole !== 'target') return workload;
      // A typed restatement of an accepted workload is a replay, not an answer: it is left exactly as it is.
      if (active.workloads.some((existing) => existing.taskId === held.ownerTaskId
        && existing.quantityRole === workload.quantityRole && existing.amount === workload.amount
        && existing.unitCode === workload.unitCode && existing.perOccurrence === workload.perOccurrence)) return workload;
      demoted += 1;
      return { ...workload, quantityRole: 'declared' };
    };
    let workloads = task.workloads.map(demote);
    const nextComponents = components.map((component) => ({ ...component, workloads: component.workloads.map(demote) }));
    const keepsPlanWork = [...workloads, ...nextComponents.flatMap((component) => component.workloads)]
      .some((workload) => workload.quantityRole === 'remaining');
    let efforts = task.effortEstimates;
    // A bare total on the task itself (not the cost of a quantity) would be projected into a future target budget.
    if (!hasAcceptedWorkload && !keepsPlanWork) {
      const budgets = task.effortEstimates.filter((estimate) => estimate.kind === 'total_duration'
        && estimate.targetLocalId === task.localId && Number.isFinite(estimate.minutes) && estimate.minutes > 0);
      if (budgets.length > 0) {
        efforts = task.effortEstimates.filter((estimate) => !budgets.includes(estimate));
        workloads = [...workloads, ...budgets.map((budget): SemanticWorkloadV5 => ({
          localId: `${budget.localId}-declared`, quantityRole: 'declared', amount: budget.minutes, unitCode: 'minute', unitLabel: '分',
          rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: budget.sourceText,
        } as SemanticWorkloadV5))];
        demoted += budgets.length;
      }
    }
    return {
      ...task,
      workloads,
      effortEstimates: efforts,
      ...(task.study ? { study: { ...task.study, components: nextComponents } } : {}),
    };
  });
  return demoted === 0 ? { document, demoted: 0 } : { document: { ...document, tasks }, demoted };
}

/**
 * A later, typed restatement of a declared amount with its role (the user's own answer to the role confirmation, read as an
 * ordinary workload: same amount and unit, role `target`/`completed`/`remaining`) settles the declared fact: the reading gets a
 * typed `replace` correction (declared -> the restated workload), never a guess. Interaction only; the held role confirmation
 * stays answerable after the graph moved on (a session length, another turn).
 */
export function settleDeclaredAmountsV5(params: {
  graph: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  /** Declared amounts the contextual role answer already owns (the pending question's target): never settled twice. */
  excludeWorkloadFactId?: string | null;
}): { document: WeeklyPlanningSemanticDocumentV5; settled: number } {
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(params.graph);
  const declaredAll = active.workloads.filter((workload) => workload.quantityRole === 'declared'
    && workload.id !== params.excludeWorkloadFactId && (workload.unitCode === 'minute' || workload.unitCode === 'hour'));
  if (declaredAll.length === 0) return { document: params.document, settled: 0 };
  const corrections = [...params.document.corrections];
  const taken = new Set(corrections.map((correction) => correction.target.publicId));
  let settled = 0;
  for (const task of params.document.tasks) {
    if (!task.existingPublicId) continue;
    const declared = declaredAll.filter((workload) => workload.taskId === task.existingPublicId);
    for (const workload of task.workloads) {
      if (workload.quantityRole !== 'target' && workload.quantityRole !== 'completed' && workload.quantityRole !== 'remaining') continue;
      const match = declared.find((candidate) => !taken.has(candidate.id)
        && candidate.amount === workload.amount && candidate.unitCode === workload.unitCode);
      if (!match) continue;
      taken.add(match.id);
      corrections.push({
        localId: `settle-${workload.localId}`,
        target: { kind: 'workload', publicId: match.id, localId: null, mention: null },
        operation: 'replace',
        replacementLocalId: workload.localId,
        sourceText: workload.sourceText,
      } as unknown as (typeof corrections)[number]);
      settled += 1;
    }
  }
  return settled === 0 ? { document: params.document, settled: 0 } : { document: { ...params.document, corrections }, settled };
}
