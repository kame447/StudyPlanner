import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import { validateInterpretedCandidates } from '../intake/weeklyPlanningCandidateValidator';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type {
  InterpretedCommandCandidate,
  WeeklyPlanningIntakeInterpreter,
} from '../intake/weeklyPlanningInterpreterTypes';
import { runWeeklyPlanningBehaviorAwarePipelineWithInterpreter } from './weeklyPlanningBehaviorAwareIntakePipeline';

const pipelineInput = {
  planningStartDate: '2026-07-13',
  planningDayCount: 7,
  currentDateTime: '2026-07-14T18:00:00',
};

function acceptedState(): PlanningIntakeState {
  return {
    status: 'needs_scope',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 7,
      sourceText: '今週',
      confidence: 'explicit',
    },
    tasks: [{
      title: '英単語',
      subject: '英語',
      unit: 'minutes',
      amount: 30,
      rawText: '英単語を30分',
      requiresTimeEstimate: false,
      source: 'command',
    }],
    progress: [],
    unitRates: [],
    constraints: [{
      kind: 'fixed_event',
      date: '2026-07-14',
      start: '15:00',
      end: '16:00',
      hardness: 'hard',
      rawText: '火曜日のバイト',
    }],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: ['今週、英単語を30分やりたい。火曜日は15時から16時までバイト'],
  };
}

function candidate(
  command: ParsedWeeklyPlanningCommand,
  _sourceUserText?: string,
): InterpretedCommandCandidate {
  return {
    command,
    origin: 'ai_interpreter',
    needsConfirmation: false,
  };
}

function interpreter(
  createCandidates: (userText: string) => InterpretedCommandCandidate[],
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn({ userText }) {
      return { candidates: createCandidates(userText), parseRejections: [] };
    },
  };
}

describe('behavior semantic ownership', () => {
  it('does not derive relative constraints, preferences, or deadlines from raw text after successful empty AI', async () => {
    const previousState = acceptedState();
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineInput,
      previousState,
      userText: 'バイトの後、帰宅に10分。朝は無理で寝る前がいい。英単語の小テストもある',
      interpreter: interpreter(() => []),
    });

    expect(output.state.constraints).toEqual(previousState.constraints);
    expect(output.state.studyTimePreferences).toBeUndefined();
    expect(output.state.tasks[0]).not.toHaveProperty('deadlineDeclared');
    expect(output.behavior.snapshot.lifeActivityAnchors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sleep' }),
    ]));
  });

  it('resolves an AI relative-constraint command against one accepted public anchor', async () => {
    const userText = 'バイトの後、帰宅に10分かかる';
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineInput,
      previousState: acceptedState(),
      userText,
      interpreter: interpreter(() => [candidate({
        type: 'add_relative_constraint',
        anchorRef: 'constraint:0',
        relation: 'after',
        offsetMinutes: 0,
        durationMinutes: 10,
        kind: 'commute',
        sourceText: userText,
        confidence: 'high',
      }, userText)]),
    });

    expect(output.interpreterDiagnostics?.rejected).toEqual([]);
    expect(output.state.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'commute',
        date: '2026-07-14',
        start: '16:00',
        end: '16:10',
      }),
    ]));
  });

  it('uses an AI time-preference command to create behavior anchors without rereading source turns', async () => {
    const userText = '寝る前なら英単語を見直せそう';
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineInput,
      previousState: acceptedState(),
      userText,
      interpreter: interpreter(() => [candidate({
        type: 'note_study_time_preference',
        preference: { kind: 'prefer_before_sleep', taskRef: 'task:0' },
        sourceText: userText,
        confidence: 'high',
      }, userText)]),
    });

    expect(output.state.studyTimePreferences).toEqual([
      expect.objectContaining({ kind: 'prefer_before_sleep', taskRef: 'task:0' }),
    ]);
    expect(output.behavior.snapshot.lifeActivityAnchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sleep', sourceFactRefs: ['study-time-preference:0'] }),
    ]));
  });

  it('keeps an AI-declared but unresolved deadline as a deterministic blocking fact', async () => {
    const userText = '英単語の小テスト対策をしたいけど、日付はまだ分からない';
    const output = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineInput,
      previousState: acceptedState(),
      userText,
      interpreter: interpreter(() => [candidate({
        type: 'set_study_goal',
        goal: {
          title: '英単語の小テスト対策',
          deadlineDeclared: true,
        },
        sourceText: userText,
        confidence: 'high',
      }, userText)]),
    });

    expect(output.state.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: '英単語の小テスト対策',
        deadlineDeclared: true,
      }),
    ]));
    expect(output.behavior.snapshot.readiness.blockingDimensions).toContain('deadline');
    expect(output.behavior.snapshot.resolutionOpportunities).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'deadline', mode: 'must_confirm' }),
    ]));
  });

  it('rejects a deadline value that is not explicitly declared by the typed command', () => {
    const userText = '金曜日に英単語の小テスト対策をやりたい';
    const result = validateInterpretedCandidates([
      candidate({
        type: 'set_study_goal',
        goal: {
          title: '英単語の小テスト対策',
          deadlineDate: '2026-07-17',
        },
        sourceText: userText,
        confidence: 'high',
      }, userText),
    ], {
      knownFields: [],
      confirmedSlots: [],
      tasks: [{ ref: 'task:0', label: '英単語' }],
    }, {
      selectedDate: '2026-07-13',
      currentDateTime: '2026-07-14T18:00:00',
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ reason: 'deadline-payload-requires-declaration' }),
    ]);
  });
});
