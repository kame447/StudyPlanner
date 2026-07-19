from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:200]!r}')
    target.write_text(text.replace(old, new, 1))


# AI remains the semantic interpreter. These changes only enforce structural
# invariants, readiness consistency, and deterministic rendering correctness.

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
    """function isTime(value: unknown): boolean {
  return typeof value === 'string' && /^([01]?\d|2[0-4]):[0-5]\d$/.test(value);
}
""",
    """function isTime(value: unknown): boolean {
  return typeof value === 'string'
    && /^(?:[01]?\d|2[0-3]):[0-5]\d$|^24:00$/.test(value);
}
""",
)

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts',
    """    case 'set_priority_policy': {
      if (!/優先|順番|先に|から.*(?:進め|やり|解き|始め)/.test(normalized)) {
        return 'ungrounded-priority-policy';
      }
      if (command.policy.kind !== 'field_first') return null;
      const mentionedFields = summary.knownFields.filter((field) =>
        normalizedUser.includes(normalizedEvidence(field)));
      return mentionedFields.length <= 1
        || mentionedFields[0] === command.policy.order[0]
        ? null : 'ungrounded-priority-policy';
    }
""",
    """    case 'set_priority_policy': {
      if (!/優先|順番|先に|から.*(?:進め|やり|解き|始め)|締切|期限|苦手|弱点|配点|均等|バランス/.test(normalized)) {
        return 'ungrounded-priority-policy';
      }
      if (command.policy.kind !== 'field_first') return null;
      const normalizedKnownFields = new Set(summary.knownFields.map(normalizedEvidence));
      const orderIsStructurallyValid = command.policy.order.length > 0
        && new Set(command.policy.order).size === command.policy.order.length
        && (summary.knownFields.length === 0
          || command.policy.order.every((field) => normalizedKnownFields.has(normalizedEvidence(field))));
      return orderIsStructurallyValid ? null : 'ungrounded-priority-policy';
    }
""",
)

replace_once(
    'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
    """  finalizeState,
  hasConfirmedFixedEvents,
  hasConfirmedLifeConstraints,
} from '../intake/weeklyPlanningMissingStatus';
""",
    """  finalizeState,
  hasConfirmedFixedEvents,
  hasConfirmedLifeConstraints,
  hasConfirmedYearFieldUnitRate,
} from '../intake/weeklyPlanningMissingStatus';
""",
)
replace_once(
    'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts',
    """  if (state.unitRates.length > 0) slots.push('unit_duration_estimate');
""",
    """  const hasConfirmedUnitRate = state.examPrepScope?.unitModel === 'year_field_chunk'
    ? hasConfirmedYearFieldUnitRate(state)
    : state.unitRates.some((rate) =>
      typeof rate.minutesPerUnit === 'number'
      && Number.isFinite(rate.minutesPerUnit)
      && rate.minutesPerUnit > 0,
    );
  if (hasConfirmedUnitRate) slots.push('unit_duration_estimate');
""",
)

replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts',
    """const completionDirectionSlot: PlanningQuestionSlotDefinition = {
""",
    """function completionBoundaryYearForQuestion(state: PlanningIntakeState): number | undefined {
  return state.progress.find((progress) =>
    progress.ambiguity === 'completion_direction'
    && typeof progress.completionBoundaryYear === 'number',
  )?.completionBoundaryYear
    ?? state.progress.find((progress) => typeof progress.completionBoundaryYear === 'number')
      ?.completionBoundaryYear;
}

const completionDirectionSlot: PlanningQuestionSlotDefinition = {
""",
)
replace_once(
    'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts',
    """  deterministicQuestion: () =>
    '2021まで完了は、新しい年度から2021までですか？古い年度から2021までですか？',
""",
    """  deterministicQuestion: (state) => {
    const boundaryYear = completionBoundaryYearForQuestion(state);
    return boundaryYear
      ? `${boundaryYear}年度まで完了というのは、新しい年度側から${boundaryYear}年度までですか？古い年度側から${boundaryYear}年度までですか？`
      : '完了済み年度は、新しい年度側からですか？古い年度側からですか？';
  },
""",
)

replace_once(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
    """const CONSTRAINT_SOURCE_LABELS: Record<ConstraintSourceRef['kind'], string> = {
  timetable: '時間割',
  existing_plans: '登録済みの予定',
  calendar: 'カレンダーの予定',
};
""",
    """const CONSTRAINT_SOURCE_LABELS: Record<ConstraintSourceRef['kind'], string> = {
  timetable: '時間割',
  existing_plans: '登録済みの予定',
  calendar: 'カレンダーの予定',
};

const CONSTRAINT_KIND_LABELS: Record<PlanningIntakeState['constraints'][number]['kind'], string> = {
  sleep: '睡眠',
  meal: '食事',
  bath: '入浴',
  commute: '移動',
  club: '部活動',
  cram_school: '塾',
  fixed_event: '固定予定',
  unavailable: '利用不可時間',
  buffer: '準備・休憩',
};
""",
)
replace_once(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
    """  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) =>
      isNewSemanticItem(constraint, previousConstraints, constraintSemanticValue))
    .map((constraint) => [constraint.kind, constraint.date, constraint.start, constraint.end]
      .filter(Boolean)
      .join(' '));
""",
    """  const acceptedConstraintSummary = params.state.constraints
    .filter((constraint) =>
      isNewSemanticItem(constraint, previousConstraints, constraintSemanticValue))
    .map((constraint) => {
      const rawText = constraint.rawText?.trim();
      if (rawText) return rawText;
      const timeRange = constraint.start && constraint.end
        ? `${constraint.start}〜${constraint.end}`
        : constraint.start ?? constraint.end;
      const duration = typeof constraint.durationMinutes === 'number'
        ? `${constraint.durationMinutes}分`
        : undefined;
      return [
        CONSTRAINT_KIND_LABELS[constraint.kind],
        constraint.date,
        timeRange,
        duration,
      ].filter(Boolean).join(' ');
    });
""",
)
replace_once(
    'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts',
    """    input.acceptedFacts.priorityOrder?.length
      ? `優先順は${input.acceptedFacts.priorityOrder.join('、')}`
      : null,
    input.constraintSourcesInUse?.length
""",
    """    input.acceptedFacts.priorityOrder?.length
      ? `優先順は${input.acceptedFacts.priorityOrder.join('、')}`
      : null,
    input.acceptedFacts.constraintSummary?.length
      ? `生活・予定条件は${input.acceptedFacts.constraintSummary.join('、')}`
      : null,
    input.constraintSourcesInUse?.length
""",
)

Path('src/features/weeklyPlanning/__tests__/weeklyPlanningSevenAuditContract.test.ts').write_text("""import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import { renderWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueRenderer';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { finalizeState } from '../intake/weeklyPlanningMissingStatus';
import { QUESTION_SLOT_DEFINITION_BY_MISSING } from '../intake/weeklyPlanningQuestionSlots';
import type {
  InterpretedCommandCandidate,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from '../pipeline/weeklyPlanningIntakePipeline';

function candidate(
  userText: string,
  command: InterpretedCommandCandidate['command'],
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
    sourceUserText: userText,
  };
}

describe('weekly planning seven-audit responsibility contract', () => {
  it('lets AI interpret priority semantics while rejecting fields outside known state', () => {
    const accepted = validateInterpretedCandidates([
      candidate('OSを優先します', {
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['OS', 'ネットワーク'] },
        sourceText: 'OSを優先します',
        confidence: 'high',
      }),
    ], { knownFields: ['OS', 'ネットワーク'], confirmedSlots: [] });
    expect(accepted.accepted).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);

    const rejected = validateInterpretedCandidates([
      candidate('OSを優先します', {
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['数学', 'OS'] },
        sourceText: 'OSを優先します',
        confidence: 'high',
      }),
    ], { knownFields: ['OS', 'ネットワーク'], confirmedSlots: [] });
    expect(rejected.accepted).toEqual([]);
    expect(rejected.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-priority-policy' }),
    ]);
  });

  it('rejects structurally invalid times but leaves constraint meaning to AI', () => {
    const result = validateInterpretedCandidates([
      candidate('夜に予定があります', {
        type: 'add_unavailable',
        range: { start: '24:30', end: '24:45', hardness: 'hard' },
        sourceText: '夜に予定があります',
        confidence: 'high',
      }),
    ], { knownFields: [], confirmedSlots: [] });
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-time' }),
    ]);
  });

  it('does not treat an unrelated unit rate as the requested exam unit rate', async () => {
    const previousState = finalizeState({
      ...createInitialPlanningIntakeState(),
      intent: 'exam_prep_planning',
      examPrepScope: {
        examType: '院試',
        fields: ['OS'],
        totalFields: 1,
        yearRange: { startYear: 2025, endYear: 2025, sourceText: '2025年度' },
        unitModel: 'year_field_chunk',
        rawText: ['院試の過去問はOS'],
      },
      unitRates: [{ unit: 'hours', minutesPerUnit: 120, source: 'user' }],
      missing: ['unit_duration_estimate'],
      lastQuestionContext: { kind: 'missing', targetSlot: 'unit_rate', intent: 'ask_unit_rate' },
    });
    const interpreter: WeeklyPlanningIntakeInterpreter = {
      interpretUserTurn: vi.fn(async () => ({
        candidates: [{
          command: {
            type: 'set_unit_rate',
            unitRate: {
              unit: 'year_field_chunk',
              minutesPerUnit: 180,
              source: 'user',
              rawText: '3時間',
            },
            sourceText: '3時間',
            confidence: 'high',
          },
          origin: 'ai_interpreter',
          needsConfirmation: false,
        }],
        parseRejections: [],
      })),
    };

    const output = await runWeeklyPlanningIntakePipelineWithInterpreter({
      previousState,
      userText: '3時間です',
      planningStartDate: '2026-07-19',
      planningDayCount: 7,
      currentDateTime: '2026-07-19T14:00:00',
      interpreter,
    });

    expect(output.interpreterDiagnostics?.accepted.map((command) => command.type)).toContain('set_unit_rate');
    expect(output.state.unitRates).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: 'year_field_chunk', minutesPerUnit: 180 }),
    ]));
  });

  it('uses the actual ambiguous completion boundary year', () => {
    const state: PlanningIntakeState = {
      ...createInitialPlanningIntakeState(),
      progress: [{
        completionBoundaryYear: 2019,
        ambiguity: 'completion_direction',
        rawText: '2019まで完了',
      }],
      missing: ['completion_direction'],
    };
    expect(
      QUESTION_SLOT_DEFINITION_BY_MISSING.completion_direction.deterministicQuestion(state),
    ).toBe(
      '2019年度まで完了というのは、新しい年度側から2019年度までですか？古い年度側から2019年度までですか？',
    );
  });

  it('acknowledges a life constraint already interpreted by AI', async () => {
    const previousState = createInitialPlanningIntakeState();
    const state: PlanningIntakeState = {
      ...previousState,
      constraints: [{
        kind: 'sleep',
        start: '23:00',
        end: '07:00',
        hardness: 'hard',
        rawText: '23時から7時まで寝ます',
      }],
      missing: ['year_range'],
    };
    const decision: WeeklyPlanningDialogueDecision = {
      kind: 'ask_missing_info',
      messageKey: 'ask_year_range',
      questionPlan: [{
        kind: 'missing_slot',
        targetSlot: 'year_range',
        missing: ['year_range'],
        intent: 'ask_year_range',
      }],
      shouldCreateDraft: false,
      shouldSavePlan: false,
    };
    await expect(renderWeeklyPlanningDialogueMessage({
      state,
      previousState,
      decision,
    })).resolves.toContain('生活・予定条件は23時から7時まで寝ますで受け取りました。');
  });
});
""")
