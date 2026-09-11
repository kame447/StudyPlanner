import { describe, expect, it } from 'vitest';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningCurrentTurnProvenanceV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';

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

function taskWithWorkload(params: {
  title: string;
  sourceText: string;
  workloadSourceText: string;
  workloadAmount?: number;
}): WeeklyPlanningSemanticDocumentV5['tasks'][number] {
  return {
    localId: 'task-1',
    decompositionStatus: 'atomic',
    category: 'study',
    title: params.title,
    study: null,
    workloads: [{
      localId: 'workload-1',
      quantityRole: 'target',
      amount: params.workloadAmount ?? 20,
      unitCode: 'problem',
      unitLabel: '問',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      sourceText: params.workloadSourceText,
    }],
    effortEstimates: [],
    temporalConstraints: [],
    recurrence: [],
    durableContextSignals: [],
    sourceText: params.sourceText,
  };
}

describe('Issue #152 V03 provenance validator characterizations', () => {
  it.fails('does not authorize a one-character source substring as grounding for a decision or large amount', () => {
    // Issue #152 V03 reproduced: provenance uses substring inclusion without a minimum evidence length.
    const decisionDocument = emptyDocument();
    decisionDocument.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: 'x',
      value: null,
      dateExpression: null,
      sourceText: 'x',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: decisionDocument,
      currentUserText: 'x',
    })).not.toEqual([]);

    const amountDocument = emptyDocument();
    amountDocument.tasks = [taskWithWorkload({
      title: '数学',
      sourceText: 'x',
      workloadSourceText: 'x',
      workloadAmount: 10_000,
    })];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document: amountDocument,
      currentUserText: 'x',
    })).not.toEqual([]);
  });

  it.fails('does not bypass exact-copy detection with zero-width or suffix copies', () => {
    // Issue #152 V03 reproduced: exact normalized equality is required, so invisible and partial copies evade the stored-context detector.
    for (const value of ['S\u200bECRET', 'SECRET-suffix']) {
      const document = emptyDocument();
      document.userContextFacts = [{
        localId: 'fact-1',
        kind: 'concern',
        label: '別ラベル',
        value,
        dateExpression: null,
        sourceText: '今日は数学を進める',
      }];
      expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
        document,
        currentUserText: '今日は数学を進める',
        publicStateSummary: {
          userPlanningContext: [{ id: 'stored-1', label: '学習', value: 'SECRET' }],
        },
      })).not.toEqual([]);
    }
  });

  it('rejects an exact stored copy without current-turn mention', () => {
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
        label: '別ラベル',
      value: 'SECRET',
      dateExpression: null,
      sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: { userPlanningContext: [{ id: 'stored-1', label: '学習', value: 'SECRET' }] },
    })).toContain('document.userContextFacts[0].value:copied-from-stored-context-without-current-mention');
  });

  it.fails('collects registered material and numeric sibling strings before allowing copied values', () => {
    // Issue #152 V03 reproduced: registeredMaterials, workload units/periods, and source expressions are absent from stored-string collection.
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: '教材',
      value: 'Catalog Secret',
      dateExpression: null,
      sourceText: '今日は数学を進める',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日は数学を進める',
      publicStateSummary: {
        registeredMaterials: [{ name: '教材', catalogTitle: 'Catalog Secret', aliases: ['Alias Secret'] }],
        workloads: [{ unitLabel: 'Catalog Secret', periodExpression: '毎週' }],
        groundingRecords: [{ sourceExpression: 'Grounding Secret' }],
      },
    })).not.toEqual([]);
  });

  it.fails('does not treat recent user messages and assistant fragments as current evidence', () => {
    // Issue #152 V03 reproduced: recent user messages and assistant fragments are not comprehensively collected as stored-copy sources.
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: '履歴',
      value: '過去の断片',
      dateExpression: null,
      sourceText: '今日の数学',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '今日の数学',
      publicStateSummary: {
        recentConversation: [{ role: 'user', content: '過去の断片' }],
        lastAssistantMessage: '現在の説明に過去の断片が含まれる',
      },
    })).not.toEqual([]);
  });

  it('fails closed when current-user text is absent at the semantic response boundary', () => {
    const document = emptyDocument();
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({ document })).toEqual([]);
  });
});
