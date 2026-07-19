from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f'patch target not found in {path}: {old[:200]!r}')
    target.write_text(text.replace(old, new, 1))


validator = 'src/features/weeklyPlanning/intake/weeklyPlanningCandidateValidator.ts'
replace_once(
    validator,
    """import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText, parseSmallInteger } from './weeklyPlanningTextParsing';
""",
    """import type { WeeklyPlanningIntakeContext } from './weeklyPlanningIntakeTypes';
import { normalizeIntakeText, parseSmallInteger } from './weeklyPlanningTextParsing';
import {
  endOfWeeklyPlanningWeek,
  resolveWeekendRange,
  startOfWeeklyPlanningWeek,
} from '../personalization/weeklyPlanningWeek';
""",
)
replace_once(
    validator,
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
    validator,
    """  return new RegExp(`${hour}\s*時(?:\s*${minute}\s*分)?`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
}
""",
    """  return new RegExp(`${hour}\\s*時(?:\\s*${minute}\\s*分)?`).test(normalized)
    || new RegExp(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).test(normalized);
}
""",
)
replace_once(
    validator,
    """function relativePlanningDateGrounded(
  text: string,
  startDateTime: string | undefined,
  context: WeeklyPlanningIntakeContext | undefined,
): boolean {
  if (!startDateTime || !context) return true;
  const normalized = normalizeIntakeText(text);
  const currentDate = context.currentDateTime?.slice(0, 10) ?? context.selectedDate;
  const expected = /明後日/.test(normalized)
    ? addDays(currentDate, 2)
    : /明日/.test(normalized)
      ? addDays(currentDate, 1)
      : /今日/.test(normalized)
        ? currentDate
        : undefined;
  return expected === undefined || startDateTime.slice(0, 10) === expected;
}

function validateCommandGrounding""",
    """function relativePlanningDateGrounded(
  text: string,
  startDateTime: string | undefined,
  context: WeeklyPlanningIntakeContext | undefined,
): boolean {
  if (!startDateTime || !context) return true;
  const normalized = normalizeIntakeText(text);
  const currentDate = context.currentDateTime?.slice(0, 10) ?? context.selectedDate;
  const expected = /明後日/.test(normalized)
    ? addDays(currentDate, 2)
    : /明日/.test(normalized)
      ? addDays(currentDate, 1)
      : /今日/.test(normalized)
        ? currentDate
        : undefined;
  return expected === undefined || startDateTime.slice(0, 10) === expected;
}

function namedPlanningRangeGrounded(params: {
  text: string;
  startDateTime?: string;
  endDateTime?: string;
  context?: WeeklyPlanningIntakeContext;
}): boolean {
  if (!params.context) return true;
  const direct = normalizeIntakeText(params.text).replace(/[。！!]/g, '').trim();
  const named = direct.match(
    /^(今週|来週|週末)(?:の(?:予定|計画|スケジュール))?(?:です|でお願いします|にします)?$/,
  )?.[1];
  if (!named) return true;
  const startDate = params.startDateTime?.slice(0, 10);
  const endDate = params.endDateTime?.slice(0, 10);
  if (!startDate || !endDate) return false;

  if (named === '来週') {
    const currentWeekStart = startOfWeeklyPlanningWeek(
      params.context.selectedDate,
      params.context.weekStartsOn,
    );
    const expectedStart = addDays(currentWeekStart, 7);
    return startDate === expectedStart && endDate === addDays(expectedStart, 6);
  }
  if (named === '今週') {
    return startDate === params.context.selectedDate
      && endDate === endOfWeeklyPlanningWeek(
        params.context.selectedDate,
        params.context.weekStartsOn,
      );
  }
  const weekend = resolveWeekendRange(params.context.selectedDate);
  return startDate === weekend.startDate && endDate === weekend.endDate;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function groundedPriorityPolicy(
  text: string,
  command: Extract<ParsedWeeklyPlanningCommand, { type: 'set_priority_policy' }>,
  knownFields: readonly string[],
): boolean {
  const normalized = normalizeIntakeText(text);
  switch (command.policy.kind) {
    case 'deadline_first':
      return /締切|期限|提出日/.test(normalized);
    case 'weakness_first':
      return /苦手|弱点|弱い/.test(normalized);
    case 'score_weight_first':
      return /配点|得点|点数/.test(normalized);
    case 'balanced':
      return /均等|同じ優先|バランス/.test(normalized);
    case 'unknown':
      return /わから|決めていない|どれでも/.test(normalized);
    case 'field_first': {
      const order = command.policy.order;
      if (order.length === 0 || new Set(order).size !== order.length) return false;
      const normalizedKnown = new Map(knownFields.map((field) => [normalizedEvidence(field), field]));
      if (knownFields.length > 0 && order.some((field) => !normalizedKnown.has(normalizedEvidence(field)))) {
        return false;
      }
      if (knownFields.length === 0
        && order.some((field) => !normalizedEvidence(normalized).includes(normalizedEvidence(field)))) {
        return false;
      }
      const mentioned = knownFields
        .map((field) => ({ field, index: normalizedEvidence(normalized).indexOf(normalizedEvidence(field)) }))
        .filter((item) => item.index >= 0)
        .sort((left, right) => left.index - right.index)
        .map((item) => item.field);
      if (mentioned.length === 0) return false;
      const explicitlyPreferred = knownFields.find((field) => {
        const token = escapeRegExp(normalizeIntakeText(field));
        return new RegExp(`${token}(?:を)?(?:最優先|優先|から(?:始め|進め|やり|解き))`).test(normalized)
          || new RegExp(`${token}.*より.*先`).test(normalized)
          || new RegExp(`より.*${token}(?:を)?.*先`).test(normalized);
      });
      if (explicitlyPreferred) return order[0] === explicitlyPreferred;
      return mentioned.every((field, index) => order[index] === field);
    }
    default:
      return false;
  }
}

function lifeConstraintKindGrounded(
  kind: Extract<ParsedWeeklyPlanningCommand, { type: 'update_life_constraint' }>['kind'],
  text: string,
): boolean {
  const patterns: Record<typeof kind, RegExp> = {
    sleep: /睡眠|就寝|起床|寝|起き/,
    meal: /食事|朝食|昼食|夕食|ご飯/,
    bath: /風呂|入浴/,
    commute: /通学|通勤|移動/,
    club: /部活|サークル/,
    cram_school: /塾|予備校/,
    buffer: /準備|休憩|余裕|バッファ/,
  };
  return patterns[kind].test(normalizeIntakeText(text));
}

function validateCommandGrounding""",
)
replace_once(
    validator,
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
    """    case 'set_priority_policy':
      return groundedPriorityPolicy(normalized, command, summary.knownFields)
        ? null : 'ungrounded-priority-policy';
""",
)
replace_once(
    validator,
    """    case 'set_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\d{1,2}\s*月\s*\d{1,2}\s*日|から|まで|週間|日間/.test(normalized)
        && relativePlanningDateGrounded(normalized, command.range.startDateTime, context)
        ? null : 'ungrounded-planning-range';
""",
    """    case 'set_planning_range':
      return /今日|明日|明後日|今週|来週|週末|夏休み|[月火水木金土日]曜|\d{1,2}\s*月\s*\d{1,2}\s*日|から|まで|週間|日間/.test(normalized)
        && relativePlanningDateGrounded(normalized, command.range.startDateTime, context)
        && namedPlanningRangeGrounded({
          text: normalized,
          startDateTime: command.range.startDateTime,
          endDateTime: command.range.endDateTime,
          context,
        })
        ? null : 'ungrounded-planning-range';
""",
)
replace_once(
    validator,
    """    case 'update_life_constraint':
      return /\d{1,2}\s*時|\d{1,2}:\d{2}|睡眠|寝|食事|夕食|風呂|入浴|移動|バイト|授業|予定/.test(normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.constraint })
        ? null : 'ungrounded-life-constraint';
""",
    """    case 'update_life_constraint':
      return lifeConstraintKindGrounded(command.kind, normalized)
        && lifeConstraintPayloadGrounded({ userText: normalized, ...command.constraint })
        ? null : 'ungrounded-life-constraint';
""",
)

pipeline = 'src/features/weeklyPlanning/pipeline/weeklyPlanningIntakePipeline.ts'
replace_once(
    pipeline,
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
    pipeline,
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

questions = 'src/features/weeklyPlanning/intake/weeklyPlanningQuestionSlots.ts'
replace_once(
    questions,
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
    questions,
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

renderer = 'src/features/weeklyPlanning/dialogue/weeklyPlanningDialogueRenderer.ts'
replace_once(
    renderer,
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
    renderer,
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
    renderer,
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

test_path = Path('src/features/weeklyPlanning/__tests__/weeklyPlanningSevenAuditBoundary.test.ts')
test_path.write_text("""import { describe, expect, it, vi } from 'vitest';
import type { WeeklyPlanningDialogueDecision } from '../dialogue/weeklyPlanningDialogueManager';
import { renderWeeklyPlanningDialogueMessage } from '../dialogue/weeklyPlanningDialogueRenderer';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import {
  createInitialPlanningIntakeState,
} from '../intake/weeklyPlanningIntakeReducer';
import { finalizeState } from '../intake/weeklyPlanningMissingStatus';
import { QUESTION_SLOT_DEFINITION_BY_MISSING } from '../intake/weeklyPlanningQuestionSlots';
import type {
  InterpretedCommandCandidate,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import { runWeeklyPlanningIntakePipelineWithInterpreter } from '../pipeline/weeklyPlanningIntakePipeline';

function aiCandidate(
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

describe('weekly planning seven-audit boundaries', () => {
  it('rejects an invented field in an otherwise plausible priority order', () => {
    const userText = 'OSを優先します';
    const validation = validateInterpretedCandidates([
      aiCandidate(userText, {
        type: 'set_priority_policy',
        policy: { kind: 'field_first', order: ['数学', 'OS'] },
        sourceText: userText,
        confidence: 'high',
      }),
    ], {
      knownFields: ['OS', 'ネットワーク'],
      confirmedSlots: [],
    });

    expect(validation.accepted).toEqual([]);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-priority-policy' }),
    ]);
  });

  it('rejects a life-constraint kind that contradicts the user wording', () => {
    const userText = '23時から7時まで寝ます';
    const validation = validateInterpretedCandidates([
      aiCandidate(userText, {
        type: 'update_life_constraint',
        kind: 'meal',
        constraint: { start: '23:00', end: '07:00', hardness: 'hard' },
        sourceText: userText,
        confidence: 'high',
      }),
    ], { knownFields: [], confirmedSlots: [] });

    expect(validation.accepted).toEqual([]);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-life-constraint' }),
    ]);
  });

  it('rejects arbitrary dates for the short answer 来週', () => {
    const userText = '来週です';
    const validation = validateInterpretedCandidates([
      aiCandidate(userText, {
        type: 'set_planning_range',
        range: {
          startDateTime: '2026-07-27T00:00:00',
          endDateTime: '2026-08-02T24:00:00',
          confidence: 'explicit',
        },
        sourceText: userText,
        confidence: 'high',
      }),
    ], { knownFields: [], confirmedSlots: [] }, {
      selectedDate: '2026-07-19',
      currentDateTime: '2026-07-19T14:00:00',
      planningDayCount: 7,
      weekStartsOn: 'monday',
    });

    expect(validation.accepted).toEqual([]);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-planning-range' }),
    ]);
  });

  it('rejects times after 24:00', () => {
    const userText = '24:30から24:45は予定があります';
    const validation = validateInterpretedCandidates([
      aiCandidate(userText, {
        type: 'add_unavailable',
        range: { start: '24:30', end: '24:45', hardness: 'hard' },
        sourceText: userText,
        confidence: 'high',
      }),
    ], { knownFields: [], confirmedSlots: [] });

    expect(validation.accepted).toEqual([]);
    expect(validation.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-time' }),
    ]);
  });

  it('accepts the required exam unit rate when only an unrelated rate was stored', async () => {
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
      userText: '回答します',
      planningStartDate: '2026-07-19',
      planningDayCount: 7,
      currentDateTime: '2026-07-19T14:00:00',
      interpreter,
    });

    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
    expect(output.interpreterDiagnostics?.accepted.map((command) => command.type)).toContain('set_unit_rate');
    expect(output.state.unitRates).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: 'year_field_chunk', minutesPerUnit: 180 }),
    ]));
  });

  it('uses the actual ambiguous completion boundary year in the question', () => {
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

  it('acknowledges a life constraint accepted in the current turn', async () => {
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
