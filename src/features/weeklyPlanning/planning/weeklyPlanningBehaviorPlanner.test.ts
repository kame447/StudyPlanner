import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  createAllowedDialogueActions,
  createPlanningHypothesisSnapshot,
  deriveDraftGenerationIntent,
  deriveLifeActivityAnchors,
  derivePlanningOpportunityAnnotations,
  deriveTaskExecutionProfiles,
  evaluatePlanningReadiness,
  evaluatePreviewGate,
  validateBehaviorAwareDialogueResponse,
} from './weeklyPlanningBehaviorPlanner';

function state(
  overrides: Partial<PlanningIntakeState> = {},
): PlanningIntakeState {
  return {
    status: 'idle',
    intent: 'unknown',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    sourceTurns: [],
    ...overrides,
  };
}

function readyNonExamState(sourceTurns: string[]): PlanningIntakeState {
  return state({
    status: 'draft_ready',
    intent: 'weekly_study_planning',
    range: {
      startDateTime: '2026-07-13T00:00:00',
      endDateTime: '2026-07-19T23:59:59',
      calendarDayCount: 7,
      confidence: 'explicit',
      sourceText: '今週',
    },
    tasks: [{
      title: '英語ワーク',
      subject: '英語',
      unit: 'pages',
      amount: 10,
      rawText: '英語ワーク10ページ',
      executionProfile: {
        activityKind: 'drill',
        distributionPolicy: 'sequential_units',
        cognitiveLoad: 'medium',
      },
      requiresTimeEstimate: true,
      source: 'command',
    }],
    unitRates: [{
      unit: 'pages',
      minutesPerUnit: 12,
      source: 'user',
      rawText: '1ページ10分から15分',
    }],
    constraints: [{
      kind: 'meal',
      start: '19:00',
      end: '20:00',
      hardness: 'hard',
      rawText: '夕食19時',
    }],
    fixedEventsDeclaredNone: true,
    sourceTurns,
  });
}

describe('behavior-aware weekly planning foundation', () => {
  it('does not authorize preview for a vague study goal', () => {
    const value = state({ sourceTurns: ['英語やらないといけないんだよね'] });
    expect(deriveDraftGenerationIntent({ state: value })).toBe('not_requested');
  });

  it('reads draft authorization only from accepted typed state', () => {
    const value = state({
      sourceTurns: ['それじゃあ仮で予定を組んでみよう'],
      draftGenerationIntent: 'user_authorized',
      draftGenerationAuthorizedAtRevision: 1,
    });
    expect(deriveDraftGenerationIntent({ state: value })).toBe('user_authorized');
  });

  it('keeps authorization separate from readiness', () => {
    const value = state({
      intent: 'weekly_study_planning',
      sourceTurns: ['仮で予定を組んで'],
    });
    const profiles = deriveTaskExecutionProfiles(value);
    const readiness = evaluatePlanningReadiness({
      state: value,
      taskProfiles: profiles,
      draftGenerationIntent: 'user_authorized',
    });
    expect(readiness.stage).toBe('hypothesis_ready');
    expect(readiness.blockingDimensions).toContain('task_identity');
  });

  it('allows preview only when readiness, authorization, execution shape and availability agree', () => {
    const value = readyNonExamState(['今週の予定を作りたい', '仮で予定を組んで']);
    value.draftGenerationIntent = 'user_authorized';
    value.draftGenerationAuthorizedAtRevision = value.sourceTurns.length;
    const snapshot = createPlanningHypothesisSnapshot({ state: value });
    const result = evaluatePreviewGate({
      readiness: snapshot.readiness,
      currentStateRevision: value.sourceTurns.length,
      hasExecutionShape: true,
      hasAvailabilityBasis: true,
    });
    expect(snapshot.readiness.stage).toBe('preview_ready');
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('rejects stale revisions even if the other conditions are ready', () => {
    const value = readyNonExamState(['仮で予定を組んで']);
    value.draftGenerationIntent = 'user_authorized';
    value.draftGenerationAuthorizedAtRevision = value.sourceTurns.length;
    const snapshot = createPlanningHypothesisSnapshot({ state: value });
    expect(evaluatePreviewGate({
      readiness: snapshot.readiness,
      currentStateRevision: snapshot.readiness.stateRevision + 1,
      hasExecutionShape: true,
      hasAvailabilityBasis: true,
    })).toEqual({ allowed: false, reason: 'stale_revision' });
  });

  it('derives commute, meal and before-sleep anchors without persisting a recurring profile', () => {
    const value = state({
      constraints: [
        { kind: 'commute', end: '17:30', hardness: 'soft', rawText: '帰宅は17時30分' },
        { kind: 'meal', start: '19:00', hardness: 'soft', rawText: '夕食は19時' },
      ],
      studyTimePreferences: [{
        kind: 'prefer_before_sleep',
        rawText: '寝る前なら英単語をできそう',
        confidence: 'high',
      }],
      sourceTurns: ['帰宅は17時30分。夕食は19時。寝る前なら英単語をできそう'],
    });
    const anchors = deriveLifeActivityAnchors(value);
    expect(anchors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'commute', endTime: '17:30', scope: 'current_week' }),
      expect.objectContaining({ kind: 'meal', startTime: '19:00', scope: 'current_week' }),
      expect.objectContaining({ kind: 'sleep', scope: 'current_week' }),
    ]));
    expect(anchors.some((anchor) => anchor.scope === 'recurring_profile')).toBe(false);
  });

  it('distinguishes memorization and workbook execution profiles', () => {
    const value = state({
      tasks: [
        {
          title: '英単語',
          subject: '英語',
          unit: 'words',
          amount: 50,
          rawText: '英単語の小テスト',
          executionProfile: {
            activityKind: 'memorization',
            distributionPolicy: 'spaced',
            cognitiveLoad: 'light',
          },
          requiresTimeEstimate: true,
          source: 'command',
        },
        {
          title: '英語ワーク',
          subject: '英語',
          unit: 'pages',
          amount: 10,
          rawText: 'ワーク10ページ',
          executionProfile: {
            activityKind: 'drill',
            distributionPolicy: 'sequential_units',
            cognitiveLoad: 'medium',
          },
          requiresTimeEstimate: true,
          source: 'command',
        },
      ],
    });
    expect(deriveTaskExecutionProfiles(value)).toEqual([
      expect.objectContaining({ activityKind: 'memorization', distributionPolicy: 'spaced' }),
      expect.objectContaining({ activityKind: 'drill', distributionPolicy: 'sequential_units' }),
    ]);
  });

  it('does not fabricate availability while adding opportunity annotations', () => {
    const value = state({
      studyTimePreferences: [
        { kind: 'avoid_morning', rawText: '朝は続かない', confidence: 'high' },
        {
          kind: 'prefer_before_sleep',
          rawText: '寝る前なら英単語をできそう',
          confidence: 'high',
        },
      ],
      sourceTurns: ['朝は続かない。寝る前なら英単語をできそう'],
    });
    const anchors = deriveLifeActivityAnchors(value);
    const ranges = [
      { ref: 'range-1', startTime: '21:30', endTime: '22:00', sourceFactRefs: ['availability:1'] },
    ];
    const annotations = derivePlanningOpportunityAnnotations({
      availabilityRanges: ranges,
      anchors,
      state: value,
    });
    expect(annotations).toHaveLength(ranges.length);
    expect(annotations[0]).toMatchObject({
      availabilityRangeRef: 'range-1',
      tags: expect.arrayContaining(['short_transition_window', 'before_sleep']),
    });
  });

  it('uses proposal-first actions when a safe estimate opportunity exists', () => {
    const value = state({
      intent: 'weekly_study_planning',
      range: {
        startDateTime: '2026-07-13T00:00:00',
        calendarDayCount: 7,
        confidence: 'explicit',
      },
      tasks: [{
        title: '英語ワーク',
        unit: 'pages',
        amount: 10,
        rawText: 'ワーク10ページ',
        requiresTimeEstimate: true,
        source: 'command',
      }],
      constraints: [{ kind: 'meal', start: '19:00', hardness: 'hard' }],
      sourceTurns: ['英語ワークを10ページ進めたい'],
    });
    const snapshot = createPlanningHypothesisSnapshot({ state: value });
    const actions = createAllowedDialogueActions(snapshot);
    expect(actions.some((action) => action.kind === 'propose_default')).toBe(true);
  });

  it('rejects AI actions outside AllowedDialogueActions and save claims', () => {
    const value = readyNonExamState(['仮で予定を組んで']);
    const snapshot = createPlanningHypothesisSnapshot({ state: value });
    const actions = createAllowedDialogueActions(snapshot);
    expect(validateBehaviorAwareDialogueResponse({
      response: {
        selectedActionIds: ['unknown-action'],
        items: [{ actionId: 'unknown-action', text: '保存しました' }],
      },
      actions,
      previewAllowed: true,
    })).toBeNull();
  });

  it('is deterministic and does not mutate the input state', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom('英単語', '英語ワーク', 'レポート', '教科書を読む'), {
        minLength: 1,
        maxLength: 4,
      }),
      (titles) => {
        const value = state({
          intent: 'weekly_study_planning',
          tasks: titles.map((title) => ({
            title,
            unit: 'minutes',
            amount: 30,
            rawText: title,
            requiresTimeEstimate: false,
            source: 'command' as const,
          })),
          sourceTurns: ['今週の勉強を相談したい'],
        });
        const before = JSON.stringify(value);
        expect(createPlanningHypothesisSnapshot({ state: value }))
          .toEqual(createPlanningHypothesisSnapshot({ state: value }));
        expect(JSON.stringify(value)).toBe(before);
      },
    ), { seed: 20260714, numRuns: 25 });
  });
});
