import type {
  ExamPrepScope,
  PlanningIntakeState,
  WeeklyPlanningIntakeContext,
} from './weeklyPlanningIntakeTypes';
import {
  parseMarkCompletedUnitsCommand,
  parseMarkCompletionTargetCommands,
  parseNoteProgressBoundaryCommand,
} from './weeklyPlanningCompletionParsing';
import {
  toLifeConstraintFromAddFixedEventCommand,
  toLifeConstraintFromAddUnavailableCommand,
  toLifeConstraintFromUpdateLifeConstraintCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
  toPriorityPolicyFromSetPriorityPolicyCommand,
  toStudyProgressFromMarkCompletedUnitsCommand,
  toStudyProgressFromMarkCompletionTargetCommand,
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

function mergeExamPrepScopeForCommand(
  previousScope: ExamPrepScope | undefined,
  commandScope: ExamPrepScope,
): ExamPrepScope {
  const totalFields = commandScope.totalFields ?? previousScope?.totalFields;
  const totalYears = commandScope.totalYears ?? previousScope?.totalYears;
  const fields = commandScope.fields.length > 0
    ? commandScope.fields
    : previousScope?.fields ?? [];

  return {
    examType: commandScope.examType ?? previousScope?.examType,
    fields,
    totalFields,
    totalYears,
    yearRange: commandScope.yearRange ?? previousScope?.yearRange,
    strategyHint: commandScope.strategyHint ?? previousScope?.strategyHint,
    unitModel: commandScope.unitModel ?? previousScope?.unitModel,
    unitCountHint: commandScope.unitCountHint
      ?? (totalFields && totalYears ? totalFields * totalYears : previousScope?.unitCountHint),
    rawText: uniqueList([
      ...(previousScope?.rawText ?? []),
      ...commandScope.rawText,
    ]),
  };
}

function removeMissingForLifeConstraint(
  missing: PlanningIntakeState['missing'],
  kind: Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'],
): PlanningIntakeState['missing'] {
  const keysToRemove: PlanningIntakeState['missing'] = [];

  if (kind === 'sleep' || kind === 'buffer') {
    keysToRemove.push('sleep_cycle');
  }

  if (kind === 'meal' || kind === 'bath') {
    keysToRemove.push('meal_bath_constraints');
  }

  let nextMissing = removeMissing(missing, keysToRemove);

  if (!nextMissing.includes('sleep_cycle') && !nextMissing.includes('meal_bath_constraints')) {
    nextMissing = removeMissing(nextMissing, ['life_constraints']);
  }

  return nextMissing;
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

function upsertCompletionTargetProgress(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'mark_completion_target' }>,
  field: string | undefined,
): PlanningIntakeState {
  const commandProgress = {
    ...toStudyProgressFromMarkCompletionTargetCommand(command),
    field,
  };
  const progressIndex = state.progress.findIndex((progress) => progress.field === field);
  const existingProgress = progressIndex >= 0
    ? state.progress[progressIndex]
    : {
        field,
        ambiguity: 'none' as const,
        rawText: command.sourceSegment ?? command.sourceText,
      };
  const updatedProgress = {
    ...existingProgress,
    ...commandProgress,
    completedYears: existingProgress.completedYears,
    ambiguity: 'none' as const,
    rawText: command.sourceSegment ?? command.sourceText,
  };

  return {
    ...state,
    progress: progressIndex >= 0
      ? [
          ...state.progress.slice(0, progressIndex),
          updatedProgress,
          ...state.progress.slice(progressIndex + 1),
        ]
      : [...state.progress, updatedProgress],
  };
}

function resolveCompletionTargetMissing(
  state: PlanningIntakeState,
): PlanningIntakeState['missing'] {
  const fields = state.examPrepScope?.fields ?? [];
  const targetedFields = new Set(
    state.progress
      .filter((progress) => progress.field && progress.completionTarget)
      .map((progress) => progress.field as string),
  );

  if (targetedFields.size === 0 || fields.length === 0) {
    return removeMissing(state.missing, ['progress']);
  }

  const missingTargetFields = fields.filter((field) => !targetedFields.has(field));
  return missingTargetFields.length > 0
    ? addMissing(state.missing, ['progress'])
    : removeMissing(state.missing, ['progress']);
}

function applyMarkCompletionTargetCommand(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'mark_completion_target' }>,
): PlanningIntakeState {
  const fields = command.field
    ? [command.field]
    : state.examPrepScope?.fields.length
      ? state.examPrepScope.fields
      : [undefined];
  const nextState = fields.reduce(
    (currentState, field) => upsertCompletionTargetProgress(currentState, command, field),
    state,
  );
  const assumptions = command.target.kind === 'up_to_reachable'
    ? uniqueList([
        ...nextState.assumptions,
        'できるところまでを仮の completion target として扱います。',
      ])
    : nextState.assumptions;

  return {
    ...nextState,
    assumptions,
    missing: resolveCompletionTargetMissing(nextState),
  };
}

function applyUseConstraintSourceCommand(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'use_constraint_source' }>,
): PlanningIntakeState {
  // ソースの利用可否検証は validator(capability snapshot 参照)で済んでいる前提。
  // ここでは「どのソースを利用中か」を記録し、fixed_events を充足するだけ。
  const ref = { kind: command.source.kind, selector: command.source.selector };
  const inUse = state.constraintSourcesInUse ?? [];
  const alreadyInUse = inUse.some((source) => source.kind === ref.kind && source.selector === ref.selector);

  return {
    ...state,
    constraintSourcesInUse: alreadyInUse ? inUse : [...inUse, ref],
    missing: removeMissing(state.missing, ['fixed_events']),
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
        missing: removeMissingForLifeConstraint(state.missing, command.kind),
      };
    case 'use_constraint_source':
      return applyUseConstraintSourceCommand(state, command);
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
    case 'mark_completion_target':
      return applyMarkCompletionTargetCommand(state, command);
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
      const examPrepScope = mergeExamPrepScopeForCommand(state.examPrepScope, command.scope);
      const nextState = {
        ...state,
        intent: examPrepScope.examType === '院試' ? 'exam_prep_planning' : state.intent,
        examPrepScope,
        missing: removeMissing(state.missing, ['tasks_or_goals']),
      };

      let nextMissing = nextState.missing;
      if (examPrepScope.totalYears && !examPrepScope.yearRange) {
        nextMissing = addMissing(nextMissing, ['year_range']);
      }
      if (examPrepScope.yearRange) {
        nextMissing = removeMissing(nextMissing, ['year_range']);
      }
      if (examPrepScope.unitModel === 'year_field_chunk' && nextState.unitRates.length === 0) {
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
  fallbackProgressCount: number;
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
  let fallbackProgressCount = 0;
  let nextState: PlanningIntakeState = {
    ...baseState,
    tasks: baseState.tasks.map((task) => ({ ...task })),
    progress: baseState.progress.map((progress) => ({
      ...progress,
      completedYears: progress.completedYears ? [...progress.completedYears] : undefined,
      incomplete: progress.incomplete ? [...progress.incomplete] : undefined,
      completionTarget: progress.completionTarget ? { ...progress.completionTarget } : undefined,
    })),
    unitRates: baseState.unitRates.map((unitRate) => ({ ...unitRate })),
    constraints: baseState.constraints.map((constraint) => ({ ...constraint })),
    constraintSourcesInUse: baseState.constraintSourcesInUse
      ? baseState.constraintSourcesInUse.map((source) => ({ ...source }))
      : undefined,
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
    deterministicCommandCount,
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
