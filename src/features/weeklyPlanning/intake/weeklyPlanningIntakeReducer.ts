import type { ExamPrepScope, PlanningIntakeState } from './weeklyPlanningIntakeTypes';
import {
  toLifeConstraintFromAddFixedEventCommand,
  toLifeConstraintFromAddUnavailableCommand,
  toLifeConstraintFromUpdateLifeConstraintCommand,
  toPlanningRangeFromSetPlanningRangeCommand,
  toPriorityPolicyFromSetPriorityPolicyCommand,
  toStudyProgressFromMarkCompletedUnitsCommand,
  toStudyProgressFromMarkCompletionTargetCommand,
  toStudyProgressFromNoteProgressBoundaryCommand,
  toStudyTaskScopeFromSetStudyGoalCommand,
  toUncertaintyFromNoteUncertaintyCommand,
  toUnitRateFromSetUnitRateCommand,
} from './weeklyPlanningCommandAdapter';
import { mergeLifeConstraints } from './weeklyPlanningConstraintIdentity';
import type { ParsedWeeklyPlanningCommand } from './weeklyPlanningCommandTypes';
import { addMissing, deriveMissingForPlanningRange, removeMissing } from './weeklyPlanningMissingStatus';
import { studyGoalIdentity } from './weeklyPlanningTaskIdentity';
import {
  reduceDraftGenerationAuthorization,
  validateDraftGenerationAuthorizationCommand,
} from '../planning/weeklyPlanningDraftGenerationAuthorization';
import { resolveRelativeConstraints } from '../planning/weeklyPlanningRelativeConstraints';

const DEFAULT_PRIORITY_POLICY = { kind: 'unknown' } as const;

function uniqueList<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function createInitialPlanningIntakeState(): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'unknown',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    studyTimePreferences: [],
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

function relativeConstraintTargetIndex(anchorRef: string): number | null {
  const match = /^constraint:(\d+)$/.exec(anchorRef);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function applyAddRelativeConstraintCommand(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'add_relative_constraint' }>,
): PlanningIntakeState {
  const index = relativeConstraintTargetIndex(command.anchorRef);
  const anchorConstraint = index === null ? undefined : state.constraints[index];
  if (!anchorConstraint?.date || !anchorConstraint.start || !anchorConstraint.end) return state;

  const stateRevision = state.sourceTurns.length;
  const resolution = resolveRelativeConstraints({
    constraints: [{
      relationId: `relative-command:${stateRevision}:${index}:${command.relation}`,
      anchorFactRef: command.anchorRef,
      relation: command.relation,
      offsetMinutes: command.offsetMinutes,
      durationMinutes: command.durationMinutes,
      sourceFactRefs: [command.anchorRef, `turn:${stateRevision}`],
      stateRevision,
      confidence: command.confidence,
    }],
    anchors: [{
      factRef: command.anchorRef,
      eventId: `constraint-event:${index}`,
      date: anchorConstraint.date,
      startTime: anchorConstraint.start,
      endTime: anchorConstraint.end,
      visibility: 'public',
      stateRevision,
      sourceFactRefs: [command.anchorRef],
    }],
    currentStateRevision: stateRevision,
  });
  const resolved = resolution.resolved[0];
  if (!resolved) return state;

  return {
    ...state,
    constraints: mergeLifeConstraints(state.constraints, [{
      kind: command.kind,
      date: resolved.date,
      start: resolved.startTime,
      end: resolved.endTime,
      hardness: command.relation === 'during_buffer' ? 'hard' : 'soft',
      rawText: command.sourceSegment ?? command.sourceText,
    }]),
    missing: removeMissingForLifeConstraint(state.missing, command.kind),
  };
}

function applyNoteStudyTimePreferenceCommand(
  state: PlanningIntakeState,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'note_study_time_preference' }>,
): PlanningIntakeState {
  const preference = {
    kind: command.preference.kind,
    taskRef: command.preference.taskRef,
    rawText: command.sourceSegment ?? command.sourceText,
    confidence: command.confidence === 'high' ? 'high' as const : 'medium' as const,
  };
  const existing = state.studyTimePreferences ?? [];
  const withoutSameTarget = existing.filter((candidate) =>
    candidate.kind !== preference.kind || candidate.taskRef !== preference.taskRef,
  );
  return {
    ...state,
    studyTimePreferences: [...withoutSameTarget, preference],
  };
}

function mergeExamPrepScopeForCommand(
  previousScope: ExamPrepScope | undefined,
  commandScope: ExamPrepScope,
): ExamPrepScope {
  const totalFields = commandScope.totalFields ?? previousScope?.totalFields;
  const totalYears = commandScope.totalYears ?? previousScope?.totalYears;
  const fields = commandScope.fields.length > 0
    ? uniqueList(commandScope.fields.map((field) => field.trim()).filter(Boolean))
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
    case 'add_relative_constraint':
      return applyAddRelativeConstraintCommand(state, command);
    case 'update_life_constraint':
      return {
        ...state,
        constraints: mergeLifeConstraints(state.constraints, [
          toLifeConstraintFromUpdateLifeConstraintCommand(command),
        ]),
        missing: removeMissingForLifeConstraint(state.missing, command.kind),
      };
    case 'note_study_time_preference':
      return applyNoteStudyTimePreferenceCommand(state, command);
    case 'use_constraint_source':
      return applyUseConstraintSourceCommand(state, command);
    case 'set_priority_policy':
      return {
        ...state,
        priorityPolicy: toPriorityPolicyFromSetPriorityPolicyCommand(command),
        priorityPolicySource: 'user',
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
        fixedEventsDeclaredNone: true,
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
      if (examPrepScope.unitModel === 'year_field_chunk' && !examPrepScope.yearRange) {
        nextMissing = addMissing(nextMissing, ['year_range']);
      }
      if (examPrepScope.yearRange) {
        nextMissing = removeMissing(nextMissing, ['year_range']);
      }
      if (examPrepScope.unitModel === 'year_field_chunk') {
        const hasYearFieldUnitRate = nextState.unitRates.some((rate) =>
          rate.unit === 'year_field_chunk'
          && typeof rate.minutesPerUnit === 'number'
          && Number.isFinite(rate.minutesPerUnit)
          && rate.minutesPerUnit > 0,
        );
        nextMissing = hasYearFieldUnitRate
          ? removeMissing(nextMissing, ['unit_duration_estimate'])
          : addMissing(nextMissing, ['unit_duration_estimate']);
      }

      return {
        ...nextState,
        missing: nextMissing,
      };
    }
    case 'set_planning_range': {
      if (state.range?.confidence === 'explicit' && command.range.confidence !== 'explicit') {
        return state;
      }

      return {
        ...state,
        intent: 'weekly_study_planning',
        range: toPlanningRangeFromSetPlanningRangeCommand(command, false),
        pendingPlanningRange: undefined,
        missing: addMissing(
          removeMissing(state.missing, [
            'planning_start_date',
            'planning_duration',
            'planning_period',
          ]),
          deriveMissingForPlanningRange(state),
        ),
      };
    }
    case 'set_pending_planning_range': {
      const pendingMissing = [
        ...(!command.pending.planningStartDate && !command.pending.planningStartDateTime
          ? ['planning_start_date' as const]
          : []),
        ...(command.pending.durationDays === undefined && !command.pending.planningEndDateTime
          ? ['planning_duration' as const]
          : []),
      ];
      return {
        ...state,
        intent: 'weekly_study_planning',
        pendingPlanningRange: command.pending,
        missing: addMissing(
          removeMissing(state.missing, [
            'planning_start_date',
            'planning_duration',
            'planning_period',
          ]),
          pendingMissing,
        ),
      };
    }
    case 'set_study_goal': {
      const task = toStudyTaskScopeFromSetStudyGoalCommand(command);
      const taskIdentity = studyGoalIdentity(task.title, task.subject);
      const tasks = [
        ...state.tasks.filter(
          (existingTask) => studyGoalIdentity(existingTask.title, existingTask.subject) !== taskIdentity,
        ),
        task,
      ];

      return {
        ...state,
        intent: state.intent === 'unknown' ? 'weekly_study_planning' : state.intent,
        tasks,
        missing: removeMissing(state.missing, ['tasks_or_goals']),
      };
    }
    case 'authorize_draft_generation':
      return reduceDraftGenerationAuthorization(
        state,
        validateDraftGenerationAuthorizationCommand(command),
      );
    case 'begin_weekly_planning': {
      const hasPlanningScope = Boolean(state.range || state.pendingPlanningRange);
      const hasLearningScope = Boolean(state.examPrepScope || state.tasks.length > 0);
      const missingWithoutPeriod = hasPlanningScope
        ? removeMissing(state.missing, ['planning_period'])
        : state.missing;
      const missing = addMissing(
        missingWithoutPeriod,
        [
          ...(!hasPlanningScope ? ['planning_period' as const] : []),
          ...(!hasLearningScope ? ['tasks_or_goals' as const] : []),
        ],
      );

      return {
        ...state,
        intent: state.intent === 'unknown' ? 'weekly_study_planning' : state.intent,
        missing,
      };
    }
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
export function beginWeeklyPlanningUserTurn(
  previousState: PlanningIntakeState | undefined,
  userText: string,
): PlanningIntakeState {
  const baseState = previousState ?? createInitialPlanningIntakeState();

  return {
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
    studyTimePreferences: baseState.studyTimePreferences?.map((preference) => ({ ...preference })),
    constraintSourcesInUse: baseState.constraintSourcesInUse
      ? baseState.constraintSourcesInUse.map((source) => ({ ...source }))
      : undefined,
    pendingPlanningRange: baseState.pendingPlanningRange
      ? {
          ...baseState.pendingPlanningRange,
          scope: { ...baseState.pendingPlanningRange.scope },
        }
      : undefined,
    missing: [...baseState.missing],
    assumptions: [...baseState.assumptions],
    uncertainties: [...baseState.uncertainties],
    questions: [],
    sourceTurns: [...baseState.sourceTurns, userText],
    shouldCreateDraft: false,
    shouldSavePlan: false,
  };
}
