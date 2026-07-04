import type {
  PlanningIntakeState,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  parseMarkCompletedUnitsCommand,
  parseNoteProgressBoundaryCommand,
} from './weeklyPlanningCompletionParsing';
import {
  toLifeConstraintFromAddFixedEventCommand,
  toLifeConstraintFromAddUnavailableCommand,
  toLifeConstraintFromUpdateLifeConstraintCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
  toPriorityPolicyFromSetPriorityPolicyCommand,
  toStudyProgressFromMarkCompletedUnitsCommand,
  toStudyProgressFromNoteProgressBoundaryCommand,
  toUncertaintyFromNoteUncertaintyCommand,
  toUnitRateFromSetUnitRateCommand,
} from './weeklyPlanningCommandAdapter';
import { mergeLifeConstraints } from './weeklyPlanningConstraintIdentity';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import { parseConstraintCommands, parseNoteNoFixedEventsCommand } from './weeklyPlanningConstraintParsing';
import { parseAddUnavailableCommands } from './weeklyPlanningUnavailableParsing';
import { addMissing, finalizeState, removeMissing } from './weeklyPlanningMissingStatus';
import { parseSetPriorityPolicyCommand } from './weeklyPlanningPriorityParsing';
import { parseSetExamScopeCommand, parseSetPlanningRangeCommand } from './weeklyPlanningScopeParsing';
import { uniqueList } from './weeklyPlanningTextParsing';
import {
  parseBareDurationAsUnitRateCommand,
  parseSetUnitRateCommand,
} from './weeklyPlanningUnitRateParsing';
import { parseNoteUncertaintyCommand } from './weeklyPlanningUncertaintyParsing';
import { applyLegacyWeeklyPlanningFallback } from './weeklyPlanningLegacyFallback';

const DEFAULT_PRIORITY_POLICY = { kind: 'unknown' } as const;

export function createInitialPlanningIntakeState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'unknown',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: DEFAULT_PRIORITY_POLICY,
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: [],
  };
}

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

function applyMarkCompletedUnitsCommand(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'mark_completed_units' }>,
): PlanningIntakeState {
  const commandProgress = toStudyProgressFromMarkCompletedUnitsCommand(command);

  if (command.mergeMode === 'replace') {
    if (state.progress.length === 0) {
      return state;
    }

    let progressIndex = -1;

    for (let index = state.progress.length - 1; index >= 0; index -= 1) {
      if (state.progress[index].field === command.field) {
        progressIndex = index;
        break;
      }
    }

    const targetIndex = progressIndex >= 0 ? progressIndex : state.progress.length - 1;
    const targetProgress = state.progress[targetIndex];
    const updatedProgress = {
      ...targetProgress,
      ...commandProgress,
    };

    return {
      ...state,
      progress: [
        ...state.progress.slice(0, targetIndex),
        updatedProgress,
        ...state.progress.slice(targetIndex + 1),
      ],
      missing: removeMissing(state.missing, ['completion_direction']),
    };
  }

  const progressIndex = state.progress.findIndex((progress) => progress.field === command.field);
  const existingProgress =
    progressIndex >= 0
      ? state.progress[progressIndex]
      : {
          field: command.field,
          ambiguity: 'none' as const,
          rawText: command.sourceSegment ?? command.sourceText,
        };
  const updatedProgress = {
    ...existingProgress,
    field: command.field,
    completedYears: uniqueList([
      ...(existingProgress.completedYears ?? []),
      ...command.completedYears,
    ]),
    ambiguity: 'none' as const,
    rawText: command.sourceSegment ?? command.sourceText,
  };

  return {
    ...state,
    progress:
      progressIndex >= 0
        ? [
            ...state.progress.slice(0, progressIndex),
            updatedProgress,
            ...state.progress.slice(progressIndex + 1),
          ]
        : [...state.progress, updatedProgress],
    missing: removeMissing(state.missing, ['completion_direction']),
  };
}

function applyWeeklyPlanningCommand(
  state: PlanningIntakeState,
  command: ParsedWeeklyPlanningCommand,
): PlanningIntakeState {
  switch (command.type) {
    case 'add_unavailable':
      return {
        ...state,
        constraints: mergeLifeConstraints(state.constraints, [
          toLifeConstraintFromAddUnavailableCommand(command),
        ]),
      };
    case 'add_fixed_event':
      return {
        ...state,
        constraints: mergeLifeConstraints(state.constraints, [
          toLifeConstraintFromAddFixedEventCommand(command),
        ]),
        missing: command.event.hardness === 'hard'
          ? removeMissing(state.missing, ['fixed_events'])
          : state.missing,
      };
    case 'update_life_constraint':
      return {
        ...state,
        constraints: mergeLifeConstraints(state.constraints, [
          toLifeConstraintFromUpdateLifeConstraintCommand(command),
        ]),
        missing: removeMissing(state.missing, [
          'sleep_cycle',
          'meal_bath_constraints',
          'life_constraints',
        ]),
      };
    case 'set_priority_policy':
      return {
        ...state,
        priorityPolicy: toPriorityPolicyFromSetPriorityPolicyCommand(command),
        missing: removeMissing(state.missing, [
          'priority_policy',
          'next_field_after_math',
        ]),
      };
    case 'mark_completed_units':
      return applyMarkCompletedUnitsCommand(state, command);
    case 'note_progress_boundary':
      return {
        ...state,
        progress: [
          ...state.progress,
          toStudyProgressFromNoteProgressBoundaryCommand(command),
        ],
        missing: addMissing(state.missing, ['completion_direction']),
      };
    case 'note_uncertainty':
      return {
        ...state,
        uncertainties: uniqueList([
          ...state.uncertainties,
          toUncertaintyFromNoteUncertaintyCommand(command),
        ]),
      };
    case 'note_no_fixed_events':
      return {
        ...state,
        missing: removeMissing(state.missing, ['fixed_events']),
      };
    case 'set_unit_rate': {
      const unitRate = toUnitRateFromSetUnitRateCommand(command);
      return {
        ...state,
        unitRates: [
          ...state.unitRates.filter((rate) => rate.unit !== unitRate.unit),
          unitRate,
        ],
        missing: removeMissing(state.missing, ['unit_duration_estimate']),
      };
    }
    case 'set_exam_scope': {
      const nextState = {
        ...state,
        intent: command.scope.examType === '院試' ? 'exam_prep_planning' : state.intent,
        examPrepScope: command.scope,
        missing: removeMissing(state.missing, ['tasks_or_goals']),
      };

      let nextMissing = nextState.missing;
      if (command.scope.totalYears && !command.scope.yearRange) {
        nextMissing = addMissing(nextMissing, ['year_range']);
      }
      if (command.scope.yearRange) {
        nextMissing = removeMissing(nextMissing, ['year_range']);
      }
      if (command.scope.unitModel === 'year_field_chunk' && nextState.unitRates.length === 0) {
        nextMissing = addMissing(nextMissing, ['unit_duration_estimate']);
      }

      return {
        ...nextState,
        missing: nextMissing,
      };
    }
    case 'set_planning_range':
      return {
        ...state,
        intent: 'weekly_study_planning',
        range: toPlanningRangeFromSetPlanningRangeCommand(command),
        missing: addMissing(state.missing, [
          'tasks_or_goals',
          'fixed_events',
          'sleep_cycle',
          'meal_bath_constraints',
        ]),
      };
    default:
      return state;
  }
}

export function applyWeeklyPlanningCommands(
  state: PlanningIntakeState,
  commands: ParsedWeeklyPlanningCommand[],
): PlanningIntakeState {
  return commands.reduce(applyWeeklyPlanningCommand, state);
}

export interface WeeklyPlanningUserTurnDiagnostics {
  state: PlanningIntakeState;
  deterministicCommandCount: number;
  missingBefore: PlanningIntakeState['missing'];
  missingAfter: PlanningIntakeState['missing'];
}

export function applyWeeklyPlanningUserTurnWithDiagnostics(
  previousState: PlanningIntakeState | undefined,
  userText: string,
  context: WeeklyPlanningIntakeContext,
): WeeklyPlanningUserTurnDiagnostics {
  const baseState = previousState ?? createInitialPlanningIntakeState();
  const missingBefore = [...baseState.missing];
  let deterministicCommandCount = 0;
  let nextState: PlanningIntakeState = {
    ...baseState,
    tasks: baseState.tasks.map((task) => ({ ...task })),
    progress: baseState.progress.map((progress) => ({
      ...progress,
      completedYears: progress.completedYears ? [...progress.completedYears] : undefined,
      incomplete: progress.incomplete ? [...progress.incomplete] : undefined,
    })),
    unitRates: baseState.unitRates.map((unitRate) => ({ ...unitRate })),
    constraints: baseState.constraints.map((constraint) => ({ ...constraint })),
    missing: [...baseState.missing],
    assumptions: [...baseState.assumptions],
    uncertainties: [...baseState.uncertainties],
    questions: [],
    sourceTurns: [...baseState.sourceTurns, userText],
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };

  const setupCommands: ParsedWeeklyPlanningCommand[] = [];
  const planningRangeCommand = parseSetPlanningRangeCommand(userText, context);
  if (planningRangeCommand) {
    setupCommands.push(planningRangeCommand);
  }
  const examScopeCommand = parseSetExamScopeCommand(userText, nextState.examPrepScope);
  if (examScopeCommand) {
    setupCommands.push(examScopeCommand);
  }

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
  nextState = applyWeeklyPlanningCommands(
    nextState,
    turnCommands,
  );


  nextState = applyLegacyWeeklyPlanningFallback({
    state: nextState,
    previousState,
    userText,
    context,
  });

  const finalizedState = finalizeState(nextState);

  return {
    state: finalizedState,
    deterministicCommandCount,
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
