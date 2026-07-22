import type { PlanningIntakeState, WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import {
  parseMarkCompletedUnitsCommand,
  parseMarkCompletionTargetCommands,
  parseNoteProgressBoundaryCommand,
} from './weeklyPlanningCompletionParsing';
import { parseConstraintCommands, parseNoteNoFixedEventsCommand } from './weeklyPlanningConstraintParsing';
import { parseAddUnavailableCommands } from './weeklyPlanningUnavailableParsing';
import { finalizeState } from './weeklyPlanningMissingStatus';
import { parseSetPriorityPolicyCommand } from './weeklyPlanningPriorityParsing';
import {
  parseBeginWeeklyPlanningCommand,
  parseSetExamScopeCommand,
  parseSetPendingPlanningRangeCommand,
  parseSetPlanningRangeCommand,
} from './weeklyPlanningScopeParsing';
import {
  parseBareDurationAsUnitRateCommand,
  parseSetUnitRateCommand,
} from './weeklyPlanningUnitRateParsing';
import { parseNoteUncertaintyCommand } from './weeklyPlanningUncertaintyParsing';
import { applyLegacyWeeklyPlanningFallback } from './weeklyPlanningLegacyFallback';
import {
  applyWeeklyPlanningCommands,
  beginWeeklyPlanningUserTurn,
  createInitialPlanningIntakeState,
} from './weeklyPlanningIntakeReducer';

function parseWeeklyPlanningCommands(params: {
  userText: string;
  context: WeeklyPlanningIntakeContext;
  state: PlanningIntakeState;
}): ParsedWeeklyPlanningCommand[] {
  const effectiveScope = params.state.examPrepScope;
  const fields = effectiveScope?.fields ?? [];
  const currentPriorityOrder = params.state.priorityPolicy.kind === 'field_first'
    ? params.state.priorityPolicy.order
    : [];
  const explicitUnitRateCommand = parseSetUnitRateCommand(params.userText, effectiveScope);
  const shortAnswerUnitRateCommand = explicitUnitRateCommand
    ? undefined
    : params.state.missing.includes('unit_duration_estimate')
      ? parseBareDurationAsUnitRateCommand(params.userText)
      : undefined;
  const optionalCommands: Array<ParsedWeeklyPlanningCommand | undefined> = [
    parseSetPriorityPolicyCommand(params.userText, fields, currentPriorityOrder),
    parseMarkCompletedUnitsCommand(
      params.userText,
      effectiveScope?.yearRange,
      fields,
    ),
    ...parseMarkCompletionTargetCommands(
      params.userText,
      effectiveScope?.yearRange,
      fields,
    ),
    explicitUnitRateCommand,
    shortAnswerUnitRateCommand,
    parseNoteNoFixedEventsCommand(params.userText),
    parseNoteUncertaintyCommand(params.userText),
  ];

  return [
    ...optionalCommands.filter((command): command is ParsedWeeklyPlanningCommand => Boolean(command)),
    ...parseAddUnavailableCommands(params.userText, params.context),
    ...parseConstraintCommands(params.userText, params.context),
  ];
}

export interface WeeklyPlanningUserTurnDiagnostics {
  state: PlanningIntakeState;
  deterministicCommandCount: number;
  fallbackProgressCount: number;
  missingBefore: PlanningIntakeState['missing'];
  missingAfter: PlanningIntakeState['missing'];
}

function applyDeterministicWeeklyPlanningUserTurnCore(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): { state: PlanningIntakeState; deterministicCommandCount: number } {
  let deterministicCommandCount = 0;
  let nextState = beginWeeklyPlanningUserTurn(previousState, userText);

  const setupCommands: ParsedWeeklyPlanningCommand[] = [];
  const expectedSlot = previousState?.lastQuestionContext?.targetSlot;
  const planningRangeCommand = parseSetPlanningRangeCommand(
    userText,
    context,
    nextState.pendingPlanningRange,
    expectedSlot,
  );
  if (planningRangeCommand) {
    setupCommands.push(planningRangeCommand);
  } else {
    const allowBareNamedFuturePeriodAnswer = Boolean(
      previousState?.missing.includes('planning_period')
      && !previousState.pendingPlanningRange,
    );
    const pendingPlanningRangeCommand = parseSetPendingPlanningRangeCommand(
      userText,
      context,
      {
        allowBareNamedFuturePeriodAnswer,
        pending: nextState.pendingPlanningRange,
        expectedSlot,
      },
    );
    if (pendingPlanningRangeCommand) setupCommands.push(pendingPlanningRangeCommand);
  }
  const beginCommand = parseBeginWeeklyPlanningCommand(userText);
  if (beginCommand) setupCommands.push(beginCommand);
  const examScopeCommand = parseSetExamScopeCommand(userText, nextState.examPrepScope);
  if (examScopeCommand) setupCommands.push(examScopeCommand);

  deterministicCommandCount += setupCommands.length;
  nextState = applyWeeklyPlanningCommands(nextState, setupCommands);
  const fields = nextState.examPrepScope?.fields ?? [];
  const progressBoundaryCommand = parseNoteProgressBoundaryCommand(userText, fields);
  if (progressBoundaryCommand) {
    deterministicCommandCount += 1;
    nextState = applyWeeklyPlanningCommands(nextState, [progressBoundaryCommand]);
  }

  const turnCommands = parseWeeklyPlanningCommands({ userText, context, state: nextState });
  deterministicCommandCount += turnCommands.length;
  nextState = applyWeeklyPlanningCommands(nextState, turnCommands);
  return { state: nextState, deterministicCommandCount };
}

export function applyDeterministicWeeklyPlanningUserTurn(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): PlanningIntakeState {
  return finalizeState(
    applyDeterministicWeeklyPlanningUserTurnCore(previousState, userText, context).state,
  );
}

export function applyWeeklyPlanningUserTurnWithDiagnostics(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): WeeklyPlanningUserTurnDiagnostics {
  const baseState = previousState ?? createInitialPlanningIntakeState();
  const missingBefore = [...baseState.missing];
  let fallbackProgressCount = 0;
  const deterministicTurn = applyDeterministicWeeklyPlanningUserTurnCore(
    previousState,
    userText,
    context,
  );
  let nextState = deterministicTurn.state;

  const tasksBeforeFallback = nextState.tasks.map((task) => [
    task.title,
    task.subject ?? '',
    task.unit,
    task.amount ?? '',
    task.rawText,
  ].join('\u001f'));
  nextState = applyLegacyWeeklyPlanningFallback({
    state: nextState,
    previousState,
    userText,
    context,
  });
  const tasksAfterFallback = nextState.tasks.map((task) => [
    task.title,
    task.subject ?? '',
    task.unit,
    task.amount ?? '',
    task.rawText,
  ].join('\u001f'));
  if (tasksAfterFallback.length > 0 && tasksAfterFallback.join('\u001e') !== tasksBeforeFallback.join('\u001e')) {
    fallbackProgressCount += 1;
  }

  const finalizedState = finalizeState(nextState);
  return {
    state: finalizedState,
    deterministicCommandCount: deterministicTurn.deterministicCommandCount,
    fallbackProgressCount,
    missingBefore,
    missingAfter: [...finalizedState.missing],
  };
}

export function applyWeeklyPlanningUserTurn(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): PlanningIntakeState {
  return applyWeeklyPlanningUserTurnWithDiagnostics(previousState, userText, context).state;
}
