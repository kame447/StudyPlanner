import { describe, expect, it, vi } from 'vitest';
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
  _userText: string,
  command: InterpretedCommandCandidate['command'],
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

describe('weekly planning seven-audit responsibility contract', () => {
  it('lets AI own priority semantics while requiring confirmation for unknown typed fields', () => {
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
    expect(rejected.acceptedWithConfirmation).toEqual([
      expect.objectContaining({ type: 'set_priority_policy' }),
    ]);
    expect(rejected.rejected).toEqual([]);
  });

  it('rejects structurally invalid times but leaves constraint meaning to AI', () => {
    const result = validateInterpretedCandidates([
      candidate('24:30から24:45は予定があります', {
        type: 'add_unavailable',
        range: { start: '24:30', end: '24:45', hardness: 'hard' },
        sourceText: '24:30から24:45は予定があります',
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
      interpretUserTurn: vi.fn(async (): ReturnType<WeeklyPlanningIntakeInterpreter['interpretUserTurn']> => ({
        candidates: [{
          command: {
            type: 'set_unit_rate',
            unitRate: {
              unit: 'year_field_chunk',
              minutesPerUnit: 180,
              source: 'user',
              rawText: '午前中いっぱいくらいです',
            },
            sourceText: '午前中いっぱいくらいです',
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
      userText: '午前中いっぱいくらいです',
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
      '2019まで完了というのは、新しい年度側から2019年度までですか？古い年度側から2019年度までですか？',
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
