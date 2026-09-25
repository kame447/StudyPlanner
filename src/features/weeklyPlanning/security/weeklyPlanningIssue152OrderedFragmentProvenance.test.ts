import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningCurrentTurnProvenanceV5,
  weeklyPlanningEvidenceChannelForSourceTextV5,
} from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import {
  defaultFixtureProviderResponse,
  runIssue152Conversation,
} from '../evals/__tests__/weeklyPlanningIssue152StoredRowsFixtures';

const userText = '来週、数学の問題集を30問と英単語を200語進めたいです。平日は19時から21時、土日は10時から12時が空いています。';
const mathCitation = '数学の問題集を30問進めたいです';
const weekdayCitation = '平日は19時から21時が空いています';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function taskDocument(sourceText: string): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...emptyDocument(),
    tasks: [{
      localId: 'task-fragment',
      existingPublicId: null,
      decompositionStatus: 'atomic',
      category: 'study',
      title: '新しい作業',
      study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: null, components: [] },
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText,
    }],
  };
}

function realTurnCitationsDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    ...emptyDocument(),
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1', kind: 'relative_week', value: 'next_week', start: null, end: null,
      sourceText: '来週',
    },
    tasks: [
      {
        localId: 'task-math', existingPublicId: null, decompositionStatus: 'atomic',
        category: 'study', title: '数学の問題集を進める',
        study: { purpose: 'self_study', activityKind: 'problem_solving', contextLabel: '数学の問題集', components: [] },
        workloads: [{
          localId: 'workload-math', quantityRole: 'target', amount: 30,
          unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null, sourceText: '数学の問題集を30問',
        }],
        effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
        sourceText: mathCitation,
      },
      {
        localId: 'task-english', existingPublicId: null, decompositionStatus: 'atomic',
        category: 'study', title: '英単語を進める',
        study: { purpose: 'self_study', activityKind: 'memorization_retrieval', contextLabel: '英単語', components: [] },
        workloads: [{
          localId: 'workload-english', quantityRole: 'target', amount: 200,
          unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
          perOccurrence: false, periodExpression: null, sourceText: '英単語を200語',
        }],
        effortEstimates: [], temporalConstraints: [], recurrence: [], durableContextSignals: [],
        sourceText: '英単語を200語進めたいです',
      },
    ],
    availabilityDeclarations: [
      {
        localId: 'availability-weekday', kind: 'available', dateExpression: null,
        namedTimePeriod: null, startTime: '19:00', endTime: '21:00',
        recurrenceKind: 'weekdays',
        days: ['weekday:monday', 'weekday:tuesday', 'weekday:wednesday', 'weekday:thursday', 'weekday:friday'],
        constraintLevel: 'hard', capacityMinutes: null, sourceText: weekdayCitation,
      },
      {
        localId: 'availability-weekend', kind: 'available', dateExpression: null,
        namedTimePeriod: null, startTime: '10:00', endTime: '12:00',
        recurrenceKind: 'weekends', days: ['weekday:saturday', 'weekday:sunday'],
        constraintLevel: 'hard', capacityMinutes: null,
        sourceText: '土日は10時から12時が空いています',
      },
    ],
  };
}

describe('Issue #152 bounded ordered-fragment provenance', () => {
  it('commits the two Real run 36167880968 citations through the application path', async () => {
    const document = realTurnCitationsDocument();
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document, currentUserText: userText,
    })).toEqual([]);

    const observed = await runIssue152Conversation({
      conversationId: 'issue152-fragment-normal-flow',
      turns: [userText],
      fakeProvider: true,
      providerResponse(input) {
        if (input.purpose === 'weekly_planning_semantic_normalizer') {
          return JSON.stringify(document);
        }
        return defaultFixtureProviderResponse(input);
      },
    });
    const turn = observed.turns[0];
    expect(turn?.validationErrors).toEqual([]);
    expect(turn?.graphRevision).toBe(1);
    expect(turn?.graph?.tasks).toHaveLength(2);
    expect(turn?.graph?.workloads).toHaveLength(2);
    expect(turn?.graph?.availabilityDeclarations).toHaveLength(2);
  });

  it('commits the observed one-task initial response shape without a repair', async () => {
    const document = realTurnCitationsDocument();
    document.tasks = document.tasks.slice(0, 1);
    const observed = await runIssue152Conversation({
      conversationId: 'issue152-fragment-observed-shape',
      turns: [userText],
      fakeProvider: true,
      providerResponse(input) {
        if (input.purpose === 'weekly_planning_semantic_normalizer') {
          return JSON.stringify(document);
        }
        return defaultFixtureProviderResponse(input);
      },
    });
    const turn = observed.turns[0];
    expect(turn?.validationErrors).toEqual([]);
    expect(turn?.graphRevision).toBe(1);
    expect(turn?.graph?.tasks).toHaveLength(1);
    expect(turn?.graph?.availabilityDeclarations).toHaveLength(2);
  });

  it('matches exact ordered fragments in one channel while preserving short contiguous evidence', () => {
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(mathCitation, userText)).toBe('user');
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(weekdayCitation, userText)).toBe('user');
    expect(weeklyPlanningEvidenceChannelForSourceTextV5('x', 'x')).toBe('user');
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      `「数学の問\u200b題集を30問進めたいです。」`, userText,
    )).toBe('user');
  });

  it('does not join user and supplemental text into one evidence channel', () => {
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      '数学30問進めたい', '数学30問', '進めたい',
    )).toBeNull();
  });

  it('rejects supplemental-only fragments for availability authority, with a user-channel control', () => {
    const document = emptyDocument();
    document.availabilityDeclarations = [realTurnCitationsDocument().availabilityDeclarations[0]];
    const errors = validateWeeklyPlanningCurrentTurnProvenanceV5({
      document, currentUserText: '画像を見て', supplementalContext: userText,
    });
    expect(errors).toContain(
      'document.availabilityDeclarations[0].sourceText:not-grounded-in-current-user-text',
    );
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document, currentUserText: userText,
    })).toEqual([]);
  });

  it('treats matching fragments in both channels as ambiguous for durable authority', () => {
    const sourceText = '数学30問進めたい';
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      sourceText, '数学30問と英語20語進めたい', '数学30問と理科10問進めたい',
    )).toBe('ambiguous');
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1', kind: 'learning_preference', label: '学習',
      value: '数学30問', dateExpression: null, sourceText,
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '数学30問と英語20語進めたい',
      supplementalContext: '数学30問と理科10問進めたい',
    })).toContain('document.userContextFacts[0].sourceText:not-grounded-in-current-user-text');
  });

  it('rejects a fragmented user match copied from stored context', () => {
    const sourceText = '数学30問進めたい';
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: taskDocument(sourceText),
      currentUserText: '数学30問と英語20語進めたい',
      publicStateSummary: { tasks: [{ publicId: 'stored-1', title: sourceText }] },
    })).toContain('document.tasks[0].sourceText:not-grounded-in-current-user-text');
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: taskDocument(sourceText),
      currentUserText: '数学30問と英語20語進めたい',
    })).toEqual([]);
  });

  it('rejects source text copied from a stored row when its fragments are absent from the user turn', () => {
    const sourceText = '保存情報を勝手に採用';
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: taskDocument(sourceText),
      currentUserText: '数学30問を進めたい',
      publicStateSummary: { tasks: [{ publicId: 'stored-1', title: sourceText }] },
    })).toContain('document.tasks[0].sourceText:not-grounded-in-current-user-text');
  });

  it('rejects a fourth fragment and a one-character bridge', () => {
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      'abcd', 'cdXab',
    )).toBeNull();
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      'abcdefgh', 'abXcdYefZgh',
    )).toBeNull();
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      'abXcd', 'abqXrcd',
    )).toBeNull();
    expect(weeklyPlanningEvidenceChannelForSourceTextV5(
      'abcdef', 'abXcdYef',
    )).toBe('user');
  });

  it('never accepts random stored evidence from a disjoint user alphabet', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 4, maxLength: 30 }),
      fc.array(fc.constantFrom('w', 'x', 'y', 'z'), { minLength: 4, maxLength: 30 }),
      (userCharacters, storedCharacters) => {
        const user = userCharacters.join('');
        const stored = storedCharacters.join('');
        expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
          document: taskDocument(stored),
          currentUserText: user,
          publicStateSummary: { tasks: [{ publicId: 'stored-1', title: stored }] },
        })).toContain('document.tasks[0].sourceText:not-grounded-in-current-user-text');
      },
    ), { seed: 15236167, numRuns: 250 });
  });

  it('never grants user provenance by fragmenting a stored row into the user text', () => {
    const part = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { minLength: 2, maxLength: 12 })
      .map((characters) => characters.join(''));
    fc.assert(fc.property(part, part, (left, right) => {
      const stored = `${left}${right}`;
      const user = `${left}ZZ${right}`;
      expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
        document: taskDocument(stored),
        currentUserText: user,
        publicStateSummary: { tasks: [{ publicId: 'stored-1', title: stored }] },
      })).toContain('document.tasks[0].sourceText:not-grounded-in-current-user-text');
    }), { seed: 15236168, numRuns: 250 });
  });
});
