import {
  assessWeeklyPlanningRequest,
  looksLikeWeeklyPlanningRequest,
  mergeWeeklyPlanningRevision,
} from '../weeklyPlanningTransforms';
import type { SimpleWeeklyTask } from '../weeklyPlanningTypes';
import type {
  PlanningIntakeState,
  StudyScopeUnit,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import { addMissing, removeMissing } from './weeklyPlanningMissingStatus';
import { parseConstraintCommands } from './weeklyPlanningConstraintParsing';
import { parseAddUnavailableCommands } from './weeklyPlanningUnavailableParsing';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';
import { normalizeStudyTaskTitle } from './weeklyPlanningTaskIdentity';

function mapWeeklyAmountUnit(unit: string): StudyScopeUnit {
  switch (unit) {
    case "minutes":
    case "words":
    case "pages":
    case "problems":
      return unit;
    case "passages":
      return "lessons";
    case "chapter":
      return "chapters";
    case "items":
    case "material":
    case "years":
    default:
      return "unknown";
  }
}

function toPlanningTasks(tasks: SimpleWeeklyTask[]): PlanningIntakeState['tasks'] {
  return tasks.map((task) => ({
    title: task.title,
    subject: task.title,
    unit: mapWeeklyAmountUnit(task.amount.unit),
    amount: task.amount.value,
    rawText: task.sourceText,
    requiresTimeEstimate: task.requiresTimeEstimate,
    source: 'legacy_fallback',
  }));
}

function mergeLegacyTasks(
  currentTasks: PlanningIntakeState['tasks'],
  parsedLegacyTasks: PlanningIntakeState['tasks'],
): PlanningIntakeState['tasks'] {
  const commandTasks = currentTasks.filter((task) => task.source === 'command');
  const commandIdentities = new Set(
    commandTasks.map((task) => normalizeStudyTaskTitle(task.title)),
  );
  const legacyTasksByIdentity = new Map<string, PlanningIntakeState['tasks'][number]>();

  parsedLegacyTasks.forEach((task) => {
    const identity = normalizeStudyTaskTitle(task.title);
    if (!commandIdentities.has(identity)) {
      legacyTasksByIdentity.set(identity, task);
    }
  });

  return [...commandTasks, ...legacyTasksByIdentity.values()];
}

function consumedConstraintSourceSegments(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string[] {
  const commands = [
    ...parseConstraintCommands(text, context),
    ...parseAddUnavailableCommands(text, context),
  ];

  return Array.from(new Set(commands.map((command) =>
    ('sourceSegment' in command && typeof command.sourceSegment === 'string'
      ? command.sourceSegment
      : command.sourceText),
  ).filter(Boolean)));
}

function removeConsumedConstraintText(
  text: string,
  context: WeeklyPlanningIntakeContext,
): string {
  return consumedConstraintSourceSegments(text, context).reduce(
    (remainingText, sourceSegment) => remainingText.split(sourceSegment).join(''),
    normalizeIntakeText(text),
  );
}

function shouldApplyFirstAssessFallback(state: PlanningIntakeState, userText: string): boolean {
  return state.intent === 'unknown' && looksLikeWeeklyPlanningRequest(userText);
}

// previousState truthiness is part of the current behavior. The pipeline can
// pass a truthy initial state even for a first user-visible turn.
function shouldApplyRevisionMergeFallback(
  previousState: PlanningIntakeState | undefined,
  state: PlanningIntakeState,
): boolean {
  return Boolean(previousState) && state.intent === 'weekly_study_planning';
}

function applyFirstAssessFallback(params: {
  state: PlanningIntakeState;
  userText: string;
  context: WeeklyPlanningIntakeContext;
}): PlanningIntakeState {
  const assessment = assessWeeklyPlanningRequest({
    selectedDate: params.context.selectedDate,
    text: removeConsumedConstraintText(params.userText, params.context),
  });

  return {
    ...params.state,
    intent: 'weekly_study_planning',
    tasks: mergeLegacyTasks(params.state.tasks, toPlanningTasks(assessment.tasks)),
    missing: assessment.kind === 'ready'
      ? params.state.missing
      : addMissing(params.state.missing, ['life_constraints']),
  };
}

function applyRevisionMergeFallback(params: {
  state: PlanningIntakeState;
  previousState: PlanningIntakeState;
  userText: string;
  context: WeeklyPlanningIntakeContext;
}): PlanningIntakeState {
  const revision = mergeWeeklyPlanningRevision({
    selectedDate: params.context.selectedDate,
    previousText: params.previousState.tasks
      .filter((task) => task.source === 'legacy_fallback')
      .map((task) => task.rawText)
      .join('、'),
    revisionText: removeConsumedConstraintText(params.userText, params.context),
  });

  if (revision.tasks.length === 0 || params.state.examPrepScope) {
    return params.state;
  }

  return {
    ...params.state,
    tasks: mergeLegacyTasks(params.state.tasks, toPlanningTasks(revision.tasks)),
    missing: removeMissing(params.state.missing, ['tasks_or_goals']),
  };
}

export function applyLegacyWeeklyPlanningFallback(params: {
  state: PlanningIntakeState;
  previousState: PlanningIntakeState | undefined;
  userText: string;
  context: WeeklyPlanningIntakeContext;
}): PlanningIntakeState {
  const { previousState, userText, context } = params;
  const nextState = params.state;

  // TODO(Phase 9.8): keep the legacy weekly parser fallback isolated until the normal/weekly route regression set is expanded.
  if (shouldApplyFirstAssessFallback(nextState, userText)) {
    return applyFirstAssessFallback({
      state: nextState,
      userText,
      context,
    });
  }

  if (shouldApplyRevisionMergeFallback(previousState, nextState)) {
    return applyRevisionMergeFallback({
      state: nextState,
      previousState: previousState as PlanningIntakeState,
      userText,
      context,
    });
  }

  return nextState;
}
