import { describe, expect, it } from 'vitest';
import type { ParsedWeeklyPlanningCommand } from '../intake/weeklyPlanningCommandTypes';
import type { WeeklyPlanningIntakeInterpreter } from '../intake/weeklyPlanningInterpreterTypes';
import {
  hasAllowedDialogueAction,
  runWeeklyPlanningBehaviorAwarePipelineWithInterpreter,
} from '../pipeline/weeklyPlanningBehaviorAwareIntakePipeline';

const pipelineDefaults = {
  planningStartDate: '2026-07-13',
  planningDayCount: 7,
  currentDateTime: '2026-07-14T18:00:00',
  sessionPolicy: {
    firstDayStartTime: '17:30',
    dayStartTime: '09:00',
    dayEndTime: '22:00',
    minSessionMinutes: 10,
    targetSessionMinutes: 60,
    maxSessionMinutes: 90,
    breakMinutes: 10,
  },
};

function interpreter(
  commands: ParsedWeeklyPlanningCommand[],
): WeeklyPlanningIntakeInterpreter {
  return {
    async interpretUserTurn() {
      return { candidates: commands, parseRejections: [] };
    },
  };
}

function source<T extends ParsedWeeklyPlanningCommand>(
  command: Omit<T, 'sourceText' | 'confidence'>,
  sourceText: string,
): T {
  return {
    ...command,
    sourceText,
    confidence: 'high',
  } as T;
}

describe('WP-BEHAVIOR-001 behavior-aware roleplay', () => {
  it('moves from exploration to proposal-first dialogue and generates preview only after authorization', async () => {
    const openingText = '英語やらないといけないんだよね';
    const opening = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineDefaults,
      userText: openingText,
      interpreter: interpreter([
        source({
          type: 'set_planning_range',
          range: {
            startDateTime: '2026-07-13T00:00:00',
            endDateTime: '2026-07-19T23:59:59',
            calendarDayCount: 7,
            confidence: 'explicit',
            sourceText: '今週',
          },
        }, openingText),
      ]),
    });

    expect(opening.behavior.snapshot.readiness.draftGenerationIntent).toBe('not_requested');
    expect(opening.behavior.gate.allowed).toBe(false);
    expect(opening.draftCandidates).toBeNull();
    expect(hasAllowedDialogueAction(opening, 'ask_required_fact')).toBe(true);

    const taskText = '金曜日に英単語の小テストがあって、ワークも10ページくらい出ている';
    const tasks = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineDefaults,
      previousState: opening.state,
      userText: taskText,
      interpreter: interpreter([
        source({
          type: 'set_study_goal',
          goal: {
            title: '英単語',
            subject: '英語',
            unit: 'minutes',
            amount: 30,
          },
        }, taskText),
        source({
          type: 'set_study_goal',
          goal: {
            title: '英語ワーク',
            subject: '英語',
            unit: 'pages',
            amount: 10,
          },
        }, taskText),
      ]),
    });

    expect(tasks.state.tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining(['英単語', '英語ワーク']),
    );
    expect(tasks.behavior.snapshot.taskProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ activityKind: 'memorization', distributionPolicy: 'spaced' }),
      expect.objectContaining({ activityKind: 'drill', distributionPolicy: 'sequential_units' }),
    ]));
    expect(tasks.draftCandidates).toBeNull();
    expect(hasAllowedDialogueAction(tasks, 'propose_default')).toBe(true);

    const estimateText = '1ページ10分から15分くらい';
    const estimate = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineDefaults,
      previousState: tasks.state,
      userText: estimateText,
      interpreter: interpreter([
        source({
          type: 'set_unit_rate',
          unitRate: {
            unit: 'pages',
            minutesPerUnit: 12,
            source: 'user',
            uncertainty: 'medium',
            rawText: estimateText,
          },
        }, estimateText),
      ]),
    });

    expect(estimate.state.unitRates).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: 'pages', minutesPerUnit: 12 }),
    ]));
    expect(estimate.draftCandidates).toBeNull();

    const routineText = '夕食は19時で、帰宅は17時30分。朝は続かない。寝る前なら英単語をできそう';
    const routine = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineDefaults,
      previousState: estimate.state,
      userText: routineText,
      interpreter: interpreter([
        source({
          type: 'update_life_constraint',
          kind: 'meal',
          constraint: {
            start: '19:00',
            end: '20:00',
            hardness: 'hard',
          },
        }, routineText),
        source({
          type: 'update_life_constraint',
          kind: 'commute',
          constraint: {
            end: '17:30',
            hardness: 'soft',
          },
        }, routineText),
        source({ type: 'note_no_fixed_events' }, routineText),
      ]),
    });

    expect(routine.behavior.snapshot.lifeActivityAnchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'meal', startTime: '19:00' }),
      expect.objectContaining({ kind: 'commute', endTime: '17:30' }),
      expect.objectContaining({ kind: 'sleep', scope: 'current_week' }),
    ]));
    expect(routine.behavior.snapshot.readiness.draftGenerationIntent).toBe('not_requested');
    expect(routine.behavior.gate.allowed).toBe(false);
    expect(routine.draftCandidates).toBeNull();
    expect(hasAllowedDialogueAction(routine, 'suggest_draft_generation')).toBe(true);
    expect(routine.behaviorDialogue.message.length).toBeGreaterThan(0);

    const authorizationText = 'それじゃあ仮で予定を組んでみよう';
    const preview = await runWeeklyPlanningBehaviorAwarePipelineWithInterpreter({
      ...pipelineDefaults,
      previousState: routine.state,
      userText: authorizationText,
      interpreter: interpreter([]),
    });

    expect(preview.behavior.snapshot.readiness.draftGenerationIntent).toBe('user_authorized');
    expect(preview.behavior.gate).toEqual({ allowed: true, reason: 'allowed' });
    expect(hasAllowedDialogueAction(preview, 'generate_preview')).toBe(true);
    expect(preview.draftCandidates?.length).toBeGreaterThan(0);
    expect(preview.draftCandidates?.every((candidate) => candidate.approvalStatus === 'unapproved')).toBe(true);
    expect(preview.diagnostics?.shouldSavePlan).toBe(false);
    expect(preview.state.shouldSavePlan).toBe(false);
  });
});
