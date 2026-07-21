import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { PlanningIntakeState, StudyTaskScope } from '../intake/weeklyPlanningIntakeTypes';
import type { InterpretedCommandCandidate } from '../intake/weeklyPlanningInterpreterTypes';
import { deriveTaskExecutionProfiles } from '../planning/weeklyPlanningBehaviorPlanner';
import { runBehaviorAwarePlanningPreviewBridge } from '../planning/weeklyPlanningBehaviorAwarePreviewBridge';

const validatorContext = {
  selectedDate: '2026-07-13',
  currentDateTime: '2026-07-14T18:00:00',
};

function candidate(
  command: ParsedWeeklyPlanningCommand,
  sourceUserText: string,
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
    sourceUserText,
  };
}

function task(overrides: Partial<StudyTaskScope> = {}): StudyTaskScope {
  return {
    title: '学習項目',
    subject: '一般',
    unit: 'minutes',
    amount: 30,
    rawText: '英単語を30分やる',
    requiresTimeEstimate: false,
    source: 'command',
    ...overrides,
  };
}

function authorizedState(tasks: StudyTaskScope[]): PlanningIntakeState {
  return {
    status: 'draft_ready',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 7,
      sourceText: '今週',
      confidence: 'explicit',
    },
    tasks,
    progress: [],
    unitRates: [],
    constraints: [
      {
        kind: 'commute',
        studyAvailableStart: '17:30',
        hardness: 'hard',
        rawText: '帰宅は17時30分',
      },
      {
        kind: 'meal',
        start: '19:00',
        end: '20:00',
        hardness: 'hard',
        rawText: '夕食は19時から20時',
      },
    ],
    fixedEventsDeclaredNone: true,
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: true,
    shouldSavePlan: false,
    draftGenerationIntent: 'user_authorized',
    draftGenerationAuthorizedAtRevision: 1,
    sourceTurns: ['この条件で予定を作って'],
  };
}

describe('weekly planning final seven-perspective audit regressions', () => {
  it('does not derive an execution profile from stored raw user text', () => {
    const profile = deriveTaskExecutionProfiles(authorizedState([task()]))[0];

    expect(profile).toMatchObject({
      activityKind: 'unknown',
      distributionPolicy: 'splittable',
      cognitiveLoad: 'unknown',
    });
  });

  it('keeps duplicate-title task metadata distinct by source index', () => {
    const state = authorizedState([
      task({
        title: 'ワーク',
        subject: '英語',
        amount: 30,
        rawText: '英語のワークを30分',
        executionProfile: {
          activityKind: 'drill',
          distributionPolicy: 'sequential_units',
          cognitiveLoad: 'medium',
        },
      }),
      task({
        title: 'ワーク',
        subject: '数学',
        amount: 60,
        rawText: '数学のワークを60分',
        executionProfile: {
          activityKind: 'drill',
          distributionPolicy: 'sequential_units',
          cognitiveLoad: 'medium',
        },
      }),
    ]);
    const result = runBehaviorAwarePlanningPreviewBridge({
      state,
      planningStartDate: '2026-07-13',
      planningDayCount: 7,
    });

    expect(result.gate).toEqual({ allowed: true, reason: 'allowed' });
    const candidates = result.draftRun?.candidates ?? [];
    expect(new Set(candidates.map((item) => item.behaviorMetadata.taskRef))).toEqual(
      new Set(['task:0', 'task:1']),
    );
    expect(new Set(candidates.map((item) => item.field))).toEqual(
      new Set(['英語', '数学']),
    );
  });

  it('rejects a weekday deadline outside the selected planning week', () => {
    const userText = '金曜日までに英単語の小テスト対策をしたい';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_study_goal',
        goal: {
          title: '英単語の小テスト対策',
          deadlineDeclared: true,
          deadlineDate: '2026-07-24',
        },
        sourceText: userText,
        confidence: 'high',
      }, userText),
    ], {
      knownFields: [],
      confirmedSlots: [],
      tasks: [{ ref: 'task:0', label: '英単語' }],
    }, validatorContext);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-study-goal' }),
    ]);
  });

  it('rejects a calendar-invalid deadline date', () => {
    const userText = '2026年2月30日までに英単語の小テスト対策をしたい';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_study_goal',
        goal: {
          title: '英単語の小テスト対策',
          deadlineDeclared: true,
          deadlineDate: '2026-02-30',
        },
        sourceText: userText,
        confidence: 'high',
      }, userText),
    ], {
      knownFields: [],
      confirmedSlots: [],
      tasks: [{ ref: 'task:0', label: '英単語' }],
    }, validatorContext);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-deadline-date' }),
    ]);
  });

  it('rejects a relative constraint when the mentioned anchor is ambiguous', () => {
    const userText = 'バイトの後、帰宅に10分かかる';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'add_relative_constraint',
        anchorRef: 'constraint:0',
        relation: 'after',
        offsetMinutes: 0,
        durationMinutes: 10,
        kind: 'commute',
        sourceText: userText,
        confidence: 'high',
      }, userText),
    ], {
      knownFields: [],
      confirmedSlots: [],
      constraintAnchors: [
        {
          ref: 'constraint:0', label: '火曜日のバイト', kind: 'fixed_event',
          date: '2026-07-14', start: '15:00', end: '16:00',
        },
        {
          ref: 'constraint:1', label: '木曜日のバイト', kind: 'fixed_event',
          date: '2026-07-16', start: '15:00', end: '16:00',
        },
      ],
    }, validatorContext);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-relative-constraint' }),
    ]);
  });

  it('rejects an ambiguous task reference in a time preference', () => {
    const userText = '寝る前なら英単語を見直せそう';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'note_study_time_preference',
        preference: { kind: 'prefer_before_sleep', taskRef: 'task:0' },
        sourceText: userText,
        confidence: 'high',
      }, userText),
    ], {
      knownFields: [],
      confirmedSlots: [],
      tasks: [
        { ref: 'task:0', label: '英単語' },
        { ref: 'task:1', label: '英単語' },
      ],
    }, validatorContext);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'ungrounded-study-time-preference' }),
    ]);
  });
});
